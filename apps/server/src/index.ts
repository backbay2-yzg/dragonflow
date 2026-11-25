import { serve } from '@hono/node-server';
import { bootstrapDragonFlow } from './runtime.js';
import { createServerApp } from './app.js';

function parseCliArgs(argv: string[]): {
  configPath?: string;
  demoMode: boolean;
  portOverride?: number;
  probeOnly: boolean;
} {
  let configPath: string | undefined;
  let demoMode = false;
  let portOverride: number | undefined;
  let probeOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--demo') {
      demoMode = true;
    } else if (arg === '--probe-only') {
      probeOnly = true;
    } else if (arg === '--config' && argv[i + 1]) {
      configPath = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      const p = Number(argv[++i]);
      if (Number.isFinite(p) && p > 0) portOverride = p;
    }
  }

  return { configPath, demoMode, portOverride, probeOnly };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const runtime = await bootstrapDragonFlow({
    configPath: args.configPath,
    demoMode: args.demoMode,
  });

  const health = runtime.registry.listHealth();
  console.log(
    `[DragonFlow] Mode=${runtime.mode} | DB=${runtime.dbPath} | Available CLIs: ${
      health
        .filter((h) => h.available)
        .map((h) => `${h.id}(${h.version ?? 'ok'})`)
        .join(', ') || 'none'
    }`,
  );

  if (args.probeOnly) {
    console.log(JSON.stringify(health, null, 2));
    await runtime.shutdown();
    return;
  }

  // In demo mode, wire automatic simulated CI fail -> heal transition for [CIFailHeal] preset
  const ciFailInjected = new Set<string>();
  if (runtime.mode === 'demo' && 'setPrCheckRuns' in runtime.github) {
    const mockGh = runtime.github as import('@dragonflow/core').InMemoryGitHubClient;
    runtime.eventBus.subscribe((ev) => {
      if (ev.type !== 'task:transitioned' || ev.toStatus !== 'PR_OPEN') return;
      const task = runtime.repo.getTask(ev.taskId);
      if (!task?.prNumber) return;
      if (task.issueTitle.includes('[CIFailHeal]') && !ciFailInjected.has(task.id)) {
        ciFailInjected.add(task.id);
        mockGh.setPrCheckRuns(task.prNumber, [
          {
            id: 901,
            name: 'ci / test & lint',
            status: 'completed',
            conclusion: 'failure',
            outputTitle: 'Simulated CI failure',
            outputSummary: 'Demo preset injected initial CI check failure to trigger auto-heal.',
          },
        ]);
        setTimeout(() => {
          void runtime.orchestrator.pollOpenPrs().catch(() => undefined);
        }, 800);
      } else if (task.ciFixRetries > 0) {
        mockGh.setPrCheckRuns(task.prNumber, [
          {
            id: 901,
            name: 'ci / test & lint',
            status: 'completed',
            conclusion: 'success',
            outputTitle: 'All checks passed',
            outputSummary: 'Auto-healed CI run succeeded.',
          },
        ]);
        setTimeout(() => {
          void runtime.orchestrator.pollOpenPrs().catch(() => undefined);
        }, 800);
      }
    });
  }

  const app = createServerApp({
    config: runtime.config,
    mode: runtime.mode,
    dbPath: runtime.dbPath,
    repo: runtime.repo,
    eventBus: runtime.eventBus,
    registry: runtime.registry,
    orchestrator: runtime.orchestrator,
    github: runtime.github,
    poller: runtime.poller,
    webhookHandler: runtime.webhookHandler,
    webDistDir: runtime.webDistDir,
  });

  const port = args.portOverride ?? runtime.config.server.port;
  const hostname = runtime.config.server.host;

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      console.log(
        `[DragonFlow] Mission Control listening at http://${hostname}:${info.port} (mode=${runtime.mode})`,
      );
    },
  );

  const shutdownSignal = async () => {
    console.log('\n[DragonFlow] Shutting down gracefully...');
    server.close();
    await runtime.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdownSignal());
  process.on('SIGTERM', () => void shutdownSignal());
}

main().catch((err) => {
  console.error('[DragonFlow] Fatal startup error:', err);
  process.exit(1);
});
