import { z } from 'zod';

export const AgentTypeSchema = z.enum([
  'claude',
  'codex',
  'gemini',
  'opencode',
  'aider',
  'qodercli',
  'workbuddy',
  'codebuddy',
  'template',
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentTemplateConfigSchema = z.object({
  argsTemplate: z.array(z.string()).default([]),
  quotaErrorPatterns: z.array(z.string()).default([]),
  versionArgs: z.array(z.string()).default(['--version']),
});

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  type: AgentTypeSchema,
  enabled: z.boolean().default(true),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  model: z.string().optional(),
  strengths: z.array(z.string()).default([]),
  costTier: z.enum(['low', 'medium', 'high']).default('medium'),
  maxBudgetUsd: z.number().positive().optional(),
  timeoutSec: z.number().int().positive().default(900),
  envAllowlist: z.array(z.string()).default([]),
  promptMode: z.enum(['stdin', 'arg', 'file']).default('stdin'),
  outputMode: z.enum(['text', 'json', 'stream-json']).default('text'),
  template: AgentTemplateConfigSchema.optional(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const RoutingMatchSchema = z.object({
  categories: z
    .array(z.enum(['bug', 'feature', 'docs', 'refactor', 'chore', 'question', 'spam', 'duplicate']))
    .optional(),
  labels: z.array(z.string()).optional(),
  titleRegex: z.string().optional(),
  complexityMin: z.number().int().min(1).max(5).optional(),
  complexityMax: z.number().int().min(1).max(5).optional(),
});

export const RoutingRuleSchema = z.object({
  name: z.string().min(1),
  priority: z.number().int().default(100),
  match: RoutingMatchSchema,
  agentId: z.string().min(1),
  fallbackAgents: z.array(z.string()).optional(),
  tierOverride: z.enum(['quick_fix', 'full_sdlc']).optional(),
});

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const NotificationEventTypeSchema = z.enum([
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
  'failed',
]);

export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

export const NotificationChannelSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['feishu', 'dingtalk', 'wecom', 'slack', 'discord', 'telegram', 'generic']),
  enabled: z.boolean().default(false),
  urlEnv: z.string().min(1),
  secretEnv: z.string().optional(),
  chatIdEnv: z.string().optional(),
  events: z
    .array(NotificationEventTypeSchema)
    .default(['plan_awaiting_approval', 'ready_to_merge', 'needs_human', 'released', 'failed']),
});

export type NotificationChannelConfig = z.infer<typeof NotificationChannelSchema>;

export const RepoConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  baseBranch: z.string().default('main'),
  enabled: z.boolean().default(true),
  testCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  lintCommand: z.string().optional(),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const DragonFlowConfigSchema = z.object({
  project: z
    .object({
      name: z.string().default('DragonFlow'),
      dataDir: z.string().default('./data'),
      mode: z.enum(['live', 'demo']).default('live'),
    })
    .default({}),
  github: z
    .object({
      tokenEnv: z.string().default('GITHUB_TOKEN'),
      webhookSecretEnv: z.string().default('GITHUB_WEBHOOK_SECRET'),
      pollIntervalSec: z.number().int().min(5).default(30),
      repositories: z.array(RepoConfigSchema).default([]),
      triggerLabel: z.string().default('auto-dev'),
      needsHumanLabel: z.string().default('needs-human'),
      ownerFastTrack: z.boolean().default(true),
      maintainers: z.array(z.string()).default([]),
      autoMergeLowRisk: z
        .object({
          enabled: z.boolean().default(false),
          allowedCategories: z.array(z.string()).default(['docs', 'chore']),
          maxComplexity: z.number().int().min(1).max(5).default(2),
          maxFilesChanged: z.number().int().positive().default(5),
          mergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
        })
        .default({}),
    })
    .default({}),
  llm: z
    .object({
      mode: z.enum(['api', 'cli_fallback', 'cli_only']).default('cli_fallback'),
      provider: z.enum(['openai-compatible', 'anthropic', 'gemini']).default('openai-compatible'),
      baseUrl: z.string().default('https://api.openai.com/v1'),
      apiKeyEnv: z.string().default('OPENAI_API_KEY'),
      model: z.string().default('gpt-4o-mini'),
      cliFallbackAgentId: z.string().optional(),
      temperature: z.number().min(0).max(2).default(0.2),
      maxTokens: z.number().int().positive().default(4096),
    })
    .default({}),
  agents: z.array(AgentProfileSchema).default([]),
  routing: z
    .object({
      defaultAgent: z.string().default('claude'),
      defaultReviewerAgent: z.string().optional(),
      crossReviewDifferentAgent: z.boolean().default(true),
      fallbackOrder: z.array(z.string()).default(['claude', 'qodercli', 'codex', 'gemini', 'opencode', 'aider']),
      rules: z.array(RoutingRuleSchema).default([]),
    })
    .default({}),
  workflow: z
    .object({
      maxConcurrentTasks: z.number().int().positive().default(2),
      quickFixMaxComplexity: z.number().int().min(1).max(5).default(2),
      requirePlanApprovalForFullSdlc: z.boolean().default(true),
      maxLocalFixRetries: z.number().int().min(0).max(10).default(2),
      maxCrossReviewRetries: z.number().int().min(0).max(5).default(1),
      maxCiFixRetries: z.number().int().min(0).max(10).default(3),
      maxReviewFixRetries: z.number().int().min(0).max(10).default(3),
      defaultTestCommand: z.string().default('pnpm test'),
      defaultBuildCommand: z.string().optional(),
      defaultLintCommand: z.string().optional(),
    })
    .default({}),
  release: z
    .object({
      mode: z.enum(['release_pr', 'immediate_per_pr']).default('release_pr'),
      releasePrTitlePrefix: z.string().default('chore(main): release'),
      releaseBranchPrefix: z.string().default('release-please--'),
      conventionalCommits: z.boolean().default(true),
    })
    .default({}),
  workspace: z
    .object({
      runner: z.enum(['worktree', 'docker']).default('worktree'),
      worktreeRoot: z.string().default('./data/worktrees'),
      reposRoot: z.string().default('./data/repos'),
      cleanupOnFinish: z.boolean().default(false),
      dockerImage: z.string().default('node:22-bookworm'),
      dockerNetwork: z.string().default('bridge'),
      localRepoUrlOverride: z.string().optional(),
    })
    .default({}),
  notifications: z
    .object({
      channels: z.array(NotificationChannelSchema).default([]),
    })
    .default({}),
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().positive().default(4390),
      corsOrigin: z.string().default('*'),
    })
    .default({}),
});

export type DragonFlowConfig = z.infer<typeof DragonFlowConfigSchema>;
