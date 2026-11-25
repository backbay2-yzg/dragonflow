import { AlertCircle, CheckCircle2, Cpu, RefreshCw, Terminal, Wrench } from 'lucide-react';
import type { AgentHealthInfo } from '@dragonflow/shared';
import { formatTimestamp } from '../utils/format';

interface AgentPoolViewProps {
  agents: AgentHealthInfo[];
  loading: boolean;
  probing: boolean;
  onProbeAgents: () => void;
}

const COST_TIER_BADGE: Record<AgentHealthInfo['costTier'], { label: string; className: string }> = {
  low: {
    label: '低成本 (Low)',
    className: 'df-badge-success',
  },
  medium: {
    label: '中等成本 (Med)',
    className: 'df-badge-waiting',
  },
  high: {
    label: '高算力 (High)',
    className: 'df-badge-neutral',
  },
};

export function AgentPoolView({
  agents,
  loading,
  probing,
  onProbeAgents,
}: AgentPoolViewProps) {
  const enabledCount = agents.filter((a) => a.enabled).length;
  const availableCount = agents.filter((a) => a.enabled && a.available).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <Cpu className="h-4 w-4 text-primary-text" />
            <span>多 Agent CLI 调度池健康状态</span>
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            实时探测本机已安装的编程 Agent CLI，支持跨 Agent 路由与配额耗尽自动降级切换。
            <span className="ml-2 font-mono tabular-nums text-ink">
              可用 {availableCount} / 已启用 {enabledCount} / 总计 {agents.length}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onProbeAgents}
          disabled={probing}
          className="df-btn-primary ps-3 pe-3.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
          <span>{probing ? '正在探测 CLI...' : '重新探测本机 CLI'}</span>
        </button>
      </div>

      {loading && agents.length === 0 ? (
        <div className="flex h-56 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
          正在获取 Agent 池状态...
        </div>
      ) : agents.length === 0 ? (
        <div className="flex h-56 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
          尚未配置任何 Agent Profile
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const costMeta = COST_TIER_BADGE[agent.costTier];
            const statusDotClass = !agent.enabled
              ? 'bg-[var(--df-neutral)]'
              : agent.available
                ? 'bg-[var(--df-success)]'
                : 'bg-[var(--df-danger)]';

            return (
              <div
                key={agent.id}
                className="flex flex-col justify-between rounded-[10px] border border-hairline bg-surface-2 p-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`}
                        title={!agent.enabled ? '已禁用' : agent.available ? '可用' : '不可用'}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[15px] font-semibold text-ink">
                            {agent.displayName}
                          </h3>
                          {!agent.enabled && (
                            <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[12px] text-ink-subtle">
                              已禁用
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px] text-ink-subtle">
                          <span>id: {agent.id}</span>
                          <span>·</span>
                          <span>type: {agent.type}</span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-medium ${costMeta.className}`}
                    >
                      {costMeta.label}
                    </span>
                  </div>

                  <div className="space-y-1.5 rounded-[8px] border border-hairline-subtle bg-surface-1 p-3 text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex shrink-0 items-center gap-1.5 text-ink-subtle">
                        <Terminal className="h-3.5 w-3.5" />
                        <span>命令</span>
                      </span>
                      <code className="selectable font-mono text-ink">{agent.command}</code>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <span className="shrink-0 text-ink-subtle">解析路径</span>
                      <code className="selectable min-w-0 text-right font-mono [overflow-wrap:anywhere] text-ink-muted">
                        {agent.resolvedPath || '未检测到可执行文件'}
                      </code>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="flex shrink-0 items-center gap-1.5 text-ink-subtle">
                        <Wrench className="h-3.5 w-3.5" />
                        <span>版本</span>
                      </span>
                      <code className="selectable font-mono tabular-nums text-ink-muted">
                        {agent.version || '未知'}
                      </code>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[12px] font-medium text-ink-subtle">擅长能力</div>
                    {agent.strengths.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {agent.strengths.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-[4px] border border-hairline bg-surface-1 px-2 py-0.5 text-[12px] text-ink-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-subtle">通用编码能力</span>
                    )}
                  </div>

                  {!agent.available && agent.error && (
                    <div className="df-badge-danger selectable flex items-start gap-2 rounded-[6px] border px-2.5 py-2 text-[12.5px]">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                        {agent.error}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-hairline-subtle pt-2.5 text-[12px] text-ink-subtle">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {agent.available && agent.enabled ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--df-success)]" />
                        <span className="text-[var(--df-success)]">在线就绪</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-[var(--df-danger)]" />
                        <span className="text-[var(--df-danger)]">
                          {agent.enabled ? '不可用' : '已禁用'}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums">
                    探测于 {formatTimestamp(agent.lastCheckedAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
