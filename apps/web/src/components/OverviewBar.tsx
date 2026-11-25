import {
  Activity,
  Bot,
  CheckCircle2,
  Coins,
  FlaskConical,
  GitBranch,
  Layers,
  RefreshCw,
} from 'lucide-react';
import type { DashboardOverview } from '@dragonflow/shared';
import { formatDuration, formatTokens, formatUsd } from '../utils/format';

interface OverviewBarProps {
  overview: DashboardOverview | null;
  syncing: boolean;
  onSyncNow: () => void;
  onOpenSimulateModal: () => void;
}

export function OverviewBar({
  overview,
  syncing,
  onSyncNow,
  onOpenSimulateModal,
}: OverviewBarProps) {
  const isDemo = overview?.mode === 'demo';

  return (
    <section className="border-b border-hairline bg-surface-1 px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-[1800px] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold tracking-wide ${
                isDemo ? 'df-badge-waiting' : 'df-badge-success'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full bg-current ${isDemo ? '' : 'df-pulse-dot'}`}
              />
              {overview ? (isDemo ? 'DEMO 演练模式' : 'LIVE 实战模式') : '模式加载中'}
            </span>

            {overview?.repoFullName && (
              <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[12.5px] text-ink-muted">
                <GitBranch className="h-3.5 w-3.5 text-ink-subtle" />
                {overview.repoFullName}
              </span>
            )}

            {overview && overview.avgDurationMs > 0 && (
              <span className="hidden rounded-[6px] border border-hairline bg-surface-2 px-2.5 py-1 font-mono text-[12.5px] tabular-nums text-ink-subtle md:inline-flex">
                平均耗时 {formatDuration(overview.avgDurationMs)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncing}
              className="df-btn-secondary ps-2.5 pe-3"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-ink-subtle ${syncing ? 'animate-spin' : ''}`}
              />
              <span>{syncing ? '同步中...' : 'Sync Now'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenSimulateModal}
              className="df-btn-primary ps-2.5 pe-3"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>模拟 Issue</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            icon={<Activity className="h-3.5 w-3.5 text-ink-subtle" />}
            label="活跃任务 (Active)"
            value={overview ? String(overview.activeTasks) : '--'}
            sub="进行中 / 等待审批与处理"
          />
          <KpiCard
            icon={<Layers className="h-3.5 w-3.5 text-ink-subtle" />}
            label="累计任务 (Total)"
            value={overview ? String(overview.totalTasks) : '--'}
            sub={overview ? `${overview.byStatus['RELEASED'] ?? 0} 个已发版` : '加载中'}
          />
          <KpiCard
            icon={<Bot className="h-3.5 w-3.5 text-ink-subtle" />}
            label="可用 Agent CLI"
            value={
              overview ? `${overview.availableAgentsCount} / ${overview.totalAgentsCount}` : '--'
            }
            sub={
              overview
                ? overview.availableAgentsCount > 0
                  ? 'CLI 引擎就绪'
                  : '暂无可用本机 CLI'
                : '探测中'
            }
          />
          <KpiCard
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-ink-subtle" />}
            label="任务成功率"
            value={overview ? `${overview.successRate.toFixed(1)}%` : '--'}
            sub="已完结任务占比"
          />
          <KpiCard
            icon={<Coins className="h-3.5 w-3.5 text-ink-subtle" />}
            label="Tokens & Cost"
            value={
              overview
                ? `${formatTokens(overview.totalTokens)} · ${formatUsd(overview.estimatedCostUsd)}`
                : '--'
            }
            sub="累计模型消耗估算"
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </div>
    </section>
  );
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  className?: string;
}

function KpiCard({ icon, label, value, sub, className = '' }: KpiCardProps) {
  return (
    <div
      className={`rounded-[8px] border border-hairline bg-surface-2 px-3.5 py-2.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-muted">
        <span className="truncate">{label}</span>
        {icon}
      </div>
      <div className="mt-1 font-mono text-[24px] leading-[1.2] font-semibold tracking-[-0.4px] tabular-nums text-ink">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] tabular-nums text-ink-subtle">{sub}</div>
    </div>
  );
}
