import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  ExternalLink,
  FlaskConical,
  GitMerge,
  Play,
  Power,
  RefreshCw,
  Settings2,
} from "lucide-react";
import {
  TaskStatus,
  type DesktopInfo,
  type TaskRecord,
  type TraySnapshot,
} from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import * as AppService from "../../bindings/github.com/dragonflow/desktop/services/appservice";
import * as DashboardService from "../../bindings/github.com/dragonflow/desktop/services/dashboardservice";
import { StatusBadge } from "../components/StatusBadge";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { useWailsEvents } from "../hooks/useWailsEvents";
import { formatRelativeTime } from "../utils/format";

export function TrayFlyout() {
  const [snapshot, setSnapshot] = useState<TraySnapshot | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  useTheme(((desktopInfo?.theme as ThemePreference | undefined) ?? "system"));

  const refresh = useCallback(async () => {
    try {
      const [snap, info] = await Promise.all([
        DashboardService.GetTraySnapshot(),
        AppService.GetDesktopInfo(),
      ]);
      setSnapshot(snap);
      setDesktopInfo(info);
    } catch {
      // ignore transient startup calls
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useWailsEvents({
    onAppEvent: () => {
      void refresh();
    },
  });

  const handleOpenMain = async (focusTaskID = "", tab = "kanban") => {
    try {
      await AppService.ShowMainWindow(focusTaskID, tab);
    } catch {
      // ignore
    }
  };

  const handleQuickAction = async (task: TaskRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setBusyTaskId(task.id);
    try {
      if (task.status === TaskStatus.StatusAwaitingPlanApproval) {
        await DashboardService.ApprovePlan(task.id);
      } else if (task.status === TaskStatus.StatusReadyToMerge) {
        await DashboardService.MergeTask(task.id);
      } else if (task.status === TaskStatus.StatusAwaitingTrigger) {
        await DashboardService.TriggerTask(task.id, "");
      } else {
        await handleOpenMain(task.id, "kanban");
      }
      await refresh();
    } catch {
      await handleOpenMain(task.id, "kanban");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await DashboardService.SyncNow();
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const isDemo = (snapshot?.mode ?? desktopInfo?.mode ?? "demo") === "demo";
  const pendingTasks = snapshot?.pendingTasks ?? [];
  const recentTasks = snapshot?.recentTasks ?? [];

  return (
    <div className="df-flyout-shell flex h-screen w-screen flex-col overflow-hidden rounded-[12px] text-ink select-none">
      {/* Header (48px) */}
      <header className="flex h-[48px] shrink-0 items-center justify-between border-b border-hairline px-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/dragonflow.png" alt="DragonFlow" className="h-5 w-5 shrink-0 rounded-[4px]" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-semibold leading-tight text-ink">DragonFlow</span>
              <span
                className={`rounded-full border px-1.5 py-0.2 text-[11px] font-semibold ${
                  isDemo ? "df-badge-waiting" : "df-badge-success"
                }`}
              >
                {isDemo ? "Demo" : "Live"}
              </span>
            </div>
            <div className="truncate font-mono text-[11.5px] leading-tight text-ink-subtle">
              {snapshot?.repoFullName || "builtin/demo"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="df-btn-secondary min-h-[30px] shrink-0 p-1.5 text-ink-muted"
          title="立即同步检查"
          aria-label="立即同步检查"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Metrics Strip */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-hairline px-3 py-2">
        <div className="df-flyout-card rounded-[8px] px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-[11.5px] text-ink-subtle">
            <Activity className="h-3 w-3 text-primary-text" />
            <span>进行中</span>
          </div>
          <div className="mt-0.5 font-mono text-[16px] leading-tight font-semibold tabular-nums text-ink">
            {snapshot?.activeTasks ?? 0}
          </div>
        </div>
        <div className="df-flyout-card rounded-[8px] px-2 py-1.5 text-center">
          <div className="text-[11.5px] text-ink-subtle">总任务</div>
          <div className="mt-0.5 font-mono text-[16px] leading-tight font-semibold tabular-nums text-ink">
            {snapshot?.totalTasks ?? 0}
          </div>
        </div>
        <div className="df-flyout-card rounded-[8px] px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-[11.5px] text-ink-subtle">
            <Bot className="h-3 w-3 text-[var(--df-success)]" />
            <span>可用 CLI</span>
          </div>
          <div className="mt-0.5 font-mono text-[16px] leading-tight font-semibold tabular-nums text-ink">
            {snapshot?.availableAgents ?? 0}/{snapshot?.totalAgents ?? 0}
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {/* Pending Human Gates */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12.5px] font-semibold text-ink-muted">
            <span>待处理卡点</span>
            <span className="font-mono text-[11.5px] tabular-nums text-ink-subtle">
              {pendingTasks.length} 项
            </span>
          </div>

          {pendingTasks.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-hairline px-3 py-2.5 text-center text-[12px] text-ink-subtle">
              当前没有待审批或待合并任务
            </div>
          ) : (
            <div className="space-y-1.5">
              {pendingTasks.map((task) => {
                const isBusy = busyTaskId === task.id;
                const actionLabel =
                  task.status === TaskStatus.StatusAwaitingPlanApproval
                    ? "批准方案"
                    : task.status === TaskStatus.StatusReadyToMerge
                      ? "合并 PR"
                      : task.status === TaskStatus.StatusAwaitingTrigger
                        ? "触发执行"
                        : "查看";
                const ActionIcon =
                  task.status === TaskStatus.StatusAwaitingPlanApproval
                    ? Check
                    : task.status === TaskStatus.StatusReadyToMerge
                      ? GitMerge
                      : task.status === TaskStatus.StatusAwaitingTrigger
                        ? Play
                        : ExternalLink;

                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleOpenMain(task.id, "kanban")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleOpenMain(task.id, "kanban");
                      }
                    }}
                    className="df-flyout-card flex cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 transition duration-150"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11.5px] font-semibold tabular-nums text-primary-text">
                          #{task.issueNumber}
                        </span>
                        <StatusBadge status={task.status} size="xs" />
                      </div>
                      <div className="mt-1 truncate text-[13px] font-medium text-ink">
                        {task.issueTitle}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={(e) => void handleQuickAction(task, e)}
                      className="df-btn-primary min-h-[28px] shrink-0 gap-1 px-2.5 py-1 text-[12px]"
                    >
                      <ActionIcon className="h-3 w-3" />
                      <span>{isBusy ? "..." : actionLabel}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink-muted">近期任务动态</div>
          {recentTasks.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-hairline px-3 py-2.5 text-center text-[12px] text-ink-subtle">
              暂无任务记录
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentTasks.slice(0, 5).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => void handleOpenMain(task.id, "kanban")}
                  className="df-flyout-card flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left transition duration-150"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">
                      <span className="mr-1 font-mono text-[11.5px] tabular-nums text-ink-subtle">
                        #{task.issueNumber}
                      </span>
                      {task.issueTitle}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
                      <StatusBadge status={task.status} size="xs" />
                      {task.assignedAgent && (
                        <span className="truncate font-mono">{task.assignedAgent}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-subtle">
                    {formatRelativeTime(task.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Quick Bar (48px) */}
      <footer className="flex h-[48px] shrink-0 items-center justify-between gap-1.5 border-t border-hairline px-3">
        <button
          type="button"
          onClick={() => void handleOpenMain("", "kanban")}
          className="df-btn-primary min-h-[32px] flex-1 px-2.5 py-1 text-[13px]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>打开主控台</span>
        </button>

        {isDemo && (
          <button
            type="button"
            onClick={() => void handleOpenMain("", "simulate")}
            className="df-btn-secondary min-h-[32px] px-2.5 py-1 text-[13px]"
            title="新建演练 Issue"
          >
            <FlaskConical className="h-3.5 w-3.5 text-primary-text" />
            <span>演练</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleOpenMain("", "config")}
          className="df-btn-secondary min-h-[32px] p-1.5 text-ink-muted"
          title="系统配置"
          aria-label="系统配置"
        >
          <Settings2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => void AppService.QuitApp()}
          className="df-btn-danger min-h-[32px] p-1.5"
          title="彻底退出 DragonFlow"
          aria-label="彻底退出 DragonFlow"
        >
          <Power className="h-4 w-4" />
        </button>
      </footer>
    </div>
  );
}
