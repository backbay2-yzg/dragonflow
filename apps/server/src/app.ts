import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  TASK_STATUSES,
  type DragonFlowConfig,
  type SseEvent,
  type TaskStatus,
} from '@dragonflow/shared';
import {
  AgentRegistry,
  DragonFlowEventBus,
  DragonFlowOrchestrator,
  DragonFlowRepository,
  GitHubPoller,
  GitHubWebhookHandler,
  InMemoryGitHubClient,
  sanitizeConfigForUi,
  type GitHubClient,
} from '@dragonflow/core';

export interface ServerAppDeps {
  config: DragonFlowConfig;
  mode: 'live' | 'demo';
  dbPath: string;
  repo: DragonFlowRepository;
  eventBus: DragonFlowEventBus;
  registry: AgentRegistry;
  orchestrator: DragonFlowOrchestrator;
  github: GitHubClient;
  poller?: GitHubPoller;
  webhookHandler?: GitHubWebhookHandler;
  webDistDir?: string;
  onSimulatePreset?: (preset: string, issueNumber: number, prSetupFn?: (prNumber: number) => void) => void;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const TriggerBodySchema = z.object({
  agentId: z.string().min(1).optional(),
});

const RejectPlanBodySchema = z.object({
  feedback: z.string().min(1),
});

const SimulateIssueSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  tierPreset: z
    .enum(['quick_fix', 'full_sdlc', 'quota_fallback', 'ci_fail_heal'])
    .default('quick_fix'),
  autoTrigger: z.boolean().default(true),
});

export function createServerApp(deps: ServerAppDeps): Hono {
  const app = new Hono();
  const startedAt = Date.now();

  app.use(
    '/api/*',
    cors({
      origin: deps.config.server.corsOrigin,
    }),
  );

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 400;
    return c.json({ error: message }, status);
  });

  const primaryRepo = deps.config.github.repositories[0];
  const repoFullName = primaryRepo
    ? `${primaryRepo.owner}/${primaryRepo.repo}`
    : 'dragonflow-org/demo';

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      name: deps.config.project.name,
      mode: deps.mode,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      version: '0.1.0',
      dbPath: deps.dbPath,
    });
  });

  app.get('/api/overview', (c) => {
    const health = deps.registry.listHealth();
    const availableCount = health.filter((h) => h.enabled && h.available).length;
    const overview = deps.repo.getDashboardOverview({
      mode: deps.mode,
      repoFullName,
      availableAgentsCount: availableCount,
      totalAgentsCount: health.length,
    });
    return c.json(overview);
  });

  app.get('/api/tasks', (c) => {
    const statusParam = c.req.query('status');
    const search = c.req.query('search');
    const status =
      statusParam && (TASK_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as TaskStatus)
        : undefined;
    const tasks = deps.repo.listTasks({ status, search });
    return c.json({ tasks });
  });

  app.get('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = deps.repo.getTask(id);
    if (!task) {
      return c.json({ error: `Task not found: ${id}` }, 404);
    }
    return c.json({
      task,
      runs: deps.repo.listRuns(id),
      artifacts: deps.repo.listArtifacts(id),
      auditEvents: deps.repo.listAuditEvents(id),
    });
  });

  app.get('/api/tasks/:id/logs', (c) => {
    const id = c.req.param('id');
    const task = deps.repo.getTask(id);
    if (!task) {
      return c.json({ error: `Task not found: ${id}` }, 404);
    }
    const limit = Number(c.req.query('limit') ?? 500);
    const afterId = Number(c.req.query('afterId') ?? 0);
    const logs = deps.repo.listLogs(
      id,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 500,
      Number.isFinite(afterId) && afterId >= 0 ? afterId : 0,
    );
    return c.json({ logs });
  });

  app.get('/api/events', (c) => {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (ev: SseEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            cleanup?.();
          }
        };

        send({ type: 'heartbeat', timestamp: new Date().toISOString() });
        const unsubscribe = deps.eventBus.subscribe(send);
        const timer = setInterval(() => {
          send({ type: 'heartbeat', timestamp: new Date().toISOString() });
        }, 20_000);

        cleanup = () => {
          clearInterval(timer);
          unsubscribe();
          cleanup = undefined;
        };

        c.req.raw.signal?.addEventListener('abort', () => {
          cleanup?.();
          try {
            controller.close();
          } catch {
            // ignore
          }
        });
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  });

  app.post('/api/tasks/:id/trigger', async (c) => {
    const id = c.req.param('id');
    const raw = await c.req.json().catch(() => ({}));
    const body = TriggerBodySchema.parse(raw);
    const task = await deps.orchestrator.triggerTask(id, body.agentId, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/tasks/:id/approve-plan', async (c) => {
    const id = c.req.param('id');
    const task = await deps.orchestrator.approvePlan(id, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/tasks/:id/reject-plan', async (c) => {
    const id = c.req.param('id');
    const body = RejectPlanBodySchema.parse(await c.req.json());
    const task = await deps.orchestrator.rejectPlan(id, body.feedback, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/tasks/:id/retry', async (c) => {
    const id = c.req.param('id');
    const raw = await c.req.json().catch(() => ({}));
    const body = TriggerBodySchema.parse(raw);
    const task = await deps.orchestrator.retryTask(id, body.agentId, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/tasks/:id/merge', async (c) => {
    const id = c.req.param('id');
    const task = await deps.orchestrator.mergeTaskPr(id, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/tasks/:id/cancel', async (c) => {
    const id = c.req.param('id');
    const task = await deps.orchestrator.cancelTask(id, 'dashboard');
    return c.json({ task });
  });

  app.post('/api/sync', async (c) => {
    if (deps.poller) {
      const res = await deps.poller.syncOnce();
      return c.json({ synced: true, ...res });
    }
    const prsChecked = await deps.orchestrator.pollOpenPrs();
    return c.json({ synced: true, issuesProcessed: 0, prsChecked });
  });

  app.post('/api/demo/simulate-issue', async (c) => {
    if (deps.mode !== 'demo' || !(deps.github instanceof InMemoryGitHubClient)) {
      return c.json({ error: 'Simulate issue endpoint is only enabled in demo mode' }, 400);
    }

    const raw = await c.req.json().catch(() => ({}));
    const input = SimulateIssueSchema.parse(raw);
    const presetTemplates: Record<
      typeof input.tierPreset,
      { title: string; body: string; labels: string[] }
    > = {
      quick_fix: {
        title: 'Fix numeric input parsing edge case in sum helper',
        body: 'Calling sum("1", 2) concatenates strings instead of numeric addition. Need clean coercion and unit test.',
        labels: ['bug'],
      },
      full_sdlc: {
        title: 'Implement OAuth2 plugin authentication architecture',
        body: 'Support pluggable OAuth2 providers with token refresh, session storage, and integration test suite.',
        labels: ['enhancement', 'architecture'],
      },
      quota_fallback: {
        title: '[QuotaFallback] Optimize batch indexing with automatic agent fallback',
        body: 'Primary agent hits simulated quota_exceeded limit; verify seamless fallback to secondary agent.',
        labels: ['bug'],
      },
      ci_fail_heal: {
        title: '[CIFailHeal] Add strict date formatter with PR CI self-healing',
        body: 'Simulate initial remote CI failure after PR opens so DragonFlow auto-heals and turns checks green.',
        labels: ['bug'],
      },
    };

    const chosen = presetTemplates[input.tierPreset];
    const labels = [...(input.labels ?? chosen.labels)];
    if (input.autoTrigger && !labels.includes(deps.config.github.triggerLabel)) {
      labels.push(deps.config.github.triggerLabel);
    }

    const issue = deps.github.seedIssue({
      title: input.title?.trim() || chosen.title,
      body: input.body?.trim() || chosen.body,
      labels,
      author: input.autoTrigger ? 'maintainer' : 'community-contributor',
      authorAssociation: input.autoTrigger ? 'OWNER' : 'NONE',
    });

    deps.onSimulatePreset?.(input.tierPreset, issue.number);

    const task = await deps.orchestrator.ingestIssue(repoFullName, issue);
    return c.json({ task, issueNumber: issue.number }, 201);
  });

  app.get('/api/agents', (c) => {
    return c.json({ agents: deps.registry.listHealth() });
  });

  app.post('/api/agents/probe', async (c) => {
    const agents = await deps.registry.probeAll();
    return c.json({ agents });
  });

  app.get('/api/config', (c) => {
    return c.json({ config: sanitizeConfigForUi(deps.config) });
  });

  app.post('/webhooks/github', async (c) => {
    if (!deps.webhookHandler) {
      return c.json({ error: 'Webhook handler not initialized' }, 503);
    }
    const eventName = c.req.header('x-github-event') ?? '';
    const signatureHeader = c.req.header('x-hub-signature-256');
    const rawBody = await c.req.text();
    const res = await deps.webhookHandler.handleEvent({
      eventName,
      signatureHeader,
      rawBody,
    });
    if (!res.accepted) {
      return c.json({ error: res.reason ?? 'Rejected webhook' }, 401);
    }
    return c.json({ ok: true, action: res.action }, 202);
  });

  // Static Dashboard UI serving (when built apps/web/dist exists)
  if (deps.webDistDir && existsSync(deps.webDistDir)) {
    const resolvedDist = path.resolve(deps.webDistDir);

    app.get('*', async (c) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith('/api/') || reqPath.startsWith('/webhooks/')) {
        return c.json({ error: 'Not found' }, 404);
      }

      const relPath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
      const candidate = path.resolve(resolvedDist, relPath);

      if (candidate.startsWith(resolvedDist) && existsSync(candidate)) {
        try {
          const buf = await readFile(candidate);
          const ext = path.extname(candidate).toLowerCase();
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
            },
          });
        } catch {
          // fall through to index.html
        }
      }

      const indexPath = path.join(resolvedDist, 'index.html');
      if (existsSync(indexPath)) {
        const html = await readFile(indexPath);
        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return c.json({ error: 'Dashboard bundle not found' }, 404);
    });
  }

  return app;
}
