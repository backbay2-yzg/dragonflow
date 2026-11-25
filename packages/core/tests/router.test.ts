import { describe, expect, it } from 'vitest';
import type { GitHubIssue, TriageResult } from '@dragonflow/shared';
import {
  AgentRegistry,
  AgentRouter,
  DEFAULT_AGENT_PRESETS,
  MockCodingAgentAdapter,
  MockStructuredLlmClient,
  parseConfigFromYaml,
} from '../src/index.js';

const sampleIssue: GitHubIssue = {
  number: 7,
  title: 'Improve docs and fix broken link',
  body: 'README has a broken link.',
  author: 'bob',
  authorAssociation: 'NONE',
  labels: ['documentation'],
  state: 'open',
  url: 'https://github.com/acme/repo/issues/7',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const sampleTriage: TriageResult = {
  category: 'docs',
  isDuplicate: false,
  needsMoreInfo: false,
  clarifyingQuestions: [],
  suggestedLabels: ['documentation'],
  estimatedComplexity: 1,
  recommendedTier: 'quick_fix',
  summary: 'Documentation link fix',
  riskFlags: [],
};

describe('Three-Tier AgentRouter & Fallback Chain', () => {
  it('respects priority order: manual override > static rule > Router LLM, and guarantees distinct reviewer', async () => {
    const config = parseConfigFromYaml(`
routing:
  defaultAgent: claude
  crossReviewDifferentAgent: true
  fallbackOrder: [claude, qodercli, gemini, opencode]
  rules:
    - name: docs-rule
      priority: 10
      match:
        categories: [docs]
      agentId: gemini
      fallbackAgents: [opencode]
`);

    const registry = new AgentRegistry(
      DEFAULT_AGENT_PRESETS,
      undefined,
      (profile) =>
        new MockCodingAgentAdapter(
          profile,
          ['claude', 'qodercli', 'gemini'].includes(profile.id),
        ),
    );
    await registry.probeAll();

    const llm = new MockStructuredLlmClient();
    const router = new AgentRouter(config, registry, llm);

    // 1. Manual override wins over rule
    const manual = await router.route({
      issue: sampleIssue,
      triage: sampleTriage,
      manualOverrideAgentId: 'qodercli',
    });
    expect(manual.decision.selectedBy).toBe('manual');
    expect(manual.decision.primaryAgent).toBe('qodercli');
    expect(manual.decision.reviewerAgent).not.toBe('qodercli');

    // 2. Static rule matches docs -> picks gemini, reviewer != gemini
    const ruleBased = await router.route({
      issue: sampleIssue,
      triage: sampleTriage,
    });
    expect(ruleBased.decision.selectedBy).toBe('rule');
    expect(ruleBased.decision.primaryAgent).toBe('gemini');
    expect(ruleBased.decision.reviewerAgent).toBe('claude');

    // 3. No rule match -> falls through to Router LLM
    const bugTriage: TriageResult = {
      ...sampleTriage,
      category: 'feature',
      estimatedComplexity: 4,
      recommendedTier: 'full_sdlc',
    };
    const llmBased = await router.route({
      issue: { ...sampleIssue, labels: ['enhancement'] },
      triage: bugTriage,
    });
    expect(llmBased.decision.selectedBy).toBe('llm');
    expect(llmBased.decision.primaryAgent).toBe('claude');
    expect(llmBased.decision.reviewerAgent).toBe('qodercli');

    // 4. Fallback chain avoids tried & unavailable agents
    const next1 = router.selectNextFallback(['claude'], llmBased.decision.fallbackAgents);
    expect(next1).toBe('qodercli');
    const next2 = router.selectNextFallback(
      ['claude', 'qodercli'],
      llmBased.decision.fallbackAgents,
    );
    expect(next2).toBe('gemini');
    const exhausted = router.selectNextFallback(
      ['claude', 'qodercli', 'gemini'],
      llmBased.decision.fallbackAgents,
    );
    expect(exhausted).toBeNull();
  });
});
