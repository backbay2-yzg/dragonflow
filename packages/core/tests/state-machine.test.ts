import { describe, expect, it } from 'vitest';
import { canTransition } from '@dragonflow/shared';
import { DragonFlowDatabase, DragonFlowEventBus, DragonFlowRepository } from '../src/index.js';

describe('State Machine & SQLite Repository', () => {
  it('enforces valid state transitions and persists audit trail', () => {
    expect(canTransition('NEW', 'TRIAGING')).toBe(true);
    expect(canTransition('NEW', 'PR_OPEN')).toBe(false);
    expect(canTransition('RELEASED', 'IMPLEMENTING')).toBe(false);

    const database = new DragonFlowDatabase(':memory:');
    const eventBus = new DragonFlowEventBus();
    const events: string[] = [];
    const unsub = eventBus.subscribe((e) => events.push(e.type));

    const repo = new DragonFlowRepository(database.db, eventBus);
    const { task, created } = repo.upsertTaskFromIssue('acme/oss', {
      number: 42,
      title: 'Fix memory leak in parser',
      body: 'Steps to reproduce...',
      author: 'alice',
      authorAssociation: 'NONE',
      labels: ['bug'],
      state: 'open',
      url: 'https://github.com/acme/oss/issues/42',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(created).toBe(true);
    expect(task.status).toBe('NEW');

    const t1 = repo.transitionTask(task.id, 'TRIAGING', 'dragonflow', 'Start triage');
    expect(t1.status).toBe('TRIAGING');

    expect(() =>
      repo.transitionTask(task.id, 'RELEASED', 'dragonflow', 'Invalid jump'),
    ).toThrow(/Invalid state transition/);

    repo.transitionTask(task.id, 'ROUTING', 'dragonflow', 'Owner fast-track');
    repo.transitionTask(task.id, 'IMPLEMENTING', 'router', 'Quick fix', {
      assignedAgent: 'claude',
      reviewerAgent: 'qodercli',
    });

    const run = repo.createRun({
      taskId: task.id,
      stage: 'implementing',
      agentId: 'claude',
      attempt: 1,
    });
    repo.appendLog(task.id, run.id, 'stdout', 'Editing src/parser.ts');
    repo.finishRun(run.id, {
      status: 'succeeded',
      errorKind: 'none',
      tokensUsed: 1200,
      costUsd: 0.02,
      summary: 'Fixed buffer cleanup',
    });

    repo.saveArtifact({
      taskId: task.id,
      kind: 'spec',
      title: 'Quick Spec',
      content: '# Spec',
    });

    const audits = repo.listAuditEvents(task.id);
    expect(audits.map((a) => a.toStatus)).toEqual(['NEW', 'TRIAGING', 'ROUTING', 'IMPLEMENTING']);
    expect(repo.listLogs(task.id)).toHaveLength(1);
    expect(repo.listArtifacts(task.id)).toHaveLength(1);
    expect(repo.getTask(task.id)?.totalTokens).toBe(1200);

    const overview = repo.getDashboardOverview({
      mode: 'demo',
      repoFullName: 'acme/oss',
      availableAgentsCount: 2,
      totalAgentsCount: 8,
    });
    expect(overview.totalTasks).toBe(1);
    expect(overview.activeTasks).toBe(1);
    expect(overview.byAgent.claude).toBe(1);
    expect(events).toContain('task:transitioned');
    expect(events).toContain('log:chunk');

    unsub();
    database.close();
  });
});
