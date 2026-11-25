import {
  Activity,
  Bot,
  CheckCircle2,
  Coins,
  FlaskConical,
  GitBranch,
  Info,
  Layers,
  RefreshCw,
  X,
} from "lucide-react";
import type { DashboardOverview } from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import { formatDuration, formatTokens, formatUsd } from "../utils/format";

interface OverviewBarProps {
  overview: DashboardOverview | null;
  syncing: boolean;
  showFirstLaunchBanner: boolean;
  gitAvailable: boolean;
  onDismissBanner: () => void;
  onGoConfig: () => void;
  onSyncNow: () => void;
  onOpenSimulateModal: () => void;
}

export function OverviewBar({
  overview,
  syncing,
  showFirstLaunchBanner,
  gitAvailable,
  onDismissBanner,
  onGoConfig,
  onSyncNow,
  onOpenSimulateModal,
}: OverviewBarProps) {
  const isDemo = overview?.mode === "demo";

  return (
    <section className="space-y-2.5 border-b border-hairline bg-surface-1 px-4 py-3 sm:px-5">
      {showFirstLaunchBanner && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-hairline-strong bg-surface-2 px-3 py-2 text-[13px]">
          <div className="flex items-center gap-2 text-ink">
            <Info className="h-4 w-4 shrink-0 text-primary-text" />
            <span>
              当前以 <strong>零密钥 Demo 模式</strong> 运行：点击右侧「模拟 Issue」即可体验完整 6 阶段研发闭环，或前往{" "}
              <button
                type="button"
                onClick={onGoConfig}
                className="font-semibold text-primary-text underline underline-offset-2 hover:opacity-80"
              >
                系统配置
              </button>{" "}
              填入 GitHub Token 并切换为 Live 实战模式。
              {!gitAvailable && "（提示：未检测到本机 Git，已自动启用内置演练工作区）"}
            </span>
          </div>
          <button
            type="button"
            onClick={onDismissBanner}
            className="df-btn-ghost min-h-[26px] p-1 text-ink-subtle"
            aria-label="关闭引导"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold tracking-wide ${
              isDemo ? "df-badge-waiting" : "df-badge-success"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-current ${isDemo ? "" : "df-pulse-dot"}`}
            />
            {overview ? (isDemo ? "DEMO 演练模式" : "LIVE 实战模式") : "模式加载中"}
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
            <RefreshCw className={`h-3.5 w-3.5 text-ink-subtle ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "同步中..." : "Sync Now"}</span>
          </button>

          {isDemo && (
            <button
              type="button"
              onClick={onOpenSimulateModal}
              className="df-btn-primary ps-2.5 pe-3"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>模拟 Issue</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          icon={<Activity className="h-3.5 w-3.5 text-ink-subtle" />}
          label="活跃任务 (Active)"
          value={overview ? String(overview.activeTasks) : "--"}
          sub="进行中 / 等待审批与处理"
        />
        <KpiCard
          icon={<Layers className="h-3.5 w-3.5 text-ink-subtle" />}
          label="累计任务 (Total)"
          value={overview ? String(overview.totalTasks) : "--"}
          sub={overview ? `${overview.byStatus?.RELEASED ?? 0} 个已发版` : "加载中"}
        />
        <KpiCard
          icon={<Bot className="h-3.5 w-3.5 text-ink-subtle" />}
          label="可用 Agent CLI"
          value={overview ? `${overview.availableAgentsCount} / ${overview.totalAgentsCount}` : "--"}
          sub={
            overview
              ? overview.availableAgentsCount > 0
                ? "多 Agent 调度池就绪"
                : "暂无可用编码 CLI"
              : "探测中"
          }
        />
        <KpiCard
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-ink-subtle" />}
          label="任务成功率"
          value={overview ? `${overview.successRate.toFixed(1)}%` : "--"}
          sub="已完结任务占比"
        />
        <KpiCard
          icon={<Coins className="h-3.5 w-3.5 text-ink-subtle" />}
          label="Tokens & Cost"
          value={
            overview
              ? `${formatTokens(overview.totalTokens)} · ${formatUsd(overview.estimatedCostUsd)}`
              : "--"
          }
          sub="累计模型消耗估算"
          className="col-span-2 sm:col-span-1"
        />
      </div>
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[8px] border border-hairline bg-surface-2 px-3.5 py-2.5 ${className}`}>
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
