import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  canTransition,
  isTerminalStatus,
  type AgentErrorKind,
  type ArtifactKind,
  type AuditEventRecord,
  type DashboardOverview,
  type FallbackAttemptRecord,
  type GitHubIssue,
  type IssueCategory,
  type TaskArtifact,
  type TaskLogEntry,
  type TaskRecord,
  type TaskRunRecord,
  type TaskStatus,
  type WorkflowTier,
} from '@dragonflow/shared';
import type { DragonFlowEventBus } from '../events/event-bus.js';

interface TaskRow {
  id: string;
  repo_full_name: string;
  issue_number: number;
  issue_title: string;
  issue_body: string;
  issue_url: string;
  issue_author: string;
  labels_json: string;
  status: string;
  tier: string;
  category: string | null;
  complexity_score: number | null;
  assigned_agent: string | null;
  reviewer_agent: string | null;
  fallback_count: number;
  fallback_history_json: string;
  routing_rationale: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  pr_number: number | null;
  pr_url: string | null;
  release_pr_number: number | null;
  release_pr_url: string | null;
  release_tag: string | null;
  release_url: string | null;
  status_comment_id: number | null;
  local_fix_retries: number;
  cross_review_retries: number;
  ci_fix_retries: number;
  review_fix_retries: number;
  last_processed_comment_id: number;
  last_processed_review_id: number;
  total_tokens: number;
  estimated_cost_usd: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskPatch {
  issueTitle?: string;
  issueBody?: string;
  labels?: string[];
  tier?: WorkflowTier;
  category?: IssueCategory;
  complexityScore?: number;
  assignedAgent?: string;
  reviewerAgent?: string;
  fallbackCount?: number;
  fallbackHistory?: FallbackAttemptRecord[];
  routingRationale?: string;
  branchName?: string;
  worktreePath?: string;
  prNumber?: number;
  prUrl?: string;
  releasePrNumber?: number;
  releasePrUrl?: string;
  releaseTag?: string;
  releaseUrl?: string;
  statusCommentId?: number;
  localFixRetries?: number;
  crossReviewRetries?: number;
  ciFixRetries?: number;
  reviewFixRetries?: number;
  lastProcessedCommentId?: number;
  lastProcessedReviewId?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  lastError?: string | null;
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    repoFullName: row.repo_full_name,
    issueNumber: row.issue_number,
    issueTitle: row.issue_title,
    issueBody: row.issue_body,
    issueUrl: row.issue_url,
    issueAuthor: row.issue_author,
    labels: JSON.parse(row.labels_json) as string[],
    status: row.status as TaskStatus,
    tier: row.tier as WorkflowTier,
    category: (row.category ?? undefined) as IssueCategory | undefined,
    complexityScore: row.complexity_score ?? undefined,
    assignedAgent: row.assigned_agent ?? undefined,
    reviewerAgent: row.reviewer_agent ?? undefined,
    fallbackCount: row.fallback_count,
    fallbackHistory: JSON.parse(row.fallback_history_json) as FallbackAttemptRecord[],
    routingRationale: row.routing_rationale ?? undefined,
    branchName: row.branch_name ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    prNumber: row.pr_number ?? undefined,
    prUrl: row.pr_url ?? undefined,
    releasePrNumber: row.release_pr_number ?? undefined,
    releasePrUrl: row.release_pr_url ?? undefined,
    releaseTag: row.release_tag ?? undefined,
    releaseUrl: row.release_url ?? undefined,
    statusCommentId: row.status_comment_id ?? undefined,
    localFixRetries: row.local_fix_retries,
    crossReviewRetries: row.cross_review_retries,
    ciFixRetries: row.ci_fix_retries,
    reviewFixRetries: row.review_fix_retries,
    lastProcessedCommentId: row.last_processed_comment_id,
    lastProcessedReviewId: row.last_processed_review_id,
    totalTokens: row.total_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DragonFlowRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly eventBus?: DragonFlowEventBus,
  ) {}

  upsertTaskFromIssue(
    repoFullName: string,
    issue: GitHubIssue,
  ): { task: TaskRecord; created: boolean } {
    const existing = this.getTaskByRepoIssue(repoFullName, issue.number);
    const now = new Date().toISOString();

    if (existing) {
      this.db
        .prepare(
          `UPDATE tasks
           SET issue_title = ?, issue_body = ?, issue_url = ?, labels_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          issue.title,
          issue.body,
          issue.url,
          JSON.stringify(issue.labels),
          now,
          existing.id,
        );
      const updated = this.getTask(existing.id)!;
      this.eventBus?.emitEvent({ type: 'task:updated', task: updated });
      return { task: updated, created: false };
    }

    const id = `task-${randomUUID().slice(0, 12)}`;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (
            id, repo_full_name, issue_number, issue_title, issue_body, issue_url,
            issue_author, labels_json, status, tier, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW', 'quick_fix', ?, ?)`,
        )
        .run(
          id,
          repoFullName,
          issue.number,
          issue.title,
          issue.body,
          issue.url,
          issue.author,
          JSON.stringify(issue.labels),
          now,
          now,
        );

      this.db
        .prepare(
          `INSERT INTO events_audit (task_id, from_status, to_status, actor, reason, created_at)
           VALUES (?, NULL, 'NEW', 'system', 'Issue ingested', ?)`,
        )
        .run(id, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const created = this.getTask(id)!;
    this.eventBus?.emitEvent({ type: 'task:updated', task: created });
    this.eventBus?.emitEvent({
      type: 'task:transitioned',
      taskId: id,
      fromStatus: null,
      toStatus: 'NEW',
      actor: 'system',
      reason: 'Issue ingested',
      timestamp: now,
    });
    return { task: created, created: true };
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  getTaskByRepoIssue(repoFullName: string, issueNumber: number): TaskRecord | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE repo_full_name = ? AND issue_number = ?')
      .get(repoFullName, issueNumber) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  listTasks(filters?: { status?: TaskStatus; search?: string }): TaskRecord[] {
    let sql = 'SELECT * FROM tasks';
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filters?.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.search?.trim()) {
      clauses.push('(issue_title LIKE ? OR CAST(issue_number AS TEXT) LIKE ?)');
      const term = `%${filters.search.trim()}%`;
      params.push(term, term);
    }

    if (clauses.length > 0) {
      sql += ` WHERE ${clauses.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(sql).all(...params) as unknown as TaskRow[];
    return rows.map(rowToTask);
  }

  updateTask(id: string, patch: TaskPatch): TaskRecord {
    const current = this.getTask(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }

    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    const setCol = (col: string, val: string | number | null) => {
      assignments.push(`${col} = ?`);
      values.push(val);
    };

    if (patch.issueTitle !== undefined) setCol('issue_title', patch.issueTitle);
    if (patch.issueBody !== undefined) setCol('issue_body', patch.issueBody);
    if (patch.labels !== undefined) setCol('labels_json', JSON.stringify(patch.labels));
    if (patch.tier !== undefined) setCol('tier', patch.tier);
    if (patch.category !== undefined) setCol('category', patch.category);
    if (patch.complexityScore !== undefined) setCol('complexity_score', patch.complexityScore);
    if (patch.assignedAgent !== undefined) setCol('assigned_agent', patch.assignedAgent);
    if (patch.reviewerAgent !== undefined) setCol('reviewer_agent', patch.reviewerAgent);
    if (patch.fallbackCount !== undefined) setCol('fallback_count', patch.fallbackCount);
    if (patch.fallbackHistory !== undefined) {
      setCol('fallback_history_json', JSON.stringify(patch.fallbackHistory));
    }
    if (patch.routingRationale !== undefined) setCol('routing_rationale', patch.routingRationale);
    if (patch.branchName !== undefined) setCol('branch_name', patch.branchName);
    if (patch.worktreePath !== undefined) setCol('worktree_path', patch.worktreePath);
    if (patch.prNumber !== undefined) setCol('pr_number', patch.prNumber);
    if (patch.prUrl !== undefined) setCol('pr_url', patch.prUrl);
    if (patch.releasePrNumber !== undefined) setCol('release_pr_number', patch.releasePrNumber);
    if (patch.releasePrUrl !== undefined) setCol('release_pr_url', patch.releasePrUrl);
    if (patch.releaseTag !== undefined) setCol('release_tag', patch.releaseTag);
    if (patch.releaseUrl !== undefined) setCol('release_url', patch.releaseUrl);
    if (patch.statusCommentId !== undefined) setCol('status_comment_id', patch.statusCommentId);
    if (patch.localFixRetries !== undefined) setCol('local_fix_retries', patch.localFixRetries);
    if (patch.crossReviewRetries !== undefined) setCol('cross_review_retries', patch.crossReviewRetries);
    if (patch.ciFixRetries !== undefined) setCol('ci_fix_retries', patch.ciFixRetries);
    if (patch.reviewFixRetries !== undefined) setCol('review_fix_retries', patch.reviewFixRetries);
    if (patch.lastProcessedCommentId !== undefined) {
      setCol('last_processed_comment_id', patch.lastProcessedCommentId);
    }
    if (patch.lastProcessedReviewId !== undefined) {
      setCol('last_processed_review_id', patch.lastProcessedReviewId);
    }
    if (patch.totalTokens !== undefined) setCol('total_tokens', patch.totalTokens);
    if (patch.estimatedCostUsd !== undefined) setCol('estimated_cost_usd', patch.estimatedCostUsd);
    if (patch.lastError !== undefined) setCol('last_error', patch.lastError);

    setCol('updated_at', new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    const updated = this.getTask(id)!;
    this.eventBus?.emitEvent({ type: 'task:updated', task: updated });
    return updated;
  }

  transitionTask(
    id: string,
    toStatus: TaskStatus,
    actor: string,
    reason: string,
    extraPatch?: TaskPatch,
  ): TaskRecord {
    const current = this.getTask(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    if (!canTransition(current.status, toStatus)) {
      throw new Error(`Invalid state transition: ${current.status} -> ${toStatus} for task ${id}`);
    }

    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run(toStatus, now, id);
      this.db
        .prepare(
          `INSERT INTO events_audit (task_id, from_status, to_status, actor, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, current.status, toStatus, actor, reason, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const updated = extraPatch ? this.updateTask(id, extraPatch) : this.getTask(id)!;
    if (!extraPatch) {
      this.eventBus?.emitEvent({ type: 'task:updated', task: updated });
    }
    this.eventBus?.emitEvent({
      type: 'task:transitioned',
      taskId: id,
      fromStatus: current.status,
      toStatus,
      actor,
      reason,
      timestamp: now,
    });
    return updated;
  }

  addUsage(taskId: string, tokensDelta: number, costDeltaUsd: number): TaskRecord {
    const current = this.getTask(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    return this.updateTask(taskId, {
      totalTokens: current.totalTokens + Math.max(0, Math.round(tokensDelta)),
      estimatedCostUsd: Number((current.estimatedCostUsd + Math.max(0, costDeltaUsd)).toFixed(6)),
    });
  }

  createRun(input: { taskId: string; stage: string; agentId: string; attempt: number }): TaskRunRecord {
    const id = `run-${randomUUID().slice(0, 12)}`;
    const startedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO task_runs (id, task_id, stage, agent_id, attempt, status, error_kind, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', 'none', ?)`,
      )
      .run(id, input.taskId, input.stage, input.agentId, input.attempt, startedAt);

    const run = this.getRun(id)!;
    this.eventBus?.emitEvent({ type: 'run:started', run });
    return run;
  }

  finishRun(
    runId: string,
    result: {
      status: 'succeeded' | 'failed';
      errorKind: AgentErrorKind;
      exitCode?: number;
      tokensUsed?: number;
      costUsd?: number;
      summary?: string;
    },
  ): TaskRunRecord {
    const current = this.getRun(runId);
    if (!current) throw new Error(`Run not found: ${runId}`);

    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(finishedAt).getTime() - new Date(current.startedAt).getTime(),
    );

    this.db
      .prepare(
        `UPDATE task_runs
         SET status = ?, error_kind = ?, exit_code = ?, tokens_used = ?, cost_usd = ?,
             summary = ?, finished_at = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.errorKind,
        result.exitCode ?? null,
        result.tokensUsed ?? 0,
        result.costUsd ?? 0,
        result.summary ?? null,
        finishedAt,
        durationMs,
        runId,
      );

    if ((result.tokensUsed ?? 0) > 0 || (result.costUsd ?? 0) > 0) {
      this.addUsage(current.taskId, result.tokensUsed ?? 0, result.costUsd ?? 0);
    }

    const updated = this.getRun(runId)!;
    this.eventBus?.emitEvent({ type: 'run:finished', run: updated });
    return updated;
  }

  getRun(runId: string): TaskRunRecord | null {
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      stage: row.stage as string,
      agentId: row.agent_id as string,
      attempt: row.attempt as number,
      status: row.status as 'running' | 'succeeded' | 'failed',
      errorKind: row.error_kind as AgentErrorKind,
      exitCode: (row.exit_code as number | null) ?? undefined,
      tokensUsed: row.tokens_used as number,
      costUsd: row.cost_usd as number,
      summary: (row.summary as string | null) ?? undefined,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? undefined,
      durationMs: (row.duration_ms as number | null) ?? undefined,
    };
  }

  listRuns(taskId: string): TaskRunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at ASC')
      .all(taskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      taskId: row.task_id as string,
      stage: row.stage as string,
      agentId: row.agent_id as string,
      attempt: row.attempt as number,
      status: row.status as 'running' | 'succeeded' | 'failed',
      errorKind: row.error_kind as AgentErrorKind,
      exitCode: (row.exit_code as number | null) ?? undefined,
      tokensUsed: row.tokens_used as number,
      costUsd: row.cost_usd as number,
      summary: (row.summary as string | null) ?? undefined,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? undefined,
      durationMs: (row.duration_ms as number | null) ?? undefined,
    }));
  }

  saveArtifact(input: {
    taskId: string;
    kind: ArtifactKind;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): TaskArtifact {
    const id = `art-${randomUUID().slice(0, 12)}`;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO task_artifacts (id, task_id, kind, title, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.kind,
        input.title,
        input.content,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      );

    const artifact: TaskArtifact = {
      id,
      taskId: input.taskId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
      createdAt,
    };
    this.eventBus?.emitEvent({ type: 'artifact:created', artifact });
    return artifact;
  }

  listArtifacts(taskId: string): TaskArtifact[] {
    const rows = this.db
      .prepare('SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      taskId: row.task_id as string,
      kind: row.kind as ArtifactKind,
      title: row.title as string,
      content: row.content as string,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as string,
    }));
  }

  getLatestArtifact(taskId: string, kind: ArtifactKind): TaskArtifact | null {
    const row = this.db
      .prepare(
        'SELECT * FROM task_artifacts WHERE task_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(taskId, kind) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      kind: row.kind as ArtifactKind,
      title: row.title as string,
      content: row.content as string,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as string,
    };
  }

  appendLog(
    taskId: string,
    runId: string,
    stream: 'stdout' | 'stderr' | 'system',
    message: string,
  ): TaskLogEntry {
    const timestamp = new Date().toISOString();
    const res = this.db
      .prepare(
        `INSERT INTO task_logs (task_id, run_id, stream, message, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(taskId, runId, stream, message, timestamp);

    const entry: TaskLogEntry = {
      id: Number(res.lastInsertRowid),
      taskId,
      runId,
      stream,
      message,
      timestamp,
    };
    this.eventBus?.emitEvent({ type: 'log:chunk', entry });
    return entry;
  }

  listLogs(taskId: string, limit = 500, afterId = 0): TaskLogEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM task_logs WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
      )
      .all(taskId, afterId, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      taskId: row.task_id as string,
      runId: row.run_id as string,
      stream: row.stream as 'stdout' | 'stderr' | 'system',
      message: row.message as string,
      timestamp: row.timestamp as string,
    }));
  }

  listAuditEvents(taskId: string): AuditEventRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM events_audit WHERE task_id = ? ORDER BY id ASC')
      .all(taskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      taskId: row.task_id as string,
      fromStatus: (row.from_status as TaskStatus | null) ?? null,
      toStatus: row.to_status as TaskStatus,
      actor: row.actor as string,
      reason: row.reason as string,
      createdAt: row.created_at as string,
    }));
  }

  getPollerState(repoFullName: string): { lastIssuePollAt?: string; lastPrPollAt?: string } {
    const row = this.db
      .prepare('SELECT * FROM poller_state WHERE repo_full_name = ?')
      .get(repoFullName) as Record<string, unknown> | undefined;
    if (!row) return {};
    return {
      lastIssuePollAt: (row.last_issue_poll_at as string | null) ?? undefined,
      lastPrPollAt: (row.last_pr_poll_at as string | null) ?? undefined,
    };
  }

  savePollerState(
    repoFullName: string,
    state: { lastIssuePollAt?: string; lastPrPollAt?: string },
  ): void {
    const current = this.getPollerState(repoFullName);
    this.db
      .prepare(
        `INSERT INTO poller_state (repo_full_name, last_issue_poll_at, last_pr_poll_at)
         VALUES (?, ?, ?)
         ON CONFLICT(repo_full_name) DO UPDATE SET
           last_issue_poll_at = excluded.last_issue_poll_at,
           last_pr_poll_at = excluded.last_pr_poll_at`,
      )
      .run(
        repoFullName,
        state.lastIssuePollAt ?? current.lastIssuePollAt ?? null,
        state.lastPrPollAt ?? current.lastPrPollAt ?? null,
      );
  }

  getDashboardOverview(meta: {
    mode: 'live' | 'demo';
    repoFullName: string;
    availableAgentsCount: number;
    totalAgentsCount: number;
  }): DashboardOverview {
    const tasks = this.listTasks();
    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let activeTasks = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let successCount = 0;
    let finishedCount = 0;

    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.assignedAgent) {
        byAgent[t.assignedAgent] = (byAgent[t.assignedAgent] ?? 0) + 1;
      }
      if (
        !isTerminalStatus(t.status) &&
        t.status !== 'AWAITING_INFO' &&
        t.status !== 'AWAITING_TRIGGER' &&
        t.status !== 'NEEDS_HUMAN'
      ) {
        activeTasks += 1;
      }
      totalTokens += t.totalTokens;
      estimatedCostUsd += t.estimatedCostUsd;

      if (t.status === 'MERGED' || t.status === 'RELEASE_PR_OPEN' || t.status === 'RELEASED') {
        successCount += 1;
        finishedCount += 1;
      } else if (t.status === 'FAILED' || t.status === 'NEEDS_HUMAN') {
        finishedCount += 1;
      }
    }

    const avgRow = this.db
      .prepare('SELECT AVG(duration_ms) as avg_ms FROM task_runs WHERE duration_ms IS NOT NULL')
      .get() as { avg_ms: number | null } | undefined;

    return {
      totalTasks: tasks.length,
      activeTasks,
      byStatus,
      byAgent,
      successRate: finishedCount > 0 ? Number(((successCount / finishedCount) * 100).toFixed(1)) : 100,
      avgDurationMs: Math.round(avgRow?.avg_ms ?? 0),
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      mode: meta.mode,
      repoFullName: meta.repoFullName,
      availableAgentsCount: meta.availableAgentsCount,
      totalAgentsCount: meta.totalAgentsCount,
    };
  }
}
