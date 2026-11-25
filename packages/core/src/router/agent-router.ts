import { z } from 'zod';
import type {
  AgentHealthInfo,
  DragonFlowConfig,
  GitHubIssue,
  RoutingDecision,
  RoutingRule,
  TriageResult,
  WorkflowTier,
} from '@dragonflow/shared';
import type { AgentRegistry } from '../adapters/registry.js';
import type { LlmClient } from '../llm/structured-llm.js';

const LlmRouterResponseSchema = z.object({
  primaryAgent: z.string().min(1),
  rationale: z.string().min(1),
  recommendedTier: z.enum(['quick_fix', 'full_sdlc']).optional(),
});

export class AgentRouter {
  constructor(
    private readonly config: DragonFlowConfig,
    private readonly registry: AgentRegistry,
    private readonly llm: LlmClient,
  ) {}

  async route(input: {
    issue: GitHubIssue;
    triage: TriageResult;
    manualOverrideAgentId?: string;
    repoSummary?: string;
    onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  }): Promise<{ decision: RoutingDecision; tokens: number; costUsd: number }> {
    const available = this.registry.getAvailableAgents();
    if (available.length === 0) {
      throw new Error(
        'No Coding Agent CLIs are currently enabled and available. Run agent probe or configure at least one agent.',
      );
    }

    const availableIds = new Set(available.map((a) => a.id));
    const defaultTier: WorkflowTier =
      input.triage.estimatedComplexity <= this.config.workflow.quickFixMaxComplexity
        ? 'quick_fix'
        : 'full_sdlc';

    // Tier 1: Manual override (from /auto <agent> or Web UI)
    if (input.manualOverrideAgentId) {
      if (!availableIds.has(input.manualOverrideAgentId)) {
        throw new Error(
          `Requested agent "${input.manualOverrideAgentId}" is not available. Available agents: ${available.map((a) => a.id).join(', ')}`,
        );
      }
      const fallbackAgents = this.buildFallbackChain(input.manualOverrideAgentId, available);
      const reviewerAgent = this.pickReviewer(input.manualOverrideAgentId, available);
      return {
        decision: {
          tier: defaultTier,
          complexityScore: input.triage.estimatedComplexity,
          primaryAgent: input.manualOverrideAgentId,
          reviewerAgent,
          fallbackAgents,
          rationale: `维护者显式指定使用 Agent "${input.manualOverrideAgentId}" 执行任务。`,
          selectedBy: 'manual',
        },
        tokens: 0,
        costUsd: 0,
      };
    }

    // Tier 2: Static routing rules (lowest priority number wins)
    const sortedRules = [...this.config.routing.rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sortedRules) {
      if (!this.matchesRule(rule, input.issue, input.triage)) continue;

      const candidateChain = [
        rule.agentId,
        ...(rule.fallbackAgents ?? []),
      ];
      const chosenAgent = candidateChain.find((id) => availableIds.has(id));
      if (!chosenAgent) continue;

      const tier = rule.tierOverride ?? defaultTier;
      const fallbackAgents = this.buildFallbackChain(
        chosenAgent,
        available,
        rule.fallbackAgents,
      );
      const reviewerAgent = this.pickReviewer(chosenAgent, available);

      return {
        decision: {
          tier,
          complexityScore: input.triage.estimatedComplexity,
          primaryAgent: chosenAgent,
          reviewerAgent,
          fallbackAgents,
          rationale: `命中静态路由规则 "${rule.name}"（priority=${rule.priority}），选择 "${chosenAgent}"。`,
          selectedBy: 'rule',
          matchedRuleName: rule.name,
        },
        tokens: 0,
        costUsd: 0,
      };
    }

    // Tier 3: Router LLM capability matching across available agents
    try {
      const systemPrompt = [
        'You are the DragonFlow Agent Router.',
        'Select the best available coding agent based on task category, complexity (1..5), and each agent profile (strengths, costTier).',
        'You MUST choose primaryAgent strictly from the provided available agent IDs.',
        'Return JSON: { primaryAgent, rationale, recommendedTier }.',
      ].join('\n');

      const agentDescriptions = available.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        costTier: a.costTier,
        strengths: a.strengths,
      }));

      const userPrompt = JSON.stringify(
        {
          issue: {
            number: input.issue.number,
            title: input.issue.title,
            labels: input.issue.labels,
          },
          triage: input.triage,
          repoSummary: input.repoSummary ?? 'Open-source repository managed by DragonFlow',
          availableAgents: agentDescriptions,
        },
        null,
        2,
      );

      const llmRes = await this.llm.completeJson({
        stage: 'routing',
        systemPrompt,
        userPrompt,
        schema: LlmRouterResponseSchema,
        onLog: input.onLog,
      });

      if (availableIds.has(llmRes.data.primaryAgent)) {
        const primary = llmRes.data.primaryAgent;
        const tier = llmRes.data.recommendedTier ?? defaultTier;
        return {
          decision: {
            tier,
            complexityScore: input.triage.estimatedComplexity,
            primaryAgent: primary,
            reviewerAgent: this.pickReviewer(primary, available),
            fallbackAgents: this.buildFallbackChain(primary, available),
            rationale: llmRes.data.rationale,
            selectedBy: 'llm',
          },
          tokens: llmRes.tokens,
          costUsd: llmRes.costUsd,
        };
      }
    } catch (err) {
      input.onLog?.(
        'system',
        `[Router] LLM routing failed (${err instanceof Error ? err.message : String(err)}), using default fallback order.`,
      );
    }

    // Ultimate deterministic fallback
    const defaultCandidate = availableIds.has(this.config.routing.defaultAgent)
      ? this.config.routing.defaultAgent
      : this.config.routing.fallbackOrder.find((id) => availableIds.has(id)) ?? available[0].id;

    return {
      decision: {
        tier: defaultTier,
        complexityScore: input.triage.estimatedComplexity,
        primaryAgent: defaultCandidate,
        reviewerAgent: this.pickReviewer(defaultCandidate, available),
        fallbackAgents: this.buildFallbackChain(defaultCandidate, available),
        rationale: `采用默认回退策略选择可用 Agent "${defaultCandidate}"。`,
        selectedBy: 'default_fallback',
      },
      tokens: 0,
      costUsd: 0,
    };
  }

  selectNextFallback(
    triedAgents: string[],
    plannedFallbacks: string[] = [],
  ): string | null {
    const tried = new Set(triedAgents);
    const availableIds = new Set(this.registry.getAvailableAgents().map((a) => a.id));

    for (const id of [...plannedFallbacks, ...this.config.routing.fallbackOrder]) {
      if (!tried.has(id) && availableIds.has(id)) {
        return id;
      }
    }

    for (const id of availableIds) {
      if (!tried.has(id)) {
        return id;
      }
    }

    return null;
  }

  private matchesRule(rule: RoutingRule, issue: GitHubIssue, triage: TriageResult): boolean {
    const m = rule.match;
    if (m.categories && m.categories.length > 0 && !m.categories.includes(triage.category)) {
      return false;
    }
    if (m.labels && m.labels.length > 0) {
      const lowerLabels = new Set(issue.labels.map((l) => l.toLowerCase()));
      const hasAny = m.labels.some((target) => lowerLabels.has(target.toLowerCase()));
      if (!hasAny) return false;
    }
    if (m.titleRegex) {
      const re = new RegExp(m.titleRegex, 'i');
      if (!re.test(issue.title)) return false;
    }
    if (m.complexityMin !== undefined && triage.estimatedComplexity < m.complexityMin) {
      return false;
    }
    if (m.complexityMax !== undefined && triage.estimatedComplexity > m.complexityMax) {
      return false;
    }
    return true;
  }

  private buildFallbackChain(
    primaryAgent: string,
    available: AgentHealthInfo[],
    ruleFallbacks: string[] = [],
  ): string[] {
    const availableIds = new Set(available.map((a) => a.id));
    const ordered: string[] = [];
    const seen = new Set<string>([primaryAgent]);

    for (const id of [...ruleFallbacks, ...this.config.routing.fallbackOrder]) {
      if (!seen.has(id) && availableIds.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    for (const agent of available) {
      if (!seen.has(agent.id)) {
        seen.add(agent.id);
        ordered.push(agent.id);
      }
    }
    return ordered;
  }

  private pickReviewer(primaryAgent: string, available: AgentHealthInfo[]): string {
    const availableIds = new Set(available.map((a) => a.id));
    const preferred = this.config.routing.defaultReviewerAgent;

    if (
      preferred &&
      availableIds.has(preferred) &&
      (!this.config.routing.crossReviewDifferentAgent || preferred !== primaryAgent)
    ) {
      return preferred;
    }

    if (this.config.routing.crossReviewDifferentAgent) {
      for (const id of this.config.routing.fallbackOrder) {
        if (id !== primaryAgent && availableIds.has(id)) {
          return id;
        }
      }
      const other = available.find((a) => a.id !== primaryAgent);
      if (other) return other.id;
    }

    return primaryAgent;
  }
}
