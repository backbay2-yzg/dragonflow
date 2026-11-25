import { z } from 'zod';
import {
  isTerminalStatus,
  type AgentErrorKind,
  type CrossReviewResult,
  type DragonFlowConfig,
  type FallbackAttemptRecord,
  type GitHubComment,
  type GitHubIssue,
  type NotificationEventType,
  type PlanDocument,
  type RepoConfig,
  type SpecDocument,
  type TaskRecord,
  type TriageResult,
} from '@dragonflow/shared';
import type { AgentExecResult } from '../adapters/coding-adapters.js';
import type { AgentRegistry } from '../adapters/registry.js';
import type { DragonFlowRepository } from '../db/repository.js';
import type { DragonFlowEventBus } from '../events/event-bus.js';
import type { GitHubClient } from '../github/client.js';
import { isMaintainer, parseMaintainerCommand } from '../github/commands.js';
import type { LlmClient } from '../llm/structured-llm.js';
import type { NotificationDispatcher } from '../notify/notifier.js';
import type { AgentRouter } from '../router/agent-router.js';
import type { IssueTriageService } from '../triage/issue-triage.js';
import type { WorkspaceRunner } from '../workspace/workspace-runner.js';

const SpecResponseSchema = z.object({
  problemStatement: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
  affectedAreas: z.array(z.string()).default([]),
});

const PlanResponseSchema = z.object({
  architectureSummary: z.string().min(1),
  filesToModify: z.array(z.string()).default([]),
  implementationSteps: z.array(z.string()).default([]),
  testPlan: z.array(z.string()).default([]),
  risksAndMitigations: z.array(z.string()).default([]),
});

const CrossReviewResponseSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  findings: z
    .array(
      z.object({
        severity: z.enum(['critical', 'major', 'minor', 'nit']),
        file: z.string().optional(),
        line: z.number().int().optional(),
        message: z.string(),
        suggestion: z.string().optional(),
      }),
    )
    .default([]),
  checklist: z
    .object({
      acceptanceCriteriaMet: z.boolean().default(true),
      testsAdequate: z.boolean().default(true),
      noObviousSecurityRisks: z.boolean().default(true),
      cleanScope: z.boolean().default(true),
    })
    .default({
      acceptanceCriteriaMet: true,
      testsAdequate: true,
      noObviousSecurityRisks: true,
      cleanScope: true,
    }),
});

class AsyncSemaphore {
  private current = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.maxConcurrency) {
      this.current += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.current += 1;
    return () => this.release();
  }

  private release(): void {
    this.current = Math.max(0, this.current - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

export interface OrchestratorDeps {
  config: DragonFlowConfig;
  repo: DragonFlowRepository;
  github: GitHubClient;
  triageService: IssueTriageService;
  router: AgentRouter;
  llm: LlmClient;
  registry: AgentRegistry;
  workspace: WorkspaceRunner;
  notifier: NotificationDispatcher;
  eventBus?: DragonFlowEventBus;
}

export class DragonFlowOrchestrator {
  private readonly taskLocks = new Map<string, Promise<unknown>>();
  private readonly semaphore: AsyncSemaphore;
  private readonly backgroundExecutions = new Set<Promise<void>>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.semaphore = new AsyncSemaphore(deps.config.workflow.maxConcurrentTasks);
  }

  async waitForIdle(): Promise<void> {
    while (this.backgroundExecutions.size > 0) {
      await Promise.allSettled(Array.from(this.backgroundExecutions));
    }
  }

  private runWithTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.taskLocks.get(taskId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tracked = next.then(
      () => {
        if (this.taskLocks.get(taskId) === tracked) {
          this.taskLocks.delete(taskId);
        }
      },
      () => {
        if (this.taskLocks.get(taskId) === tracked) {
          this.taskLocks.delete(taskId);
        }
      },
    );
    this.taskLocks.set(taskId, tracked);
    return next;
  }

  private scheduleBackground(fn: () => Promise<void>): void {
    const p = fn()
      .catch(() => undefined)
      .finally(() => {
        this.backgroundExecutions.delete(p);
      });
    this.backgroundExecutions.add(p);
  }

  private splitRepo(repoFullName: string): { owner: string; repo: string; cfg?: RepoConfig } {
    const [owner, repo] = repoFullName.split('/');
    const cfg = this.deps.config.github.repositories.find(
      (r) => `${r.owner}/${r.repo}`.toLowerCase() === repoFullName.toLowerCase(),
    );
    return { owner, repo, cfg };
  }

  private async emitNotification(
    event: NotificationEventType,
    task: TaskRecord,
    summary: string,
  ): Promise<void> {
    await this.deps.notifier.notify({
      event,
      repoFullName: task.repoFullName,
      issueNumber: task.issueNumber,
      title: task.issueTitle,
      summary,
      agentId: task.assignedAgent,
      prUrl: task.prUrl,
      releaseUrl: task.releaseUrl,
      issueUrl: task.issueUrl,
    });
  }

  async ingestIssue(
    repoFullName: string,
    issue: GitHubIssue,
    opts?: { awaitCompletion?: boolean; manualAgentId?: string },
  ): Promise<TaskRecord> {
    const { task, created } = this.deps.repo.upsertTaskFromIssue(repoFullName, issue);

    const hasTriggerLabel = issue.labels.some(
      (l) => l.toLowerCase() === this.deps.config.github.triggerLabel.toLowerCase(),
    );

    if (!created && task.status !== 'NEW') {
      if (
        hasTriggerLabel &&
        (task.status === 'AWAITING_INFO' || task.status === 'AWAITING_TRIGGER')
      ) {
        return this.triggerTask(task.id, opts?.manualAgentId, 'github:label', opts?.awaitCompletion);
      }
      return task;
    }

    const outcome = await this.runWithTaskLock(task.id, async () => {
      const current = this.deps.repo.getTask(task.id)!;
      if (current.status !== 'NEW') return { task: current, startPipeline: false };

      this.deps.repo.transitionTask(current.id, 'TRIAGING', 'dragonflow', 'Running read-only triage');
      const { owner, repo } = this.splitRepo(repoFullName);
      const recent = await this.deps.github.listOpenIssues(owner, repo).catch(() => []);
      const triageRun = this.deps.repo.createRun({
        taskId: current.id,
        stage: 'triage',
        agentId: 'structured-llm',
        attempt: 1,
      });

      let triageRes: { result: TriageResult; tokens: number; costUsd: number };
      try {
        triageRes = await this.deps.triageService.triage(issue, recent, (stream, msg) => {
          this.deps.repo.appendLog(current.id, triageRun.id, stream, msg);
        });
        this.deps.repo.finishRun(triageRun.id, {
          status: 'succeeded',
          errorKind: 'none',
          tokensUsed: triageRes.tokens,
          costUsd: triageRes.costUsd,
          summary: triageRes.result.summary,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.repo.finishRun(triageRun.id, {
          status: 'failed',
          errorKind: 'runtime_error',
          summary: msg,
        });
        const failed = this.deps.repo.transitionTask(
          current.id,
          'NEEDS_HUMAN',
          'dragonflow',
          `Triage failed: ${msg}`,
          { lastError: msg },
        );
        await this.syncStatusCard(failed);
        await this.emitNotification('needs_human', failed, `分诊失败：${msg}`);
        return { task: failed, startPipeline: false };
      }

      const triage = triageRes.result;
      this.deps.repo.saveArtifact({
        taskId: current.id,
        kind: 'triage',
        title: `Issue #${issue.number} 自动分诊报告`,
        content: [
          `## 分诊结果`,
          `- **分类**: \`${triage.category}\``,
          `- **复杂度**: ${triage.estimatedComplexity}/5`,
          `- **推荐流程**: \`${triage.recommendedTier}\``,
          `- **重复 Issue**: ${triage.isDuplicate ? `是 (#${triage.duplicateOf ?? 'unknown'})` : '否'}`,
          `- **信息是否完整**: ${triage.needsMoreInfo ? '待补充' : '完整'}`,
          '',
          `### 摘要`,
          triage.summary,
          triage.clarifyingQuestions.length > 0
            ? `\n### 需补充信息\n${triage.clarifyingQuestions.map((q) => `- ${q}`).join('\n')}`
            : '',
        ].join('\n'),
        metadata: triage as unknown as Record<string, unknown>,
      });

      this.deps.repo.updateTask(current.id, {
        category: triage.category,
        complexityScore: triage.estimatedComplexity,
        tier: triage.recommendedTier,
      });

      if (triage.suggestedLabels.length > 0) {
        await this.deps.github
          .addLabels(owner, repo, issue.number, triage.suggestedLabels)
          .catch(() => undefined);
      }

      const ownerFastTrack =
        this.deps.config.github.ownerFastTrack &&
        issue.authorAssociation.toUpperCase() === 'OWNER' &&
        !['spam', 'question', 'duplicate'].includes(triage.category);

      if (triage.needsMoreInfo && !hasTriggerLabel && !ownerFastTrack) {
        const updated = this.deps.repo.transitionTask(
          current.id,
          'AWAITING_INFO',
          'dragonflow',
          'Issue needs clarification before automation',
        );
        await this.syncStatusCard(updated, triage);
        await this.emitNotification('triage_completed', updated, '分诊完成：等待提问者补充信息');
        return { task: updated, startPipeline: false };
      }

      if (hasTriggerLabel || ownerFastTrack) {
        const reason = hasTriggerLabel
          ? `Admitted via "${this.deps.config.github.triggerLabel}" label`
          : 'Admitted via owner fast-track';
        const routed = this.deps.repo.transitionTask(current.id, 'ROUTING', 'dragonflow', reason);
        return { task: routed, startPipeline: true };
      }

      const awaiting = this.deps.repo.transitionTask(
        current.id,
        'AWAITING_TRIGGER',
        'dragonflow',
        `Awaiting "${this.deps.config.github.triggerLabel}" label or /auto command`,
      );
      await this.syncStatusCard(awaiting, triage);
      await this.emitNotification('triage_completed', awaiting, '分诊完成：等待维护者打标签或 /auto 放行');
      return { task: awaiting, startPipeline: false };
    });

    if (outcome.startPipeline) {
      if (opts?.awaitCompletion) {
        await this.runRoutingAndExecution(outcome.task.id, {
          manualAgentId: opts?.manualAgentId,
        });
        return this.deps.repo.getTask(outcome.task.id)!;
      }
      this.scheduleBackground(() =>
        this.runRoutingAndExecution(outcome.task.id, { manualAgentId: opts?.manualAgentId }),
      );
    }

    return outcome.task;
  }

  async handleComment(
    repoFullName: string,
    issueNumber: number,
    comment: GitHubComment,
    opts?: { awaitCompletion?: boolean },
  ): Promise<TaskRecord | null> {
    const task = this.deps.repo.getTaskByRepoIssue(repoFullName, issueNumber);
    if (!task) return null;
    if (comment.id <= task.lastProcessedCommentId) return task;
    if (comment.body.includes('dragonflow:status-card')) {
      this.deps.repo.updateTask(task.id, { lastProcessedCommentId: comment.id });
      return task;
    }

    this.deps.repo.updateTask(task.id, { lastProcessedCommentId: comment.id });
    const parsed = parseMaintainerCommand(comment.body, comment.author, comment.id);

    if (!parsed) {
      // If author supplemented info while AWAITING_INFO, re-triage with appended context
      if (
        task.status === 'AWAITING_INFO' &&
        comment.author.toLowerCase() === task.issueAuthor.toLowerCase()
      ) {
        const updated = this.deps.repo.updateTask(task.id, {
          issueBody: `${task.issueBody}\n\n---\nAuthor Supplement:\n${comment.body}`,
        });
        this.deps.repo.transitionTask(updated.id, 'TRIAGING', comment.author, 'Author provided info');
        const re = await this.deps.triageService.triage({
          number: updated.issueNumber,
          title: updated.issueTitle,
          body: updated.issueBody,
          author: updated.issueAuthor,
          authorAssociation: 'NONE',
          labels: updated.labels,
          state: 'open',
          url: updated.issueUrl,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
        if (!re.result.needsMoreInfo) {
          const awaiting = this.deps.repo.transitionTask(
            updated.id,
            'AWAITING_TRIGGER',
            'dragonflow',
            'Supplemented info is sufficient; awaiting maintainer trigger',
          );
          await this.syncStatusCard(awaiting, re.result);
          return awaiting;
        }
        const stillWaiting = this.deps.repo.transitionTask(
          updated.id,
          'AWAITING_INFO',
          'dragonflow',
          'Still missing details after supplement',
        );
        await this.syncStatusCard(stillWaiting, re.result);
        return stillWaiting;
      }
      return task;
    }

    if (!isMaintainer(comment.author, comment.authorAssociation, this.deps.config)) {
      return task;
    }

    switch (parsed.command) {
      case 'auto':
        return this.triggerTask(task.id, parsed.arg, comment.author, opts?.awaitCompletion);
      case 'approve':
        return this.approvePlan(task.id, comment.author, opts?.awaitCompletion);
      case 'reject':
        return this.rejectPlan(
          task.id,
          parsed.arg || '请根据 Issue 需求重新优化实现方案与边界处理。',
          comment.author,
        );
      case 'retry':
        return this.retryTask(task.id, parsed.arg, comment.author, opts?.awaitCompletion);
      case 'fix':
        return this.requestManualFix(
          task.id,
          parsed.arg || '请根据最新评论检查并修复 PR 问题。',
          comment.author,
          opts?.awaitCompletion,
        );
      case 'merge':
        return this.mergeTaskPr(task.id, comment.author);
      case 'cancel':
        return this.cancelTask(task.id, comment.author);
      default:
        return task;
    }
  }

  async triggerTask(
    taskId: string,
    manualAgentId?: string,
    actor = 'dashboard',
    awaitCompletion = false,
  ): Promise<TaskRecord> {
    const task = await this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (isTerminalStatus(current.status)) {
        throw new Error(`Cannot trigger task in terminal status: ${current.status}`);
      }
      if (
        ![
          'NEW',
          'AWAITING_INFO',
          'AWAITING_TRIGGER',
          'NEEDS_HUMAN',
          'FAILED',
        ].includes(current.status)
      ) {
        return current;
      }
      return this.deps.repo.transitionTask(
        current.id,
        'ROUTING',
        actor,
        manualAgentId ? `Triggered with explicit agent "${manualAgentId}"` : 'Triggered for execution',
        { lastError: null },
      );
    });

    if (task.status === 'ROUTING') {
      if (awaitCompletion) {
        await this.runRoutingAndExecution(task.id, { manualAgentId });
      } else {
        this.scheduleBackground(() => this.runRoutingAndExecution(task.id, { manualAgentId }));
      }
    }
    return this.deps.repo.getTask(task.id)!;
  }

  async approvePlan(
    taskId: string,
    actor = 'maintainer',
    awaitCompletion = false,
  ): Promise<TaskRecord> {
    const updated = await this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (current.status !== 'AWAITING_PLAN_APPROVAL') {
        throw new Error(`Task is in status ${current.status}, expected AWAITING_PLAN_APPROVAL`);
      }
      return this.deps.repo.transitionTask(
        current.id,
        'IMPLEMENTING',
        actor,
        'Plan approved; starting implementation',
      );
    });

    if (awaitCompletion) {
      await this.runImplementationToPr(updated.id);
    } else {
      this.scheduleBackground(() => this.runImplementationToPr(updated.id));
    }
    return this.deps.repo.getTask(updated.id)!;
  }

  async rejectPlan(
    taskId: string,
    feedback: string,
    actor = 'maintainer',
  ): Promise<TaskRecord> {
    return this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (current.status !== 'AWAITING_PLAN_APPROVAL') {
        throw new Error(`Task is in status ${current.status}, expected AWAITING_PLAN_APPROVAL`);
      }

      this.deps.repo.transitionTask(
        current.id,
        'PLANNING',
        actor,
        `Plan revision requested: ${feedback}`,
      );

      await this.generateSpecAndPlan(current.id, feedback);
      const updated = this.deps.repo.transitionTask(
        current.id,
        'AWAITING_PLAN_APPROVAL',
        'dragonflow',
        'Revised plan generated; awaiting maintainer approval',
      );
      await this.syncStatusCard(updated);
      await this.emitNotification('plan_awaiting_approval', updated, '技术方案已修订，等待审批');
      return updated;
    });
  }

  async retryTask(
    taskId: string,
    overrideAgentId?: string,
    actor = 'dashboard',
    awaitCompletion = false,
  ): Promise<TaskRecord> {
    const updated = await this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);

      const patch = {
        localFixRetries: 0,
        crossReviewRetries: 0,
        ciFixRetries: 0,
        reviewFixRetries: 0,
        lastError: null,
        ...(overrideAgentId ? { assignedAgent: overrideAgentId } : {}),
      };

      if (current.prNumber) {
        return this.deps.repo.transitionTask(
          current.id,
          'CI_FIXING',
          actor,
          overrideAgentId ? `Retrying PR fix with agent ${overrideAgentId}` : 'Retrying PR fix',
          patch,
        );
      }

      return this.deps.repo.transitionTask(
        current.id,
        'ROUTING',
        actor,
        overrideAgentId ? `Retrying from routing with agent ${overrideAgentId}` : 'Retrying task',
        patch,
      );
    });

    const runner = async () => {
      if (updated.status === 'CI_FIXING') {
        await this.runPrFixLoop(updated.id, 'CI_FIXING', 'Manual retry requested');
      } else {
        await this.runRoutingAndExecution(updated.id, { manualAgentId: overrideAgentId });
      }
    };

    if (awaitCompletion) {
      await runner();
    } else {
      this.scheduleBackground(runner);
    }
    return this.deps.repo.getTask(updated.id)!;
  }

  async requestManualFix(
    taskId: string,
    instructions: string,
    actor = 'maintainer',
    awaitCompletion = false,
  ): Promise<TaskRecord> {
    const updated = await this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (!current.prNumber) {
        throw new Error('Cannot run /fix before a PR is opened');
      }
      return this.deps.repo.transitionTask(
        current.id,
        'REVIEW_FIXING',
        actor,
        `Manual fix requested: ${instructions}`,
      );
    });

    if (awaitCompletion) {
      await this.runPrFixLoop(updated.id, 'REVIEW_FIXING', instructions);
    } else {
      this.scheduleBackground(() => this.runPrFixLoop(updated.id, 'REVIEW_FIXING', instructions));
    }
    return this.deps.repo.getTask(updated.id)!;
  }

  async mergeTaskPr(taskId: string, actor = 'maintainer'): Promise<TaskRecord> {
    return this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (!current.prNumber) {
        throw new Error('Task does not have an open PR to merge');
      }
      if (!['PR_OPEN', 'READY_TO_MERGE'].includes(current.status)) {
        throw new Error(`Task in status ${current.status} cannot be merged`);
      }

      const { owner, repo } = this.splitRepo(current.repoFullName);
      const mergeMethod = this.deps.config.github.autoMergeLowRisk.mergeMethod;
      const res = await this.deps.github.mergePullRequest(
        owner,
        repo,
        current.prNumber,
        mergeMethod,
        `${this.formatCommitPrefix(current.category)}(#${current.issueNumber}): ${current.issueTitle}`,
      );
      if (!res.merged) {
        throw new Error(`GitHub refused to merge PR #${current.prNumber}`);
      }

      const merged = this.deps.repo.transitionTask(
        current.id,
        'MERGED',
        actor,
        `Merged PR #${current.prNumber}`,
      );

      if (this.deps.config.workspace.cleanupOnFinish && merged.worktreePath) {
        await this.deps.workspace
          .cleanupWorkspace(merged.repoFullName, merged.worktreePath)
          .catch(() => undefined);
      }

      await this.syncStatusCard(merged);
      await this.emitNotification('merged', merged, `PR #${merged.prNumber} 已合入主分支`);
      return merged;
    });
  }

  async cancelTask(taskId: string, actor = 'maintainer'): Promise<TaskRecord> {
    return this.runWithTaskLock(taskId, async () => {
      const current = this.deps.repo.getTask(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      if (isTerminalStatus(current.status)) return current;
      const cancelled = this.deps.repo.transitionTask(
        current.id,
        'CANCELLED',
        actor,
        'Task cancelled',
      );
      await this.syncStatusCard(cancelled);
      return cancelled;
    });
  }

  private async runRoutingAndExecution(
    taskId: string,
    opts?: { manualAgentId?: string },
  ): Promise<void> {
    const release = await this.semaphore.acquire();
    try {
      const needsApproval = await this.runWithTaskLock(taskId, async () => {
        const task = this.deps.repo.getTask(taskId);
        if (!task || task.status !== 'ROUTING') return false;

        const { owner, repo } = this.splitRepo(task.repoFullName);
        const triageArtifact = this.deps.repo.getLatestArtifact(task.id, 'triage');
        const triage: TriageResult = triageArtifact?.metadata
          ? (triageArtifact.metadata as unknown as TriageResult)
          : {
              category: task.category ?? 'bug',
              isDuplicate: false,
              needsMoreInfo: false,
              clarifyingQuestions: [],
              suggestedLabels: [],
              estimatedComplexity: task.complexityScore ?? 2,
              recommendedTier: task.tier,
              summary: task.issueTitle,
              riskFlags: [],
            };

        const repoSummary = await this.deps.github
          .getRepoSummary(owner, repo)
          .catch(() => task.repoFullName);

        const routeRun = this.deps.repo.createRun({
          taskId: task.id,
          stage: 'routing',
          agentId: 'router',
          attempt: 1,
        });

        let routingRes;
        try {
          routingRes = await this.deps.router.route({
            issue: {
              number: task.issueNumber,
              title: task.issueTitle,
              body: task.issueBody,
              author: task.issueAuthor,
              authorAssociation: 'NONE',
              labels: task.labels,
              state: 'open',
              url: task.issueUrl,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
            },
            triage,
            manualOverrideAgentId: opts?.manualAgentId,
            repoSummary,
            onLog: (stream, msg) => this.deps.repo.appendLog(task.id, routeRun.id, stream, msg),
          });
          this.deps.repo.finishRun(routeRun.id, {
            status: 'succeeded',
            errorKind: 'none',
            tokensUsed: routingRes.tokens,
            costUsd: routingRes.costUsd,
            summary: routingRes.decision.rationale,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.deps.repo.finishRun(routeRun.id, {
            status: 'failed',
            errorKind: 'runtime_error',
            summary: msg,
          });
          const failed = this.deps.repo.transitionTask(
            task.id,
            'NEEDS_HUMAN',
            'router',
            `Routing failed: ${msg}`,
            { lastError: msg },
          );
          await this.syncStatusCard(failed);
          await this.emitNotification('needs_human', failed, `Agent 路由失败：${msg}`);
          return false;
        }

        const decision = routingRes.decision;
        const branchName = `dragonflow/issue-${task.issueNumber}`;
        this.deps.repo.transitionTask(
          task.id,
          'PLANNING',
          'router',
          `Selected ${decision.primaryAgent} (${decision.tier})`,
          {
            tier: decision.tier,
            complexityScore: decision.complexityScore,
            assignedAgent: decision.primaryAgent,
            reviewerAgent: decision.reviewerAgent,
            routingRationale: decision.rationale,
            branchName,
          },
        );

        await this.generateSpecAndPlan(task.id);

        if (
          decision.tier === 'full_sdlc' &&
          this.deps.config.workflow.requirePlanApprovalForFullSdlc
        ) {
          const waiting = this.deps.repo.transitionTask(
            task.id,
            'AWAITING_PLAN_APPROVAL',
            'dragonflow',
            'Full SDLC plan ready; waiting for maintainer /approve',
          );
          await this.syncStatusCard(waiting);
          await this.emitNotification(
            'plan_awaiting_approval',
            waiting,
            `已完成 Spec 与技术方案，请确认审批（/approve）后开始编码。`,
          );
          return true;
        }

        this.deps.repo.transitionTask(
          task.id,
          'IMPLEMENTING',
          'dragonflow',
          'Proceeding directly to implementation',
        );
        return false;
      });

      if (!needsApproval) {
        const current = this.deps.repo.getTask(taskId);
        if (current && current.status === 'IMPLEMENTING') {
          await this.executeImplementationPipeline(taskId);
        }
      }
    } finally {
      release();
    }
  }

  private async runImplementationToPr(taskId: string): Promise<void> {
    const release = await this.semaphore.acquire();
    try {
      await this.executeImplementationPipeline(taskId);
    } finally {
      release();
    }
  }

  private async generateSpecAndPlan(taskId: string, revisionFeedback?: string): Promise<void> {
    const task = this.deps.repo.getTask(taskId)!;
    const planRun = this.deps.repo.createRun({
      taskId: task.id,
      stage: 'planning',
      agentId: 'structured-llm',
      attempt: 1,
    });

    try {
      const specRes = await this.deps.llm.completeJson({
        stage: 'spec',
        systemPrompt: [
          'You are a Staff Product & Requirements Engineer.',
          'Produce a clear, testable software specification from the GitHub issue.',
          'Return JSON: { problemStatement, acceptanceCriteria, nonGoals, affectedAreas }.',
        ].join('\n'),
        userPrompt: [
          `Issue #${task.issueNumber}: ${task.issueTitle}`,
          `Body:\n${task.issueBody}`,
          revisionFeedback ? `\nMaintainer Feedback:\n${revisionFeedback}` : '',
        ].join('\n'),
        schema: SpecResponseSchema,
        onLog: (s, m) => this.deps.repo.appendLog(task.id, planRun.id, s, m),
      });

      const specDoc: SpecDocument = {
        ...specRes.data,
        markdown: [
          `## 需求规格说明书 (Spec) — #${task.issueNumber}`,
          `### 问题描述`,
          specRes.data.problemStatement,
          `### 验收标准 (Acceptance Criteria)`,
          ...specRes.data.acceptanceCriteria.map((c) => `- [ ] ${c}`),
          specRes.data.nonGoals.length > 0
            ? `### 非目标 (Non-Goals)\n${specRes.data.nonGoals.map((g) => `- ${g}`).join('\n')}`
            : '',
          specRes.data.affectedAreas.length > 0
            ? `### 影响范围\n${specRes.data.affectedAreas.map((a) => `- \`${a}\``).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };

      this.deps.repo.saveArtifact({
        taskId: task.id,
        kind: 'spec',
        title: `需求规格 Spec (#${task.issueNumber})`,
        content: specDoc.markdown,
        metadata: specRes.data as unknown as Record<string, unknown>,
      });

      let totalTokens = specRes.tokens;
      let totalCost = specRes.costUsd;

      if (task.tier === 'full_sdlc') {
        const planRes = await this.deps.llm.completeJson({
          stage: 'plan',
          systemPrompt: [
            'You are a Principal Software Architect.',
            'Create an actionable technical design & test plan.',
            'Return JSON: { architectureSummary, filesToModify, implementationSteps, testPlan, risksAndMitigations }.',
          ].join('\n'),
          userPrompt: [
            `Spec:\n${specDoc.markdown}`,
            revisionFeedback ? `\nMaintainer Revision Feedback:\n${revisionFeedback}` : '',
          ].join('\n'),
          schema: PlanResponseSchema,
          onLog: (s, m) => this.deps.repo.appendLog(task.id, planRun.id, s, m),
        });

        totalTokens += planRes.tokens;
        totalCost += planRes.costUsd;

        const planDoc: PlanDocument = {
          ...planRes.data,
          markdown: [
            `## 技术方案与测试计划 (Plan) — #${task.issueNumber}`,
            `### 架构设计`,
            planRes.data.architectureSummary,
            `### 预计改动文件`,
            ...planRes.data.filesToModify.map((f) => `- \`${f}\``),
            `### 实施步骤`,
            ...planRes.data.implementationSteps.map((s) => `- ${s}`),
            `### 测试计划`,
            ...planRes.data.testPlan.map((t) => `- ${t}`),
            planRes.data.risksAndMitigations.length > 0
              ? `### 风险与兜底\n${planRes.data.risksAndMitigations.map((r) => `- ${r}`).join('\n')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        };

        this.deps.repo.saveArtifact({
          taskId: task.id,
          kind: 'plan',
          title: `技术方案 Plan (#${task.issueNumber})`,
          content: planDoc.markdown,
          metadata: planRes.data as unknown as Record<string, unknown>,
        });
      }

      this.deps.repo.finishRun(planRun.id, {
        status: 'succeeded',
        errorKind: 'none',
        tokensUsed: totalTokens,
        costUsd: totalCost,
        summary: `Generated ${task.tier === 'full_sdlc' ? 'Spec & Plan' : 'Quick Spec'}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.repo.finishRun(planRun.id, {
        status: 'failed',
        errorKind: 'runtime_error',
        summary: msg,
      });
      throw err;
    }
  }

  private async executeImplementationPipeline(taskId: string): Promise<void> {
    await this.runWithTaskLock(taskId, async () => {
      let task = this.deps.repo.getTask(taskId);
      if (!task || task.status !== 'IMPLEMENTING') return;

      const { owner, repo, cfg } = this.splitRepo(task.repoFullName);
      const baseBranch = cfg?.baseBranch ?? 'main';
      const branchName = task.branchName ?? `dragonflow/issue-${task.issueNumber}`;
      const remoteUrl =
        this.deps.config.workspace.localRepoUrlOverride ||
        (await this.deps.github.getRepoCloneUrl(owner, repo));

      let worktreePath: string;
      try {
        worktreePath = await this.deps.workspace.createTaskWorkspace(
          task.id,
          task.repoFullName,
          remoteUrl,
          branchName,
          baseBranch,
        );
        task = this.deps.repo.updateTask(task.id, { worktreePath, branchName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.escalateNeedsHuman(task.id, `创建 Git Worktree 失败：${msg}`);
        return;
      }

      const specContent = this.deps.repo.getLatestArtifact(task.id, 'spec')?.content ?? '';
      const planContent = this.deps.repo.getLatestArtifact(task.id, 'plan')?.content ?? '';
      let feedbackPrompt = '';
      const triedAgents = new Set<string>();

      while (true) {
        task = this.deps.repo.getTask(task.id)!;
        const primaryAgent =
          task.assignedAgent ?? this.deps.config.routing.defaultAgent;
        triedAgents.add(primaryAgent);

        const implPrompt = [
          `You are implementing GitHub Issue #${task.issueNumber} in repository ${task.repoFullName}.`,
          `Title: ${task.issueTitle}`,
          `Description:\n${task.issueBody}`,
          specContent ? `\n${specContent}` : '',
          planContent ? `\n${planContent}` : '',
          feedbackPrompt ? `\n## Previous Failure / Review Feedback to Fix\n${feedbackPrompt}` : '',
          '\nInstructions: Modify the codebase cleanly, write or update tests, do NOT run git push.',
        ]
          .filter(Boolean)
          .join('\n\n');

        const execRes = await this.executeAgentWithFallback(
          task.id,
          'implementing',
          worktreePath,
          branchName,
          implPrompt,
          triedAgents,
        );
        if (!execRes.ok) {
          await this.escalateNeedsHuman(task.id, execRes.errorMessage);
          return;
        }

        const diffText = await this.deps.workspace.getDiff(worktreePath, baseBranch);
        this.deps.repo.saveArtifact({
          taskId: task.id,
          kind: 'diff',
          title: `代码变更 Diff (${execRes.usedAgent})`,
          content: diffText,
        });

        task = this.deps.repo.transitionTask(
          task.id,
          'TESTING',
          'dragonflow',
          'Running local lint, test, and build verification',
        );

        const testReport = await this.runVerificationSuite(task.id, worktreePath, cfg);
        this.deps.repo.saveArtifact({
          taskId: task.id,
          kind: 'test_report',
          title: `本地测试验证报告 (${testReport.passed ? '通过' : '失败'})`,
          content: testReport.markdown,
          metadata: { passed: testReport.passed },
        });

        if (!testReport.passed) {
          if (task.localFixRetries < this.deps.config.workflow.maxLocalFixRetries) {
            task = this.deps.repo.updateTask(task.id, {
              localFixRetries: task.localFixRetries + 1,
            });
            feedbackPrompt = `Local test/build verification failed (retry ${task.localFixRetries}):\n${testReport.failureOutput}`;
            task = this.deps.repo.transitionTask(
              task.id,
              'IMPLEMENTING',
              'dragonflow',
              `Local verification failed; self-healing retry ${task.localFixRetries}`,
            );
            continue;
          }

          // Try switching to another agent if available after exhausting current agent retries
          const nextAgent = this.deps.router.selectNextFallback(Array.from(triedAgents));
          if (nextAgent) {
            const currentAgent = task.assignedAgent ?? primaryAgent;
            await this.recordFallback(
              task.id,
              currentAgent,
              nextAgent,
              'testing',
              'Exceeded local test-fix retries with current agent',
              'runtime_error',
            );
            task = this.deps.repo.updateTask(task.id, { localFixRetries: 0 });
            feedbackPrompt = `Previous agent (${currentAgent}) failed tests repeatedly:\n${testReport.failureOutput}`;
            task = this.deps.repo.transitionTask(
              task.id,
              'IMPLEMENTING',
              'dragonflow',
              `Falling back to ${nextAgent} after repeated test failures`,
            );
            continue;
          }

          await this.escalateNeedsHuman(
            task.id,
            `本地测试连续失败且已无可用备选 Agent：\n${testReport.failureOutput.slice(0, 600)}`,
          );
          return;
        }

        // Tests passed -> Cross-Agent Code Review
        task = this.deps.repo.transitionTask(
          task.id,
          'CROSS_REVIEW',
          'dragonflow',
          `Starting cross-review by ${task.reviewerAgent ?? 'reviewer'}`,
        );

        const review = await this.runCrossReview(task, specContent, diffText, testReport.markdown);
        this.deps.repo.saveArtifact({
          taskId: task.id,
          kind: 'review',
          title: `跨 Agent 独立 Review (${task.reviewerAgent ?? 'reviewer'}): ${review.approved ? '通过' : '需修改'}`,
          content: this.formatReviewMarkdown(review, task.reviewerAgent ?? 'reviewer'),
          metadata: review as unknown as Record<string, unknown>,
        });

        if (!review.approved) {
          if (task.crossReviewRetries < this.deps.config.workflow.maxCrossReviewRetries) {
            task = this.deps.repo.updateTask(task.id, {
              crossReviewRetries: task.crossReviewRetries + 1,
            });
            feedbackPrompt = `Cross-review by ${task.reviewerAgent} requested fixes:\n${this.formatReviewMarkdown(review, task.reviewerAgent ?? 'reviewer')}`;
            task = this.deps.repo.transitionTask(
              task.id,
              'IMPLEMENTING',
              task.reviewerAgent ?? 'reviewer',
              `Cross-review found blocking issues; fixing (attempt ${task.crossReviewRetries})`,
            );
            continue;
          }

          await this.escalateNeedsHuman(
            task.id,
            `独立 Cross-Review 多次未通过：${review.summary}`,
          );
          return;
        }

        // Cross-review passed -> Commit & Push & Create PR
        break;
      }

      task = this.deps.repo.getTask(taskId)!;
      const commitPrefix = this.formatCommitPrefix(task.category);
      const commitMessage = `${commitPrefix}(issue-${task.issueNumber}): ${task.issueTitle}`;
      const pushRemote = !this.deps.github.isMock;

      let commitRes;
      try {
        commitRes = await this.deps.workspace.commitAndPush(
          worktreePath,
          commitMessage,
          branchName,
          pushRemote,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.escalateNeedsHuman(task.id, `Git 提交或推送失败：${msg}`);
        return;
      }

      const prBody = this.buildPrBody(task, commitRes.changedFiles);
      this.deps.repo.saveArtifact({
        taskId: task.id,
        kind: 'pr_body',
        title: `Pull Request 描述 (#${task.issueNumber})`,
        content: prBody,
      });

      const pr = await this.deps.github.createPullRequest(owner, repo, {
        title: `${commitPrefix}: ${task.issueTitle} (#${task.issueNumber})`,
        body: prBody,
        headBranch: branchName,
        baseBranch,
      });

      const opened = this.deps.repo.transitionTask(
        task.id,
        'PR_OPEN',
        'dragonflow',
        `Opened PR #${pr.number}`,
        { prNumber: pr.number, prUrl: pr.url },
      );

      await this.syncStatusCard(opened);
      await this.emitNotification(
        'pr_opened',
        opened,
        `已由 ${opened.assignedAgent} 实现并经 ${opened.reviewerAgent} 交叉审查，PR #${pr.number} 已创建。`,
      );
    });
  }

  private async executeAgentWithFallback(
    taskId: string,
    stage: string,
    cwd: string,
    branchName: string,
    prompt: string,
    triedAgents: Set<string>,
  ): Promise<{ ok: true; usedAgent: string; result: AgentExecResult } | { ok: false; errorMessage: string }> {
    let task = this.deps.repo.getTask(taskId)!;
    let currentAgentId = task.assignedAgent ?? this.deps.config.routing.defaultAgent;
    let attempt = 0;

    while (true) {
      attempt += 1;
      triedAgents.add(currentAgentId);
      const adapter = this.deps.registry.getAdapter(currentAgentId);
      if (!adapter || !this.deps.registry.isAvailable(currentAgentId)) {
        const next = this.deps.router.selectNextFallback(Array.from(triedAgents));
        if (!next) {
          return {
            ok: false,
            errorMessage: `Agent "${currentAgentId}" 不可用且无可用备选 Agent`,
          };
        }
        await this.recordFallback(
          taskId,
          currentAgentId,
          next,
          stage,
          `Agent "${currentAgentId}" unavailable`,
          'runtime_error',
        );
        currentAgentId = next;
        continue;
      }

      const run = this.deps.repo.createRun({
        taskId,
        stage,
        agentId: currentAgentId,
        attempt,
      });

      const res = await adapter.execute({
        taskId,
        runId: run.id,
        stage,
        cwd,
        branchName,
        prompt,
        onLog: (stream, message) => {
          this.deps.repo.appendLog(taskId, run.id, stream, message);
        },
      });

      this.deps.repo.finishRun(run.id, {
        status: res.success ? 'succeeded' : 'failed',
        errorKind: res.errorKind,
        exitCode: res.exitCode ?? undefined,
        tokensUsed: res.tokensUsed,
        costUsd: res.costUsd,
        summary: res.outputText.slice(0, 300),
      });

      if (res.success) {
        return { ok: true, usedAgent: currentAgentId, result: res };
      }

      // Automatic fallback on quota / rate-limit / auth / timeout / runtime failure
      const next = this.deps.router.selectNextFallback(Array.from(triedAgents));
      if (!next) {
        return {
          ok: false,
          errorMessage: `Agent "${currentAgentId}" 执行失败 (${res.errorKind}) 且已无可用备选 Agent：${res.rawStderr.slice(0, 300)}`,
        };
      }

      await this.recordFallback(
        taskId,
        currentAgentId,
        next,
        stage,
        `Agent "${currentAgentId}" failed with ${res.errorKind}`,
        res.errorKind,
      );
      currentAgentId = next;
      task = this.deps.repo.getTask(taskId)!;
    }
  }

  private async recordFallback(
    taskId: string,
    fromAgent: string,
    toAgent: string,
    stage: string,
    reason: string,
    errorKind: AgentErrorKind,
  ): Promise<void> {
    const task = this.deps.repo.getTask(taskId)!;
    const entry: FallbackAttemptRecord = {
      fromAgent,
      toAgent,
      stage,
      reason,
      errorKind,
      timestamp: new Date().toISOString(),
    };
    const updated = this.deps.repo.updateTask(taskId, {
      assignedAgent: toAgent,
      fallbackCount: task.fallbackCount + 1,
      fallbackHistory: [...task.fallbackHistory, entry],
    });
    await this.emitNotification(
      'agent_fallback',
      updated,
      `Agent 从 "${fromAgent}" 自动降级切换至 "${toAgent}"（阶段: ${stage}，原因: ${errorKind}）`,
    );
  }

  private async runVerificationSuite(
    taskId: string,
    worktreePath: string,
    repoCfg?: RepoConfig,
  ): Promise<{ passed: boolean; markdown: string; failureOutput: string }> {
    const commands: Array<{ label: string; cmd: string }> = [];
    const lintCmd = repoCfg?.lintCommand ?? this.deps.config.workflow.defaultLintCommand;
    const testCmd = repoCfg?.testCommand ?? this.deps.config.workflow.defaultTestCommand;
    const buildCmd = repoCfg?.buildCommand ?? this.deps.config.workflow.defaultBuildCommand;

    if (lintCmd) commands.push({ label: 'Lint', cmd: lintCmd });
    if (testCmd) commands.push({ label: 'Test', cmd: testCmd });
    if (buildCmd) commands.push({ label: 'Build', cmd: buildCmd });

    if (commands.length === 0) {
      return {
        passed: true,
        markdown: '### 本地验证\n未配置显式测试/构建命令，跳过命令行验证。',
        failureOutput: '',
      };
    }

    const run = this.deps.repo.createRun({
      taskId,
      stage: 'testing',
      agentId: 'local-runner',
      attempt: 1,
    });

    const results: Array<{ label: string; cmd: string; exitCode: number | null; output: string }> = [];
    let allPassed = true;
    let failureOutput = '';

    for (const item of commands) {
      this.deps.repo.appendLog(taskId, run.id, 'system', `[Verify:${item.label}] $ ${item.cmd}`);
      const res = await this.deps.workspace.runShellCommand(worktreePath, item.cmd, {
        timeoutMs: 300_000,
        onLog: (stream, line) => this.deps.repo.appendLog(taskId, run.id, stream, line),
      });
      const combined = [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n');
      results.push({ label: item.label, cmd: item.cmd, exitCode: res.exitCode, output: combined });

      if (res.exitCode !== 0 || res.timedOut) {
        allPassed = false;
        failureOutput = `[${item.label}] exit=${String(res.exitCode)}\n${combined}`;
        break;
      }
    }

    this.deps.repo.finishRun(run.id, {
      status: allPassed ? 'succeeded' : 'failed',
      errorKind: allPassed ? 'none' : 'runtime_error',
      summary: allPassed ? 'All verification commands passed' : failureOutput.slice(0, 200),
    });

    const markdown = [
      `## 本地构建与测试报告 — ${allPassed ? '全部通过' : '存在失败'}`,
      ...results.map(
        (r) =>
          `### ${r.label}: \`${r.cmd}\` (exit=${String(r.exitCode)})\n\`\`\`\n${r.output.slice(-2000) || '(no output)'}\n\`\`\``,
      ),
    ].join('\n\n');

    return { passed: allPassed, markdown, failureOutput };
  }

  private async runCrossReview(
    task: TaskRecord,
    specContent: string,
    diffText: string,
    testReport: string,
  ): Promise<CrossReviewResult> {
    const reviewerId = task.reviewerAgent ?? task.assignedAgent ?? 'reviewer';
    const run = this.deps.repo.createRun({
      taskId: task.id,
      stage: 'cross_review',
      agentId: reviewerId,
      attempt: task.crossReviewRetries + 1,
    });

    try {
      const res = await this.deps.llm.completeJson({
        stage: 'cross_review',
        systemPrompt: [
          `You are an independent Senior Code Reviewer (${reviewerId}), distinct from the author (${task.assignedAgent}).`,
          'Inspect the spec, git diff, and test report rigorously.',
          'Approve ONLY if acceptance criteria are met, tests pass, scope is clean, and there are no critical/major bugs or security vulnerabilities.',
          'Return JSON: { approved, summary, findings: [{ severity, file?, line?, message, suggestion? }], checklist: { acceptanceCriteriaMet, testsAdequate, noObviousSecurityRisks, cleanScope } }.',
        ].join('\n'),
        userPrompt: [
          `Issue #${task.issueNumber}: ${task.issueTitle}`,
          specContent,
          `### Diff\n${diffText.slice(0, 12000)}`,
          `### Test Report\n${testReport.slice(0, 4000)}`,
        ].join('\n\n'),
        schema: CrossReviewResponseSchema,
        cwd: task.worktreePath,
        onLog: (s, m) => this.deps.repo.appendLog(task.id, run.id, s, m),
      });

      this.deps.repo.finishRun(run.id, {
        status: 'succeeded',
        errorKind: 'none',
        tokensUsed: res.tokens,
        costUsd: res.costUsd,
        summary: res.data.summary,
      });
      return res.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.repo.finishRun(run.id, {
        status: 'failed',
        errorKind: 'runtime_error',
        summary: msg,
      });
      return {
        approved: false,
        summary: `Cross-review execution error: ${msg}`,
        findings: [{ severity: 'major', message: msg }],
        checklist: {
          acceptanceCriteriaMet: false,
          testsAdequate: false,
          noObviousSecurityRisks: false,
          cleanScope: false,
        },
      };
    }
  }

  async pollOpenPrs(repoFullNameFilter?: string): Promise<number> {
    const tasks = this.deps.repo.listTasks().filter((t) => {
      if (repoFullNameFilter && t.repoFullName !== repoFullNameFilter) return false;
      return ['PR_OPEN', 'READY_TO_MERGE', 'MERGED', 'RELEASE_PR_OPEN'].includes(t.status);
    });

    let checked = 0;
    for (const task of tasks) {
      await this.runWithTaskLock(task.id, async () => {
        const current = this.deps.repo.getTask(task.id);
        if (!current) return;
        const { owner, repo } = this.splitRepo(current.repoFullName);
        checked += 1;

        if (current.status === 'PR_OPEN' || current.status === 'READY_TO_MERGE') {
          if (!current.prNumber) return;
          const pr = await this.deps.github.getPullRequest(owner, repo, current.prNumber);

          if (pr.merged) {
            const merged = this.deps.repo.transitionTask(
              current.id,
              'MERGED',
              'github',
              `PR #${pr.number} merged`,
            );
            if (this.deps.config.workspace.cleanupOnFinish && merged.worktreePath) {
              await this.deps.workspace
                .cleanupWorkspace(merged.repoFullName, merged.worktreePath)
                .catch(() => undefined);
            }
            await this.syncStatusCard(merged);
            await this.emitNotification('merged', merged, `PR #${pr.number} 已合并`);
            await this.checkReleaseState(merged.id);
            return;
          }

          // Check maintainer PR reviews
          const reviews = await this.deps.github.listPrReviews(owner, repo, pr.number);
          const newReviews = reviews
            .filter((r) => r.id > current.lastProcessedReviewId)
            .sort((a, b) => a.id - b.id);

          for (const review of newReviews) {
            this.deps.repo.updateTask(current.id, { lastProcessedReviewId: review.id });
            if (
              review.state === 'CHANGES_REQUESTED' &&
              isMaintainer(review.author, review.authorAssociation, this.deps.config)
            ) {
              const lineComments = await this.deps.github.listPrReviewComments(
                owner,
                repo,
                pr.number,
              );
              const details = [
                `Reviewer ${review.author} requested changes: ${review.body}`,
                ...lineComments.map((c) => `- ${c.path}:${c.line ?? '?'} ${c.body}`),
              ].join('\n');

              if (current.reviewFixRetries < this.deps.config.workflow.maxReviewFixRetries) {
                const fixing = this.deps.repo.transitionTask(
                  current.id,
                  'REVIEW_FIXING',
                  review.author,
                  `Addressing maintainer review #${review.id}`,
                  { reviewFixRetries: current.reviewFixRetries + 1 },
                );
                await this.emitNotification(
                  'review_requested',
                  fixing,
                  `收到维护者 ${review.author} 的 Review 修改意见，正在自动修复...`,
                );
                await this.executePrFix(fixing.id, 'REVIEW_FIXING', details);
                return;
              }

              await this.escalateNeedsHuman(
                current.id,
                `PR Review 修改意见重试已达上限 (${this.deps.config.workflow.maxReviewFixRetries})`,
              );
              return;
            }
          }

          // Check remote CI runs
          const checkRuns = await this.deps.github.listPrCheckRuns(owner, repo, pr.number);
          const failedChecks = checkRuns.filter(
            (c) =>
              c.status === 'completed' &&
              c.conclusion &&
              ['failure', 'timed_out', 'cancelled'].includes(c.conclusion),
          );

          if (failedChecks.length > 0) {
            const ciSummary = failedChecks
              .map((c) => `- ${c.name} (${c.conclusion}): ${c.outputTitle ?? ''} ${c.outputSummary ?? ''}`)
              .join('\n');

            if (current.ciFixRetries < this.deps.config.workflow.maxCiFixRetries) {
              const fixing = this.deps.repo.transitionTask(
                current.id,
                'CI_FIXING',
                'github-ci',
                `Remote CI failed (${failedChecks.map((c) => c.name).join(', ')})`,
                { ciFixRetries: current.ciFixRetries + 1 },
              );
              await this.emitNotification(
                'ci_failed',
                fixing,
                `PR #${pr.number} 远程 CI 失败，正在自动拉取日志并自愈修复...`,
              );
              await this.executePrFix(fixing.id, 'CI_FIXING', ciSummary);
              return;
            }

            await this.escalateNeedsHuman(
              current.id,
              `远程 CI 连续修复 ${this.deps.config.workflow.maxCiFixRetries} 次仍失败：\n${ciSummary}`,
            );
            return;
          }

          const allPassed =
            checkRuns.length > 0 &&
            checkRuns.every(
              (c) =>
                c.status === 'completed' &&
                (c.conclusion === 'success' || c.conclusion === 'neutral'),
            );

          if (allPassed && current.status === 'PR_OPEN') {
            const ready = this.deps.repo.transitionTask(
              current.id,
              'READY_TO_MERGE',
              'github-ci',
              'All CI checks passed',
            );
            await this.syncStatusCard(ready);

            const autoCfg = this.deps.config.github.autoMergeLowRisk;
            const changedFilesCount = ready.worktreePath
              ? (await this.deps.workspace.getChangedFiles(ready.worktreePath)).length
              : 0;
            const qualifiesAutoMerge =
              autoCfg.enabled &&
              ready.category !== undefined &&
              autoCfg.allowedCategories.includes(ready.category) &&
              (ready.complexityScore ?? 5) <= autoCfg.maxComplexity &&
              changedFilesCount <= autoCfg.maxFilesChanged;

            if (qualifiesAutoMerge && ready.prNumber) {
              const { owner: o, repo: r } = this.splitRepo(ready.repoFullName);
              const res = await this.deps.github.mergePullRequest(
                o,
                r,
                ready.prNumber,
                autoCfg.mergeMethod,
              );
              if (res.merged) {
                const autoMerged = this.deps.repo.transitionTask(
                  ready.id,
                  'MERGED',
                  'auto-merge',
                  'Low-risk PR auto-merged after CI & Cross-Review passed',
                );
                await this.syncStatusCard(autoMerged);
                await this.emitNotification(
                  'merged',
                  autoMerged,
                  `低风险 PR #${ready.prNumber} 已满足规则并自动合并`,
                );
                await this.checkReleaseState(autoMerged.id);
                return;
              }
            }

            await this.emitNotification(
              'ready_to_merge',
              ready,
              `PR #${ready.prNumber} CI 已全绿，可随时合并（或回复 /merge）`,
            );
          }
          return;
        }

        if (current.status === 'MERGED' || current.status === 'RELEASE_PR_OPEN') {
          await this.checkReleaseState(current.id);
        }
      });
    }

    return checked;
  }

  private async runPrFixLoop(
    taskId: string,
    mode: 'CI_FIXING' | 'REVIEW_FIXING',
    feedback: string,
  ): Promise<void> {
    const release = await this.semaphore.acquire();
    try {
      await this.runWithTaskLock(taskId, async () => {
        await this.executePrFix(taskId, mode, feedback);
      });
    } finally {
      release();
    }
  }

  private async executePrFix(
    taskId: string,
    mode: 'CI_FIXING' | 'REVIEW_FIXING',
    feedback: string,
  ): Promise<void> {
    let task = this.deps.repo.getTask(taskId);
    if (!task) return;

    const { owner, repo, cfg } = this.splitRepo(task.repoFullName);
    const baseBranch = cfg?.baseBranch ?? 'main';
    const branchName = task.branchName ?? `dragonflow/issue-${task.issueNumber}`;
    const remoteUrl =
      this.deps.config.workspace.localRepoUrlOverride ||
      (await this.deps.github.getRepoCloneUrl(owner, repo));

    const worktreePath =
      task.worktreePath ||
      (await this.deps.workspace.createTaskWorkspace(
        task.id,
        task.repoFullName,
        remoteUrl,
        branchName,
        baseBranch,
      ));

    const triedAgents = new Set<string>();
    const prompt = [
      `Fix PR #${task.prNumber ?? ''} for Issue #${task.issueNumber} (${task.issueTitle}).`,
      `Mode: ${mode}`,
      `Feedback / Logs to address:\n${feedback}`,
      'Modify code cleanly and verify tests locally without running git push.',
    ].join('\n\n');

    const execRes = await this.executeAgentWithFallback(
      task.id,
      mode.toLowerCase(),
      worktreePath,
      branchName,
      prompt,
      triedAgents,
    );
    if (!execRes.ok) {
      await this.escalateNeedsHuman(task.id, execRes.errorMessage);
      return;
    }

    const testReport = await this.runVerificationSuite(task.id, worktreePath, cfg);
    this.deps.repo.saveArtifact({
      taskId: task.id,
      kind: 'test_report',
      title: `PR 自愈修复验证 (${testReport.passed ? '通过' : '失败'})`,
      content: testReport.markdown,
      metadata: { passed: testReport.passed },
    });

    if (!testReport.passed) {
      await this.escalateNeedsHuman(
        task.id,
        `PR 自愈修复后本地验证未通过：\n${testReport.failureOutput.slice(0, 500)}`,
      );
      return;
    }

    await this.deps.workspace.commitAndPush(
      worktreePath,
      `fix(issue-${task.issueNumber}): address ${mode === 'CI_FIXING' ? 'CI failure' : 'review feedback'}`,
      branchName,
      !this.deps.github.isMock,
    );

    task = this.deps.repo.transitionTask(
      task.id,
      'PR_OPEN',
      'dragonflow',
      `Pushed ${mode} fix to PR #${task.prNumber ?? ''}`,
    );
    await this.syncStatusCard(task);
  }

  private async checkReleaseState(taskId: string): Promise<void> {
    let task = this.deps.repo.getTask(taskId);
    if (!task) return;
    const { owner, repo } = this.splitRepo(task.repoFullName);

    if (task.status === 'MERGED') {
      const openPrs = await this.deps.github.listPullRequests(owner, repo, 'open');
      const releasePr = openPrs.find(
        (pr) =>
          pr.title.startsWith(this.deps.config.release.releasePrTitlePrefix) ||
          pr.headBranch.startsWith(this.deps.config.release.releaseBranchPrefix),
      );
      if (releasePr) {
        task = this.deps.repo.transitionTask(
          task.id,
          'RELEASE_PR_OPEN',
          'release-please',
          `Release PR #${releasePr.number} opened`,
          { releasePrNumber: releasePr.number, releasePrUrl: releasePr.url },
        );
        await this.syncStatusCard(task);
      }
    }

    const releases = await this.deps.github.listReleases(owner, repo);
    const matchingRelease = releases.find(
      (r) => !r.draft && new Date(r.publishedAt).getTime() >= new Date(task!.createdAt).getTime(),
    );

    if (matchingRelease && (task.status === 'MERGED' || task.status === 'RELEASE_PR_OPEN')) {
      const released = this.deps.repo.transitionTask(
        task.id,
        'RELEASED',
        'github-release',
        `Published release ${matchingRelease.tagName}`,
        { releaseTag: matchingRelease.tagName, releaseUrl: matchingRelease.url },
      );
      await this.syncStatusCard(released);
      await this.emitNotification(
        'released',
        released,
        `已包含在版本 ${matchingRelease.tagName} 中正式发布！`,
      );
    }
  }

  private async escalateNeedsHuman(taskId: string, reason: string): Promise<void> {
    const task = this.deps.repo.getTask(taskId);
    if (!task) return;
    const { owner, repo } = this.splitRepo(task.repoFullName);
    await this.deps.github
      .addLabels(owner, repo, task.issueNumber, [this.deps.config.github.needsHumanLabel])
      .catch(() => undefined);

    const updated = this.deps.repo.transitionTask(
      task.id,
      'NEEDS_HUMAN',
      'dragonflow',
      reason,
      { lastError: reason },
    );
    await this.syncStatusCard(updated);
    await this.emitNotification('needs_human', updated, reason);
  }

  private async syncStatusCard(task: TaskRecord, triage?: TriageResult): Promise<void> {
    const { owner, repo } = this.splitRepo(task.repoFullName);
    const lines = [
      `### 🐉 DragonFlow 自动化研发状态看板`,
      `| 字段 | 当前值 |`,
      `| :--- | :--- |`,
      `| **状态** | \`${task.status}\` |`,
      `| **研发流** | \`${task.tier}\` |`,
      `| **分类 / 复杂度** | \`${task.category ?? '-'}\` / ${task.complexityScore ?? '-'}/5 |`,
      `| **执行 Agent** | \`${task.assignedAgent ?? '待分配'}\` (降级切换: ${task.fallbackCount} 次) |`,
      `| **Review Agent** | \`${task.reviewerAgent ?? '待分配'}\` |`,
      task.prUrl ? `| **Pull Request** | [#${task.prNumber}](${task.prUrl}) |` : null,
      task.releasePrUrl
        ? `| **Release PR** | [#${task.releasePrNumber}](${task.releasePrUrl}) |`
        : null,
      task.releaseTag
        ? `| **正式发布** | [${task.releaseTag}](${task.releaseUrl}) |`
        : null,
    ].filter(Boolean);

    if (task.routingRationale) {
      lines.push('', `> **路由理由**: ${task.routingRationale}`);
    }

    if (triage && triage.clarifyingQuestions.length > 0 && task.status === 'AWAITING_INFO') {
      lines.push(
        '',
        '#### ❓ 需要补充以下信息后才能继续：',
        ...triage.clarifyingQuestions.map((q) => `- ${q}`),
      );
    }

    if (task.status === 'AWAITING_TRIGGER') {
      lines.push(
        '',
        `> 维护者可添加标签 \`${this.deps.config.github.triggerLabel}\` 或回复 \`/auto\`（也可指定 \`/auto claude\`）启动自动研发。`,
      );
    } else if (task.status === 'AWAITING_PLAN_APPROVAL') {
      const plan = this.deps.repo.getLatestArtifact(task.id, 'plan');
      if (plan) {
        lines.push('', '<details><summary>📋 点击展开技术方案与测试计划</summary>', '', plan.content, '', '</details>');
      }
      lines.push('', '> 维护者请回复 `/approve` 确认并启动编码，或回复 `/reject <修改建议>` 修订方案。');
    } else if (task.status === 'READY_TO_MERGE') {
      lines.push('', '> PR 检查已全部通过！请点击合并或回复 `/merge` 完成合入。');
    } else if (task.status === 'NEEDS_HUMAN' && task.lastError) {
      lines.push('', `> ⚠️ **需要人工介入**: ${task.lastError}\n> 可回复 \`/retry\` 重新执行。`);
    }

    try {
      const commentId = await this.deps.github.upsertStatusCard(
        owner,
        repo,
        task.issueNumber,
        lines.join('\n'),
        task.statusCommentId,
      );
      if (commentId !== task.statusCommentId) {
        this.deps.repo.updateTask(task.id, { statusCommentId: commentId });
      }
    } catch {
      // ignore GitHub comment rate-limit/errors to avoid halting state machine
    }
  }

  private formatCommitPrefix(category?: string): string {
    switch (category) {
      case 'feature':
        return 'feat';
      case 'docs':
        return 'docs';
      case 'refactor':
        return 'refactor';
      case 'chore':
        return 'chore';
      default:
        return 'fix';
    }
  }

  private buildPrBody(task: TaskRecord, changedFiles: string[]): string {
    const spec = this.deps.repo.getLatestArtifact(task.id, 'spec')?.content ?? '';
    const review = this.deps.repo.getLatestArtifact(task.id, 'review')?.content ?? '';
    const testReport = this.deps.repo.getLatestArtifact(task.id, 'test_report')?.content ?? '';

    return [
      `## Summary`,
      `Automated implementation by **DragonFlow** (\`${task.assignedAgent ?? 'agent'}\`, tier=\`${task.tier}\`).`,
      '',
      `Closes #${task.issueNumber}`,
      '',
      changedFiles.length > 0
        ? `### Changed Files\n${changedFiles.map((f) => `- \`${f}\``).join('\n')}`
        : '',
      spec,
      testReport ? `<details><summary>Test Verification Report</summary>\n\n${testReport}\n\n</details>` : '',
      review ? `<details><summary>Independent Cross-Review (${task.reviewerAgent ?? 'reviewer'})</summary>\n\n${review}\n\n</details>` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private formatReviewMarkdown(review: CrossReviewResult, reviewerAgent: string): string {
    const lines = [
      `## 独立交叉 Review 报告 (\`${reviewerAgent}\`)`,
      `- **结论**: ${review.approved ? '✅ 通过 (Approved)' : '❌ 需修改 (Changes Requested)'}`,
      `- **摘要**: ${review.summary}`,
      '',
      `### 检查清单`,
      `- 满足验收标准: ${review.checklist.acceptanceCriteriaMet ? '✅' : '❌'}`,
      `- 测试覆盖充分: ${review.checklist.testsAdequate ? '✅' : '❌'}`,
      `- 无明显安全风险: ${review.checklist.noObviousSecurityRisks ? '✅' : '❌'}`,
      `- 改动范围聚焦: ${review.checklist.cleanScope ? '✅' : '❌'}`,
    ];

    if (review.findings.length > 0) {
      lines.push(
        '',
        '### Review 发现问题',
        ...review.findings.map(
          (f) =>
            `- **[${f.severity.toUpperCase()}]** ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\` ` : ''}${f.message}${f.suggestion ? `（建议：${f.suggestion}）` : ''}`,
        ),
      );
    }

    return lines.join('\n');
  }
}
