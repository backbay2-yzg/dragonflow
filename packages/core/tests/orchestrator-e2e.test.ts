import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  GitWorktreeRunner,
  InMemoryGitHubClient,
  IssueTriageService,
  MockCodingAgentAdapter,
  MockStructuredLlmClient,
  NotificationDispatcher,
  parseConfigFromYaml,
  type MockAgentBehavior,
  type MockLlmResponder,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createTempNodeGitRepo(rootDir: string): Promise<{ bareRepo: string }> {
  const bareRepo = path.join(rootDir, 'origin.git');
  const seedRepo = path.join(rootDir, 'seed');
  await git(['init', '--bare', bareRepo], rootDir);
  await git(['clone', bareRepo, seedRepo], rootDir);
  await git(['config', 'user.name', 'Seed'], seedRepo);
  await git(['config', 'user.email', 'seed@example.com'], seedRepo);
  await git(['checkout', '-B', 'main'], seedRepo);

  await writeFile(
    path.join(seedRepo, 'package.json'),
    JSON.stringify(
      {
        name: 'demo-oss',
        version: '0.1.0',
        type: 'module',
        scripts: {
          test: 'node --test',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(seedRepo, 'math.js'),
    'export function add(a, b) { return a + b; }\n',
    'utf8',
  );
  await writeFile(
    path.join(seedRepo, 'math.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.js';\ntest('add works', () => { assert.equal(add(1, 2), 3); });\n",
    'utf8',
  );

  await git(['add', '-A'], seedRepo);
  await git(['commit', '-m', 'chore: initial commit'], seedRepo);
  await git(['push', '-u', 'origin', 'main'], seedRepo);
  return { bareRepo };
}

describe('DragonFlowOrchestrator Full E2E Workflows', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    cleanupDirs.length = 0;
  });

  async function setupHarness(opts?: {
    yamlExtra?: string;
    agentBehaviors?: Record<string, MockAgentBehavior>;
    llmResponder?: MockLlmResponder;
    availableAgents?: string[];
  }) {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dragonflow-e2e-'));
    cleanupDirs.push(tmp);
    const { bareRepo } = await createTempNodeGitRepo(tmp);

    const config = parseConfigFromYaml(`
project:
  name: DragonFlow-Test
  mode: demo
github:
  triggerLabel: auto-dev
  ownerFastTrack: true
  maintainers: [maintainer]
  repositories:
    - owner: acme
      repo: demo
      baseBranch: main
      testCommand: "node --test"
routing:
  defaultAgent: claude
  crossReviewDifferentAgent: true
  fallbackOrder: [claude, qodercli, codex, gemini]
workflow:
  quickFixMaxComplexity: 2
  requirePlanApprovalForFullSdlc: true
  maxLocalFixRetries: 2
  maxCrossReviewRetries: 1
  maxCiFixRetries: 2
  maxReviewFixRetries: 2
  defaultTestCommand: "node --test"
workspace:
  reposRoot: "${path.join(tmp, 'repos').replaceAll('\\', '/')}"
  worktreeRoot: "${path.join(tmp, 'worktrees').replaceAll('\\', '/')}"
  localRepoUrlOverride: "${bareRepo.replaceAll('\\', '/')}"
${opts?.yamlExtra ?? ''}
`);

    const database = new DragonFlowDatabase(':memory:');
    const eventBus = new DragonFlowEventBus();
    const repo = new DragonFlowRepository(database.db, eventBus);
    const github = new InMemoryGitHubClient(bareRepo);
    const availableSet = new Set(opts?.availableAgents ?? ['claude', 'qodercli', 'codex']);

    const registry = new AgentRegistry(DEFAULT_AGENT_PRESETS, eventBus, (profile) => {
      const behavior =
        opts?.agentBehaviors?.[profile.id] ??
        (async (ctx) => {
          await writeFile(
            path.join(ctx.cwd, 'math.js'),
            `// Updated by ${profile.id} in stage ${ctx.stage}\nexport function add(a, b) { return Number(a) + Number(b); }\n`,
            'utf8',
          );
          return { success: true, outputText: `Applied clean fix with ${profile.id}` };
        });
      return new MockCodingAgentAdapter(profile, availableSet.has(profile.id), behavior);
    });
    await registry.probeAll();

    const llm = new MockStructuredLlmClient(opts?.llmResponder);
    const triageService = new IssueTriageService(llm, config.workflow.quickFixMaxComplexity);
    const router = new AgentRouter(config, registry, llm);
    const workspace = new GitWorktreeRunner(config.workspace.reposRoot, config.workspace.worktreeRoot);
    const sentNotifications: string[] = [];
    const notifier = new NotificationDispatcher(
      [
        {
          id: 'test-hook',
          type: 'generic',
          enabled: true,
          urlEnv: 'TEST_HOOK_URL',
          events: [
            'triage_completed',
            'plan_awaiting_approval',
            'pr_opened',
            'ci_failed',
            'review_requested',
            'ready_to_merge',
            'agent_fallback',
            'needs_human',
            'merged',
            'released',
          ],
        },
      ],
      { TEST_HOOK_URL: 'https://example.invalid/hook' },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) sentNotifications.push(String(init.body));
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch,
    );

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

    return { config, database, repo, github, orchestrator, sentNotifications, tmp };
  }

  it('Scenario 1: External issue runs read-only triage, waits for auto-dev label, then Quick Fixes to PR', async () => {
    const { database, repo, github, orchestrator } = await setupHarness();

    const issue = github.seedIssue({
      number: 1,
      title: 'Fix typo in math add input coercion',
      body: 'Calling add("1", 2) should coerce numbers cleanly instead of string concatenation.',
      author: 'external-user',
      authorAssociation: 'NONE',
    });

    const t1 = await orchestrator.ingestIssue('acme/demo', issue);
    expect(t1.status).toBe('AWAITING_TRIGGER');
    expect(t1.worktreePath).toBeUndefined();

    // Status card posted once
    const comments1 = await github.listIssueComments('acme', 'demo', 1);
    expect(comments1).toHaveLength(1);
    expect(comments1[0].body).toContain('AWAITING_TRIGGER');

    // Maintainer adds auto-dev label -> triggers Quick Fix straight to PR_OPEN
    issue.labels.push('auto-dev');
    const t2 = await orchestrator.ingestIssue('acme/demo', issue, { awaitCompletion: true });
    expect(t2.status).toBe('PR_OPEN');
    expect(t2.prNumber).toBeDefined();
    expect(t2.assignedAgent).toBe('qodercli');
    expect(t2.reviewerAgent).not.toBe('qodercli');

    // Status card updated in place (still 1 comment, not spamming!)
    const comments2 = await github.listIssueComments('acme', 'demo', 1);
    expect(comments2).toHaveLength(1);
    expect(comments2[0].body).toContain('PR_OPEN');

    const artifacts = repo.listArtifacts(t2.id);
    expect(artifacts.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['triage', 'spec', 'diff', 'test_report', 'review', 'pr_body']),
    );
    database.close();
  }, 25_000);

  it('Scenario 2: Full SDLC pauses for plan approval, supports /reject revision & /approve, self-heals local test failure, and passes cross-review', async () => {
    let implAttempt = 0;
    let reviewCalls = 0;

    const { database, repo, github, orchestrator } = await setupHarness({
      agentBehaviors: {
        claude: async (ctx) => {
          implAttempt += 1;
          if (implAttempt === 1) {
            // Break test on first attempt so TESTING fails and self-heals
            await writeFile(path.join(ctx.cwd, 'math.js'), 'export function add(a, b) { return 999; }\n', 'utf8');
            return { success: true, outputText: 'Attempt 1 (buggy)' };
          }
          await writeFile(
            path.join(ctx.cwd, 'math.js'),
            '/** Add two numbers */\nexport function add(a, b) { return Number(a) + Number(b); }\n',
            'utf8',
          );
          return { success: true, outputText: 'Attempt 2 (fixed)' };
        },
      },
      llmResponder: (stage, prompt) => {
        if (stage === 'triage') {
          return {
            category: 'feature',
            isDuplicate: false,
            needsMoreInfo: false,
            clarifyingQuestions: [],
            suggestedLabels: ['enhancement'],
            estimatedComplexity: 4,
            recommendedTier: 'full_sdlc',
            summary: 'Complex multi-module OAuth feature',
            riskFlags: [],
          };
        }
        if (stage === 'routing') {
          return {
            primaryAgent: 'claude',
            rationale: 'High complexity feature routed to Claude Code',
            recommendedTier: 'full_sdlc',
          };
        }
        if (stage === 'spec') {
          return {
            problemStatement: 'Add feature cleanly',
            acceptanceCriteria: ['Pass all unit tests'],
            nonGoals: [],
            affectedAreas: ['math.js'],
          };
        }
        if (stage === 'plan') {
          return {
            architectureSummary: prompt.includes('Add caching')
              ? 'Revised architecture with caching layer'
              : 'Initial architecture design',
            filesToModify: ['math.js'],
            implementationSteps: ['Implement', 'Test'],
            testPlan: ['node --test'],
            risksAndMitigations: [],
          };
        }
        if (stage === 'cross_review') {
          reviewCalls += 1;
          if (reviewCalls === 1) {
            return {
              approved: false,
              summary: 'Missing JSDoc comment on exported function',
              findings: [{ severity: 'major', file: 'math.js', message: 'Add JSDoc' }],
              checklist: {
                acceptanceCriteriaMet: true,
                testsAdequate: true,
                noObviousSecurityRisks: true,
                cleanScope: false,
              },
            };
          }
          return {
            approved: true,
            summary: 'All findings resolved, LGTM',
            findings: [],
            checklist: {
              acceptanceCriteriaMet: true,
              testsAdequate: true,
              noObviousSecurityRisks: true,
              cleanScope: true,
            },
          };
        }
        return {};
      },
    });

    // Owner fast-tracks full_sdlc issue
    const issue = github.seedIssue({
      number: 2,
      title: 'Implement OAuth2 plugin architecture',
      body: 'Full feature request with multiple integration points and token refresh.',
      author: 'maintainer',
      authorAssociation: 'OWNER',
    });

    const paused = await orchestrator.ingestIssue('acme/demo', issue, { awaitCompletion: true });
    expect(paused.status).toBe('AWAITING_PLAN_APPROVAL');
    expect(paused.tier).toBe('full_sdlc');
    expect(paused.assignedAgent).toBe('claude');
    expect(paused.reviewerAgent).toBe('qodercli');

    // Maintainer requests plan revision via /reject
    const rejectComment = github.seedComment(2, '/reject Add caching support to plan');
    const revised = await orchestrator.handleComment('acme/demo', 2, rejectComment, {
      awaitCompletion: true,
    });
    expect(revised?.status).toBe('AWAITING_PLAN_APPROVAL');
    expect(repo.getLatestArtifact(paused.id, 'plan')?.content).toContain('caching layer');

    // Maintainer approves plan via /approve -> runs implementation, self-heals test, passes 2nd cross-review -> opens PR!
    const approveComment = github.seedComment(2, '/approve');
    const finished = await orchestrator.handleComment('acme/demo', 2, approveComment, {
      awaitCompletion: true,
    });
    expect(finished?.status, `lastError=${finished?.lastError}`).toBe('PR_OPEN');
    expect(finished?.localFixRetries).toBe(1);
    expect(finished?.crossReviewRetries).toBe(1);
    expect(finished?.prNumber).toBeDefined();
    database.close();
  }, 25_000);

  it('Scenario 3: Automatically falls back to secondary agent when primary hits quota_exceeded', async () => {
    const { database, github, orchestrator, sentNotifications } = await setupHarness({
      agentBehaviors: {
        qodercli: async () => ({
          success: false,
          errorKind: 'quota_exceeded',
          rawStderr: 'Error: insufficient_quota on qodercli',
          outputText: '',
        }),
        claude: async (ctx) => {
          await writeFile(
            path.join(ctx.cwd, 'math.js'),
            'export function add(a, b) { return Number(a ?? 0) + Number(b ?? 0); }\n',
            'utf8',
          );
          return { success: true, outputText: 'Recovered on claude' };
        },
      },
    });

    const issue = github.seedIssue({
      number: 3,
      title: 'Fix subtle null check bug',
      body: 'Localized bug fix with clear repro steps in parser.',
      author: 'maintainer',
      authorAssociation: 'OWNER',
    });

    const result = await orchestrator.ingestIssue('acme/demo', issue, { awaitCompletion: true });
    expect(result.status, `lastError=${result.lastError}`).toBe('PR_OPEN');
    expect(result.fallbackCount).toBe(1);
    expect(result.assignedAgent).toBe('claude');
    expect(result.fallbackHistory[0].fromAgent).toBe('qodercli');
    expect(result.fallbackHistory[0].toAgent).toBe('claude');
    expect(result.fallbackHistory[0].errorKind).toBe('quota_exceeded');
    expect(sentNotifications.some((n) => n.includes('agent_fallback'))).toBe(true);
    database.close();
  }, 25_000);

  it('Scenario 4: PR CI failure self-heals, maintainer CHANGES_REQUESTED review self-heals, /merge transitions through RELEASE_PR_OPEN to RELEASED', async () => {
    const { database, repo, github, orchestrator } = await setupHarness();

    const issue = github.seedIssue({
      number: 4,
      title: 'Fix typo in README',
      body: 'Minor documentation typo correction with full description.',
      author: 'maintainer',
      authorAssociation: 'OWNER',
    });

    const opened = await orchestrator.ingestIssue('acme/demo', issue, { awaitCompletion: true });
    expect(opened.status).toBe('PR_OPEN');
    const prNumber = opened.prNumber!;

    // 1. Remote CI fails -> pollOpenPrs triggers CI_FIXING -> pushes fix -> back to PR_OPEN
    github.setPrCheckRuns(prNumber, [
      {
        id: 1,
        name: 'ci / test',
        status: 'completed',
        conclusion: 'failure',
        outputTitle: 'Lint error',
        outputSummary: 'Trailing whitespace',
      },
    ]);
    await orchestrator.pollOpenPrs('acme/demo');
    let task = repo.getTask(opened.id)!;
    expect(task.status).toBe('PR_OPEN');
    expect(task.ciFixRetries).toBe(1);

    // 2. Maintainer requests changes on PR -> pollOpenPrs triggers REVIEW_FIXING -> back to PR_OPEN
    github.setPrCheckRuns(prNumber, [
      { id: 1, name: 'ci / test', status: 'completed', conclusion: 'success' },
    ]);
    github.seedPrReview(prNumber, {
      author: 'maintainer',
      authorAssociation: 'OWNER',
      state: 'CHANGES_REQUESTED',
      body: 'Please rename helper variable for clarity',
    });
    await orchestrator.pollOpenPrs('acme/demo');
    task = repo.getTask(opened.id)!;
    expect(task.status).toBe('PR_OPEN');
    expect(task.reviewFixRetries).toBe(1);

    // 3. Now CI is green and no new review changes -> READY_TO_MERGE
    await orchestrator.pollOpenPrs('acme/demo');
    task = repo.getTask(opened.id)!;
    expect(task.status).toBe('READY_TO_MERGE');

    // 4. Maintainer sends /merge -> MERGED
    const mergeCmd = github.seedComment(4, '/merge');
    await orchestrator.handleComment('acme/demo', 4, mergeCmd, { awaitCompletion: true });
    expect(repo.getTask(opened.id)?.status).toBe('MERGED');

    // 5. release-please opens Release PR -> RELEASE_PR_OPEN
    const relPr = github.seedReleasePr({ title: 'chore(main): release 0.2.0' });
    await orchestrator.pollOpenPrs('acme/demo');
    task = repo.getTask(opened.id)!;
    expect(task.status).toBe('RELEASE_PR_OPEN');
    expect(task.releasePrNumber).toBe(relPr.number);

    // 6. Release PR merged -> GitHub Release published -> RELEASED!
    github.seedRelease('v0.2.0', 'Release 0.2.0');
    await orchestrator.pollOpenPrs('acme/demo');
    task = repo.getTask(opened.id)!;
    expect(task.status).toBe('RELEASED');
    expect(task.releaseTag).toBe('v0.2.0');
    database.close();
  }, 25_000);

  it('Scenario 5: Escalates cleanly to NEEDS_HUMAN when retries & fallback agents are exhausted', async () => {
    const { database, github, orchestrator, sentNotifications } = await setupHarness({
      availableAgents: ['claude'],
      agentBehaviors: {
        claude: async () => ({
          success: false,
          errorKind: 'quota_exceeded',
          rawStderr: 'credit balance is too low',
          outputText: '',
        }),
      },
    });

    const issue = github.seedIssue({
      number: 5,
      title: 'Fix build failure',
      body: 'Consistent failure in build step on Windows.',
      author: 'maintainer',
      authorAssociation: 'OWNER',
    });

    const task = await orchestrator.ingestIssue('acme/demo', issue, { awaitCompletion: true });
    expect(task.status).toBe('NEEDS_HUMAN');
    const refreshedIssue = await github.getIssue('acme', 'demo', 5);
    expect(refreshedIssue.labels).toContain('needs-human');
    expect(sentNotifications.some((n) => n.includes('needs_human'))).toBe(true);
    database.close();
  }, 25_000);
});
