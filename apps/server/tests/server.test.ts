import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  AgentRouter,
  DEFAULT_AGENT_PRESETS,
  DragonFlowDatabase,
  DragonFlowEventBus,
  DragonFlowOrchestrator,
  DragonFlowRepository,
  GitHubWebhookHandler,
  GitWorktreeRunner,
  InMemoryGitHubClient,
  IssueTriageService,
  MockCodingAgentAdapter,
  MockStructuredLlmClient,
  NotificationDispatcher,
  parseConfigFromYaml,
} from '@dragonflow/core';
import { createServerApp } from '../src/app.js';

const execFileAsync = promisify(execFile);

async function createTestServerHarness() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'dragonflow-srv-'));
  const bareRepo = path.join(tmp, 'origin.git');
  const seedRepo = path.join(tmp, 'seed');
  await execFileAsync('git', ['init', '--bare', bareRepo], { cwd: tmp });
  await execFileAsync('git', ['clone', bareRepo, seedRepo], { cwd: tmp });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: seedRepo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: seedRepo });
  await execFileAsync('git', ['checkout', '-B', 'main'], { cwd: seedRepo });
  await writeFile(
    path.join(seedRepo, 'package.json'),
    JSON.stringify({ name: 'demo', version: '0.1.0', type: 'module', scripts: { test: 'node -e "process.exit(0)"' } }),
    'utf8',
  );
  await execFileAsync('git', ['add', '-A'], { cwd: seedRepo });
  await execFileAsync('git', ['commit', '-m', 'chore: init'], { cwd: seedRepo });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: seedRepo });

  const config = parseConfigFromYaml(`
project:
  name: DragonFlow-Server-Test
  mode: demo
github:
  triggerLabel: auto-dev
  ownerFastTrack: true
  repositories:
    - owner: dragonflow-org
      repo: awesome-oss
      baseBranch: main
      testCommand: "node -e \\"process.exit(0)\\""
workflow:
  quickFixMaxComplexity: 2
  requirePlanApprovalForFullSdlc: true
  defaultTestCommand: "node -e \\"process.exit(0)\\""
workspace:
  reposRoot: "${path.join(tmp, 'repos').replaceAll('\\', '/')}"
  worktreeRoot: "${path.join(tmp, 'worktrees').replaceAll('\\', '/')}"
  localRepoUrlOverride: "${bareRepo.replaceAll('\\', '/')}"
`);

  const database = new DragonFlowDatabase(':memory:');
  const eventBus = new DragonFlowEventBus();
  const repo = new DragonFlowRepository(database.db, eventBus);
  const github = new InMemoryGitHubClient(bareRepo);
  const registry = new AgentRegistry(
    DEFAULT_AGENT_PRESETS,
    eventBus,
    (profile) =>
      new MockCodingAgentAdapter(
        profile,
        ['claude', 'qodercli'].includes(profile.id),
        async (ctx) => {
          await writeFile(path.join(ctx.cwd, 'CHANGELOG.md'), `Updated by ${profile.id}\n`, 'utf8');
          return { success: true, outputText: 'ok' };
        },
      ),
  );
  await registry.probeAll();

  const llm = new MockStructuredLlmClient();
  const triageService = new IssueTriageService(llm, config.workflow.quickFixMaxComplexity);
  const router = new AgentRouter(config, registry, llm);
  const workspace = new GitWorktreeRunner(config.workspace.reposRoot, config.workspace.worktreeRoot);
  const notifier = new NotificationDispatcher([]);
  const orchestrator = new DragonFlowOrchestrator({
    config,
    repo,
    github,
    triageService,
    router,
    llm,
    registry,
    workspace,
    notifier,
    eventBus,
  });

  const secret = 'srv-webhook-secret';
  const webhookHandler = new GitHubWebhookHandler(orchestrator, secret);
  const app = createServerApp({
    config,
    mode: 'demo',
    dbPath: ':memory:',
    repo,
    eventBus,
    registry,
    orchestrator,
    github,
    webhookHandler,
  });

  return { tmp, app, database, orchestrator, secret };
}

describe('DragonFlow HTTP Server & SSE API', () => {
  const dirs: string[] = [];
  const dbs: DragonFlowDatabase[] = [];

  afterEach(async () => {
    for (const db of dbs) db.close();
    dbs.length = 0;
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true }).catch(() => undefined);
    }
    dirs.length = 0;
  });

  it('serves health, agents, sanitized config, SSE stream, webhook verification, and task lifecycle', async () => {
    const { tmp, app, database, orchestrator, secret } = await createTestServerHarness();
    dirs.push(tmp);
    dbs.push(database);

    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; mode: string };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.mode).toBe('demo');

    const agentsRes = await app.request('/api/agents');
    expect(agentsRes.status).toBe(200);
    const agentsJson = (await agentsRes.json()) as { agents: Array<{ id: string; available: boolean }> };
    expect(agentsJson.agents.find((a) => a.id === 'claude')?.available).toBe(true);

    const cfgRes = await app.request('/api/config');
    expect(cfgRes.status).toBe(200);
    const cfgJson = (await cfgRes.json()) as { config: { github: { tokenConfigured: boolean } } };
    expect(typeof cfgJson.config.github.tokenConfigured).toBe('boolean');

    // Simulate full_sdlc issue -> pauses at AWAITING_PLAN_APPROVAL
    const simRes = await app.request('/api/demo/simulate-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierPreset: 'full_sdlc', autoTrigger: true }),
    });
    expect(simRes.status).toBe(201);
    const simJson = (await simRes.json()) as { task: { id: string } };
    await orchestrator.waitForIdle();

    const detail1 = await app.request(`/api/tasks/${simJson.task.id}`);
    const detail1Json = (await detail1.json()) as { task: { status: string }; artifacts: unknown[] };
    expect(detail1Json.task.status).toBe('AWAITING_PLAN_APPROVAL');
    expect(detail1Json.artifacts.length).toBeGreaterThanOrEqual(3);

    // Approve plan -> completes implementation & opens PR
    const approveRes = await app.request(`/api/tasks/${simJson.task.id}/approve-plan`, {
      method: 'POST',
    });
    expect(approveRes.status).toBe(200);
    await orchestrator.waitForIdle();

    const detail2 = await app.request(`/api/tasks/${simJson.task.id}`);
    const detail2Json = (await detail2.json()) as { task: { status: string; prNumber?: number } };
    expect(detail2Json.task.status).toBe('PR_OPEN');
    expect(detail2Json.task.prNumber).toBeDefined();

    // Logs & overview
    const logsRes = await app.request(`/api/tasks/${simJson.task.id}/logs`);
    expect(logsRes.status).toBe(200);
    const logsJson = (await logsRes.json()) as { logs: unknown[] };
    expect(logsJson.logs.length).toBeGreaterThan(0);

    const mergeRes = await app.request(`/api/tasks/${simJson.task.id}/merge`, { method: 'POST' });
    expect(mergeRes.status).toBe(200);
    const mergeJson = (await mergeRes.json()) as { task: { status: string } };
    expect(mergeJson.task.status).toBe('MERGED');

    // Webhook signature verification
    const payload = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'dragonflow-org/awesome-oss' },
      issue: {
        number: 555,
        title: 'Webhook test issue',
        body: 'Valid webhook issue body with details.',
        user: { login: 'alice' },
        author_association: 'NONE',
        labels: [],
        state: 'open',
        html_url: 'https://github.com/dragonflow-org/awesome-oss/issues/555',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    const badWh = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'issues', 'x-hub-signature-256': 'sha256=bad' },
      body: payload,
    });
    expect(badWh.status).toBe(401);

    const goodSig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const goodWh = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'issues', 'x-hub-signature-256': goodSig },
      body: payload,
    });
    expect(goodWh.status).toBe(202);

    // SSE stream emits initial heartbeat
    const sseRes = await app.request('/api/events');
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const reader = sseRes.body!.getReader();
    const firstChunk = await reader.read();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toContain('"type":"heartbeat"');
    await reader.cancel();
  }, 25_000);
});
