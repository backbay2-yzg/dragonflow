import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AgentHealthInfo, AgentProfile, DragonFlowConfig } from '@dragonflow/shared';
import {
  AgentRegistry,
  AgentRouter,
  CliCodingAgentAdapter,
  DockerSandboxRunner,
  DragonFlowDatabase,
  DragonFlowEventBus,
  DragonFlowOrchestrator,
  DragonFlowRepository,
  DualChannelStructuredLlmClient,
  GitHubPoller,
  GitHubWebhookHandler,
  GitWorktreeRunner,
  InMemoryGitHubClient,
  IssueTriageService,
  MockStructuredLlmClient,
  NotificationDispatcher,
  OctokitGitHubClient,
  loadConfig,
  type AgentExecContext,
  type AgentExecResult,
  type CodingAgentAdapter,
  type GitHubClient,
  type WorkspaceRunner,
} from '@dragonflow/core';

const execFileAsync = promisify(execFile);

class DemoOverlayAgentAdapter implements CodingAgentAdapter {
  public readonly id: string;
  public readonly profile: AgentProfile;
  private readonly realProbeAdapter: CliCodingAgentAdapter;
  private readonly quotaFallbacksTriggered = new Set<string>();

  constructor(
    profile: AgentProfile,
    private readonly forceAvailableInDemo = false,
  ) {
    this.id = profile.id;
    this.profile = profile;
    this.realProbeAdapter = new CliCodingAgentAdapter(profile);
  }

  async probe(): Promise<AgentHealthInfo> {
    const real = await this.realProbeAdapter.probe();
    if (real.available || !this.forceAvailableInDemo) {
      return real;
    }
    return {
      ...real,
      available: true,
      resolvedPath: `demo-virtual://${this.profile.command}`,
      version: 'demo-simulated',
      error: undefined,
    };
  }

  async execute(ctx: AgentExecContext): Promise<AgentExecResult> {
    ctx.onLog?.(
      'system',
      `[Demo:${this.id}] Executing stage "${ctx.stage}" in worktree ${ctx.cwd}`,
    );

    await new Promise((r) => setTimeout(r, 120));

    if (
      ctx.prompt.includes('[QuotaFallback]') &&
      !this.quotaFallbacksTriggered.has(ctx.taskId) &&
      this.id !== 'claude'
    ) {
      this.quotaFallbacksTriggered.add(ctx.taskId);
      ctx.onLog?.('stderr', `[Demo:${this.id}] Error: insufficient_quota (simulated)`);
      return {
        success: false,
        outputText: '',
        rawStdout: '',
        rawStderr: 'Error: insufficient_quota for demo account',
        exitCode: 1,
        errorKind: 'quota_exceeded',
        tokensUsed: 150,
        costUsd: 0,
        durationMs: 120,
      };
    }

    const helperPath = path.join(ctx.cwd, 'src', 'index.js');
    if (existsSync(helperPath)) {
      await writeFile(
        helperPath,
        `// Automated edit by DragonFlow (${this.id}) at ${new Date().toISOString()}\nexport function sum(a, b) {\n  return Number(a) + Number(b);\n}\n`,
        'utf8',
      );
    }

    ctx.onLog?.('stdout', `[Demo:${this.id}] Updated src/index.js cleanly`);
    return {
      success: true,
      outputText: `Completed ${ctx.stage} cleanly with ${this.id}`,
      rawStdout: `Completed ${ctx.stage}`,
      rawStderr: '',
      exitCode: 0,
      errorKind: 'none',
      tokensUsed: 1120,
      costUsd: 0.015,
      durationMs: 120,
    };
  }
}

async function ensureDemoBareGitRepo(dataDir: string): Promise<string> {
  const bareRepo = path.resolve(dataDir, 'demo-origin.git');
  const seedRepo = path.resolve(dataDir, 'demo-seed');
  if (existsSync(bareRepo)) {
    return bareRepo;
  }

  await mkdir(dataDir, { recursive: true });
  await execFileAsync('git', ['init', '--bare', bareRepo], { cwd: dataDir });
  await execFileAsync('git', ['clone', bareRepo, seedRepo], { cwd: dataDir });
  await execFileAsync('git', ['config', 'user.name', 'DragonFlow Demo'], { cwd: seedRepo });
  await execFileAsync('git', ['config', 'user.email', 'demo@dragonflow.dev'], { cwd: seedRepo });
  await execFileAsync('git', ['checkout', '-B', 'main'], { cwd: seedRepo });

  await mkdir(path.join(seedRepo, 'src'), { recursive: true });
  await mkdir(path.join(seedRepo, 'tests'), { recursive: true });
  await writeFile(
    path.join(seedRepo, 'package.json'),
    JSON.stringify(
      {
        name: 'awesome-oss',
        version: '0.1.0',
        type: 'module',
        scripts: {
          test: 'node --test',
          build: 'node --check src/index.js',
          lint: 'node --check src/index.js',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(seedRepo, 'src', 'index.js'),
    'export function sum(a, b) {\n  return a + b;\n}\n',
    'utf8',
  );
  await writeFile(
    path.join(seedRepo, 'tests', 'index.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/index.js';\ntest('sum adds numbers', () => { assert.equal(sum(2, 3), 5); });\n",
    'utf8',
  );

  await execFileAsync('git', ['add', '-A'], { cwd: seedRepo });
  await execFileAsync('git', ['commit', '-m', 'chore: initial demo repository'], { cwd: seedRepo });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: seedRepo });
  return bareRepo;
}

export interface DragonFlowRuntime {
  config: DragonFlowConfig;
  mode: 'live' | 'demo';
  dbPath: string;
  database: DragonFlowDatabase;
  eventBus: DragonFlowEventBus;
  repo: DragonFlowRepository;
  registry: AgentRegistry;
  github: GitHubClient;
  orchestrator: DragonFlowOrchestrator;
  poller: GitHubPoller;
  webhookHandler: GitHubWebhookHandler;
  webDistDir: string;
  shutdown: () => Promise<void>;
}

export async function bootstrapDragonFlow(opts?: {
  configPath?: string;
  demoMode?: boolean;
}): Promise<DragonFlowRuntime> {
  const configPath = opts?.configPath ?? process.env.DRAGONFLOW_CONFIG;
  const loaded = await loadConfig(configPath);
  const mode: 'live' | 'demo' = opts?.demoMode || loaded.project.mode === 'demo' ? 'demo' : 'live';

  const dataDir = path.resolve(loaded.project.dataDir);
  await mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, mode === 'demo' ? 'dragonflow-demo.db' : 'dragonflow.db');
  const database = new DragonFlowDatabase(dbPath);
  const eventBus = new DragonFlowEventBus();
  const repo = new DragonFlowRepository(database.db, eventBus);

  let config = loaded;
  let github: GitHubClient;
  if (mode === 'demo') {
    const bareRepo = await ensureDemoBareGitRepo(dataDir);
    config = {
      ...loaded,
      project: { ...loaded.project, mode: 'demo' },
      workspace: {
        ...loaded.workspace,
        localRepoUrlOverride: bareRepo,
      },
      workflow: {
        ...loaded.workflow,
        defaultTestCommand: 'node --test',
      },
      github: {
        ...loaded.github,
        repositories:
          loaded.github.repositories.length > 0
            ? loaded.github.repositories
            : [
                {
                  owner: 'dragonflow-org',
                  repo: 'awesome-oss',
                  baseBranch: 'main',
                  enabled: true,
                  testCommand: 'node --test',
                },
              ],
      },
    };
    github = new InMemoryGitHubClient(bareRepo);
  } else {
    const token = process.env[loaded.github.tokenEnv] ?? '';
    github = new OctokitGitHubClient(token);
  }

  const registry = new AgentRegistry(config.agents, eventBus, (profile) =>
    mode === 'demo'
      ? new DemoOverlayAgentAdapter(profile, profile.id === 'codex')
      : new CliCodingAgentAdapter(profile),
  );
  await registry.probeAll();

  const llm =
    mode === 'demo'
      ? new MockStructuredLlmClient()
      : new DualChannelStructuredLlmClient(config.llm, registry);

  const triageService = new IssueTriageService(llm, config.workflow.quickFixMaxComplexity);
  const router = new AgentRouter(config, registry, llm);
  const workspace: WorkspaceRunner =
    config.workspace.runner === 'docker'
      ? new DockerSandboxRunner(
          config.workspace.reposRoot,
          config.workspace.worktreeRoot,
          config.workspace.dockerImage,
          config.workspace.dockerNetwork,
        )
      : new GitWorktreeRunner(config.workspace.reposRoot, config.workspace.worktreeRoot);

  const notifier = new NotificationDispatcher(config.notifications.channels);
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

  const webhookSecret = process.env[config.github.webhookSecretEnv];
  const webhookHandler = new GitHubWebhookHandler(orchestrator, webhookSecret);
  const poller = new GitHubPoller(config, github, repo, orchestrator);

  if (mode === 'live' && config.github.repositories.some((r) => r.enabled)) {
    poller.start();
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDistDir = path.resolve(__dirname, '../../web/dist');

  return {
    config,
    mode,
    dbPath,
    database,
    eventBus,
    repo,
    registry,
    github,
    orchestrator,
    poller,
    webhookHandler,
    webDistDir,
    shutdown: async () => {
      poller.stop();
      await orchestrator.waitForIdle();
      database.close();
    },
  };
}
