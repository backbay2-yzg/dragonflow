import { useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  FileCode2,
  GitBranch,
  KeyRound,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { SanitizedConfig } from '@dragonflow/shared';

interface ConfigViewProps {
  config: SanitizedConfig | null;
  loading: boolean;
  onRefresh: () => void;
}

const GITHUB_ACTIONS_SNIPPET = `name: DragonFlow CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build`;

export function ConfigView({ config, loading, onRefresh }: ConfigViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(GITHUB_ACTIONS_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might be unavailable in restricted contexts
    }
  };

  if (loading && !config) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
        正在加载脱敏运行配置...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
        无法读取系统配置
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <Settings2 className="h-4 w-4 text-primary-text" />
            <span>运行配置总览（已脱敏）</span>
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            所有 Token 与 API Key 仅显示环境变量名及就绪状态，不回传明文凭证。
            <span className="selectable ml-2 font-mono tabular-nums text-ink">
              {config.project.name} · {config.server.host}:{config.server.port}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="df-btn-primary ps-3 pe-3.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新配置</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* GitHub & Auto-Merge */}
        <ConfigCard
          icon={<GitBranch className="h-4 w-4 text-primary-text" />}
          title="GitHub 接入与自动合并策略"
        >
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <KeyValueRow
                label={`Token (${config.github.tokenEnv})`}
                value={<SecretBadge configured={config.github.tokenConfigured} />}
              />
              <KeyValueRow
                label={`Webhook Secret (${config.github.webhookSecretEnv})`}
                value={<SecretBadge configured={config.github.webhookSecretConfigured} />}
              />
              <KeyValueRow label="轮询周期" value={`${config.github.pollIntervalSec}s`} mono />
              <KeyValueRow
                label="Owner Fast-Track"
                value={config.github.ownerFastTrack ? '已开启' : '关闭'}
              />
              <KeyValueRow label="触发标签" value={config.github.triggerLabel} mono />
              <KeyValueRow label="人工接管标签" value={config.github.needsHumanLabel} mono />
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface-2 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-medium text-ink">低风险自动合并 (Auto-Merge)</span>
                <BoolBadge
                  enabled={config.github.autoMergeLowRisk.enabled}
                  trueText="启用"
                  falseText="关闭"
                />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] tabular-nums text-ink-muted">
                <div>
                  允许类别：
                  <span className="selectable font-mono text-ink">
                    {config.github.autoMergeLowRisk.allowedCategories.join(', ') || '-'}
                  </span>
                </div>
                <div>
                  合并方式：
                  <span className="selectable font-mono text-ink">
                    {config.github.autoMergeLowRisk.mergeMethod}
                  </span>
                </div>
                <div>
                  最大复杂度：
                  <span className="font-mono text-ink">
                    C{config.github.autoMergeLowRisk.maxComplexity}
                  </span>
                </div>
                <div>
                  最多改动文件：
                  <span className="font-mono text-ink">
                    {config.github.autoMergeLowRisk.maxFilesChanged}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium tabular-nums text-ink-subtle">
                监听仓库 ({config.github.repositories.length})
              </div>
              {config.github.repositories.length === 0 ? (
                <div className="rounded-[6px] border border-dashed border-hairline px-3 py-2 text-[12.5px] text-ink-subtle">
                  未配置远程仓库（当前适用于 Demo 演练或仅 Webhook 模式）
                </div>
              ) : (
                <div className="space-y-1.5">
                  {config.github.repositories.map((repo) => (
                    <div
                      key={`${repo.owner}/${repo.repo}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[12.5px]"
                    >
                      <span className="selectable font-mono font-medium text-ink">
                        {repo.owner}/{repo.repo}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="selectable font-mono text-ink-subtle">
                          base: {repo.baseBranch}
                        </span>
                        <BoolBadge enabled={repo.enabled} trueText="启用" falseText="停用" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ConfigCard>

        {/* Dual-Channel LLM */}
        <ConfigCard
          icon={<Sparkles className="h-4 w-4 text-primary-text" />}
          title="双通道结构化 LLM 配置"
        >
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <KeyValueRow label="运行通道模式" value={config.llm.mode} mono />
              <KeyValueRow
                label={`API Key (${config.llm.apiKeyEnv})`}
                value={<SecretBadge configured={config.llm.apiKeyConfigured} />}
              />
              <KeyValueRow label="Provider" value={config.llm.provider} mono />
              <KeyValueRow label="Model" value={config.llm.model} mono />
              <KeyValueRow
                label="CLI 兜底 Agent"
                value={config.llm.cliFallbackAgentId || '自动选择可用 CLI'}
                mono
              />
              <KeyValueRow
                label="Temperature / MaxTokens"
                value={`${config.llm.temperature} / ${config.llm.maxTokens}`}
                mono
              />
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface-2 p-3 text-[12.5px]">
              <div className="text-ink-subtle">Base URL</div>
              <div className="selectable mt-0.5 font-mono [overflow-wrap:anywhere] text-ink">
                {config.llm.baseUrl}
              </div>
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface-2 p-3 text-[12.5px] leading-relaxed text-ink-muted">
              <div className="flex items-center gap-1.5 font-medium text-ink">
                <KeyRound className="h-3.5 w-3.5 text-primary-text" />
                <span>双通道容灾机制</span>
              </div>
              <p className="mt-1">
                用于 AI 分诊（Triage）、路由复杂度打分、Spec/Plan 生成等结构化推理；当{' '}
                <code className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-ink">
                  cli_fallback
                </code>{' '}
                模式下 API 未配置或调用失败时，自动降级为本机 Headless Agent CLI 完成推理。
              </p>
            </div>
          </div>
        </ConfigCard>

        {/* Routing Rules */}
        <ConfigCard
          icon={<Route className="h-4 w-4 text-primary-text" />}
          title="多 Agent 智能路由规则"
        >
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <KeyValueRow label="默认主 Agent" value={config.routing.defaultAgent} mono />
              <KeyValueRow
                label="默认 Reviewer"
                value={config.routing.defaultReviewerAgent || '自动异构选择'}
                mono
              />
              <KeyValueRow
                label="交叉 Review 异构模型"
                value={config.routing.crossReviewDifferentAgent ? '强制不同 Agent' : '允许同 Agent'}
              />
              <KeyValueRow
                label="降级顺序 (Fallback)"
                value={config.routing.fallbackOrder.join(' → ')}
                mono
              />
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium tabular-nums text-ink-subtle">
                自定义路由规则 ({config.routing.rules.length})
              </div>
              {config.routing.rules.length === 0 ? (
                <div className="rounded-[6px] border border-dashed border-hairline px-3 py-2 text-[12.5px] text-ink-subtle">
                  暂无显式规则，将结合复杂度与 Agent 擅长领域进行智能路由。
                </div>
              ) : (
                <div className="space-y-2">
                  {config.routing.rules.map((rule) => (
                    <div
                      key={rule.name}
                      className="rounded-[8px] border border-hairline bg-surface-2 p-3 text-[12.5px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{rule.name}</span>
                        <div className="flex items-center gap-1.5 font-mono tabular-nums">
                          <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-ink-subtle">
                            P{rule.priority}
                          </span>
                          <span className="rounded-[4px] border border-primary-border bg-primary-soft px-1.5 py-0.5 text-[11.5px] text-primary-text">
                            → {rule.agentId}
                          </span>
                          {rule.tierOverride && (
                            <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-ink-muted">
                              {rule.tierOverride}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="selectable mt-1.5 flex flex-wrap gap-2 font-mono text-[12px] text-ink-subtle">
                        {rule.match.categories && (
                          <span>categories: [{rule.match.categories.join(', ')}]</span>
                        )}
                        {rule.match.labels && (
                          <span>labels: [{rule.match.labels.join(', ')}]</span>
                        )}
                        {rule.match.titleRegex && <span>regex: /{rule.match.titleRegex}/</span>}
                        {(rule.match.complexityMin !== undefined ||
                          rule.match.complexityMax !== undefined) && (
                          <span>
                            complexity: {rule.match.complexityMin ?? 1}..
                            {rule.match.complexityMax ?? 5}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ConfigCard>

        {/* Workflow Gates & Release & Workspace */}
        <ConfigCard
          icon={<Workflow className="h-4 w-4 text-primary-text" />}
          title="工作流门禁、沙箱与发版模式"
        >
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <KeyValueRow
                label="最大并发任务"
                value={String(config.workflow.maxConcurrentTasks)}
                mono
              />
              <KeyValueRow
                label="Quick Fix 复杂度上限"
                value={`C${config.workflow.quickFixMaxComplexity}`}
                mono
              />
              <KeyValueRow
                label="Full SDLC 计划审批门禁"
                value={config.workflow.requirePlanApprovalForFullSdlc ? '强制人工审批' : '自动放行'}
              />
              <KeyValueRow label="发版模式 (Release)" value={config.release.mode} mono />
              <KeyValueRow label="工作区执行器 (Runner)" value={config.workspace.runner} mono />
              <KeyValueRow
                label="Conventional Commits"
                value={config.release.conventionalCommits ? '启用' : '关闭'}
              />
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface-2 p-3 text-[12.5px]">
              <div className="mb-1.5 font-medium text-ink">自愈重试上限 (Max Retries)</div>
              <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-ink-subtle sm:grid-cols-4">
                <div>
                  Local: <span className="text-ink">{config.workflow.maxLocalFixRetries}</span>
                </div>
                <div>
                  Review: <span className="text-ink">{config.workflow.maxCrossReviewRetries}</span>
                </div>
                <div>
                  CI Fix: <span className="text-ink">{config.workflow.maxCiFixRetries}</span>
                </div>
                <div>
                  PR Fix: <span className="text-ink">{config.workflow.maxReviewFixRetries}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5 rounded-[8px] border border-hairline bg-surface-2 p-3 text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="shrink-0 text-ink-subtle">默认测试命令</span>
                <code className="selectable font-mono [overflow-wrap:anywhere] text-ink">
                  {config.workflow.defaultTestCommand}
                </code>
              </div>
              {config.workflow.defaultBuildCommand && (
                <div className="flex justify-between gap-2">
                  <span className="shrink-0 text-ink-subtle">默认构建命令</span>
                  <code className="selectable font-mono [overflow-wrap:anywhere] text-ink">
                    {config.workflow.defaultBuildCommand}
                  </code>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="shrink-0 text-ink-subtle">Worktree 根目录</span>
                <code className="selectable font-mono [overflow-wrap:anywhere] text-ink-muted">
                  {config.workspace.worktreeRoot}
                </code>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0 text-ink-subtle">Release PR 前缀</span>
                <code className="selectable font-mono [overflow-wrap:anywhere] text-ink-muted">
                  {config.release.releasePrTitlePrefix}
                </code>
              </div>
            </div>
          </div>
        </ConfigCard>

        {/* IM Webhooks */}
        <ConfigCard
          icon={<Bell className="h-4 w-4 text-primary-text" />}
          title="IM Webhook 通知通道"
        >
          {config.notifications.channels.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-hairline p-4 text-center text-[13px] text-ink-subtle">
              尚未配置飞书 / 钉钉 / 企业微信 / Slack / Discord / Telegram 等通知通道
            </div>
          ) : (
            <div className="space-y-2.5 text-[13px]">
              {config.notifications.channels.map((ch) => (
                <div
                  key={ch.id}
                  className="rounded-[8px] border border-hairline bg-surface-2 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-[11.5px] uppercase text-primary-text">
                        {ch.type}
                      </span>
                      <span className="font-medium text-ink">{ch.id}</span>
                    </div>
                    <BoolBadge enabled={ch.enabled} trueText="启用" falseText="停用" />
                  </div>
                  <div className="selectable mt-2 font-mono text-[12px] text-ink-subtle">
                    URL Env: <span className="text-ink">{ch.urlEnv}</span>
                    {ch.secretEnv && (
                      <>
                        {' · '}Secret Env: <span className="text-ink">{ch.secretEnv}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ch.events.map((ev) => (
                      <span
                        key={ev}
                        className="rounded-[4px] border border-hairline bg-surface-1 px-2 py-0.5 font-mono text-[11.5px] text-ink-muted"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConfigCard>

        {/* GitHub Actions Setup Snippet (Theme-following YAML) */}
        <ConfigCard
          icon={<FileCode2 className="h-4 w-4 text-primary-text" />}
          title="GitHub Actions 快速接入片段"
          headerRight={
            <button
              type="button"
              onClick={() => void handleCopySnippet()}
              className="df-btn-secondary min-h-[28px] px-2.5 py-1 text-[12px]"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[var(--df-success)]" />
                  <span className="text-[var(--df-success)]">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-ink-subtle" />
                  <span>复制 YAML</span>
                </>
              )}
            </button>
          }
        >
          <p className="mb-2.5 text-[12.5px] text-ink-muted">
            保存至目标仓库的{' '}
            <code className="selectable rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-ink">
              .github/workflows/dragonflow-ci.yml
            </code>
            ，DragonFlow 将自动监听 PR Check Run 结果并在失败时拉取日志自愈。
          </p>
          <pre className="selectable overflow-x-auto rounded-[8px] border border-hairline bg-surface-2 p-3.5 font-mono text-[13px] leading-[1.6] text-ink">
            <code>{GITHUB_ACTIONS_SNIPPET}</code>
          </pre>
        </ConfigCard>
      </div>
    </div>
  );
}

interface ConfigCardProps {
  icon: React.ReactNode;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

function ConfigCard({ icon, title, headerRight, children }: ConfigCardProps) {
  return (
    <section className="rounded-[10px] border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-hairline pb-2.5">
        <h3 className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
          {icon}
          <span>{title}</span>
        </h3>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

function KeyValueRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[6px] border border-hairline bg-surface-2 px-3 py-2">
      <div className="truncate text-[12px] text-ink-subtle">{label}</div>
      <div
        className={`selectable mt-1 truncate text-[13.5px] tabular-nums text-ink ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SecretBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="df-badge-success inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium">
      <ShieldCheck className="h-3 w-3" />
      <span>已配置</span>
    </span>
  ) : (
    <span className="df-badge-neutral inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium">
      未配置
    </span>
  );
}

function BoolBadge({
  enabled,
  trueText,
  falseText,
}: {
  enabled: boolean;
  trueText: string;
  falseText: string;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${
        enabled ? 'df-badge-success' : 'df-badge-neutral'
      }`}
    >
      {enabled ? trueText : falseText}
    </span>
  );
}
