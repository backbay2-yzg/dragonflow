import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Kanban, Monitor, Moon, Radio, Settings2, Sun, Terminal } from 'lucide-react';
import type {
  AgentHealthInfo,
  DashboardOverview,
  SanitizedConfig,
  SseEvent,
  TaskDetailResponse,
  TaskLogEntry,
  TaskRecord,
} from '@dragonflow/shared';
import {
  approvePlan,
  cancelTask,
  fetchAgents,
  fetchConfig,
  fetchOverview,
  fetchTaskDetail,
  fetchTaskLogs,
  fetchTasks,
  mergeTask,
  probeAgents,
  rejectPlan,
  retryTask,
  simulateIssue,
  syncNow,
  triggerTask,
  useSseEvents,
  type SimulateIssuePayload,
  type SseConnectionStatus,
} from './api/client';
import { AgentPoolView } from './components/AgentPoolView';
import { ConfigView } from './components/ConfigView';
import { KanbanBoard } from './components/KanbanBoard';
import { OverviewBar } from './components/OverviewBar';
import { SimulateIssueModal } from './components/SimulateIssueModal';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { ToastContainer, type ToastItem } from './components/ToastContainer';
import { useTheme } from './hooks/useTheme';
import { formatTimestamp, getErrorMessage } from './utils/format';

type NavTab = 'kanban' | 'agents' | 'config';

function upsertTask(list: TaskRecord[], incoming: TaskRecord): TaskRecord[] {
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index === -1) {
    return [incoming, ...list];
  }
  const next = [...list];
  next[index] = incoming;
  return next;
}

export function App() {
  const { preference: themePreference, cycleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<NavTab>('kanban');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [agents, setAgents] = useState<AgentHealthInfo[]>([]);
  const [config, setConfig] = useState<SanitizedConfig | null>(null);

  const [loadingBoard, setLoadingBoard] = useState(true);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [simSubmitting, setSimSubmitting] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const selectedTaskIdRef = useRef<string | null>(null);
  const overviewTimerRef = useRef<number | null>(null);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (type: ToastItem['type'], title: string, message?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
      window.setTimeout(() => {
        dismissToast(id);
      }, 4500);
    },
    [dismissToast],
  );

  const loadOverview = useCallback(async () => {
    try {
      const data = await fetchOverview();
      setOverview(data);
    } catch {
      // Keep existing overview snapshot if transient network error occurs
    }
  }, []);

  const scheduleOverviewRefresh = useCallback(() => {
    if (overviewTimerRef.current !== null) {
      window.clearTimeout(overviewTimerRef.current);
    }
    overviewTimerRef.current = window.setTimeout(() => {
      overviewTimerRef.current = null;
      void loadOverview();
    }, 250);
  }, [loadOverview]);

  useEffect(() => {
    return () => {
      if (overviewTimerRef.current !== null) {
        window.clearTimeout(overviewTimerRef.current);
      }
    };
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoadingBoard(true);
    setLoadingAgents(true);
    setLoadingConfig(true);

    const [overviewRes, tasksRes, agentsRes, configRes] = await Promise.allSettled([
      fetchOverview(),
      fetchTasks(),
      fetchAgents(),
      fetchConfig(),
    ]);

    if (overviewRes.status === 'fulfilled') {
      setOverview(overviewRes.value);
    } else {
      pushToast('error', '加载概览数据失败', getErrorMessage(overviewRes.reason));
    }

    if (tasksRes.status === 'fulfilled') {
      setTasks(tasksRes.value);
    } else {
      pushToast('error', '加载任务看板失败', getErrorMessage(tasksRes.reason));
    }
    setLoadingBoard(false);

    if (agentsRes.status === 'fulfilled') {
      setAgents(agentsRes.value);
    } else {
      pushToast('error', '加载 Agent 池失败', getErrorMessage(agentsRes.reason));
    }
    setLoadingAgents(false);

    if (configRes.status === 'fulfilled') {
      setConfig(configRes.value);
    } else {
      pushToast('error', '加载系统配置失败', getErrorMessage(configRes.reason));
    }
    setLoadingConfig(false);
  }, [pushToast]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const loadSelectedTask = useCallback(
    async (taskId: string) => {
      setLoadingDetail(true);
      setLoadingLogs(true);
      const [detailRes, logsRes] = await Promise.allSettled([
        fetchTaskDetail(taskId),
        fetchTaskLogs(taskId),
      ]);

      if (selectedTaskIdRef.current !== taskId) return;

      if (detailRes.status === 'fulfilled') {
        setTaskDetail(detailRes.value);
      } else {
        pushToast('error', '获取任务详情失败', getErrorMessage(detailRes.reason));
      }
      setLoadingDetail(false);

      if (logsRes.status === 'fulfilled') {
        setTaskLogs(logsRes.value);
      } else {
        pushToast('error', '获取任务日志失败', getErrorMessage(logsRes.reason));
      }
      setLoadingLogs(false);
    },
    [pushToast],
  );

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskDetail(null);
      setTaskLogs([]);
      return;
    }
    void loadSelectedTask(selectedTaskId);
  }, [selectedTaskId, loadSelectedTask]);

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      switch (event.type) {
        case 'heartbeat':
          break;
        case 'task:updated': {
          setTasks((prev) => upsertTask(prev, event.task));
          setTaskDetail((prev) =>
            prev && prev.task.id === event.task.id ? { ...prev, task: event.task } : prev,
          );
          scheduleOverviewRefresh();
          break;
        }
        case 'task:transitioned': {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.taskId
                ? { ...t, status: event.toStatus, updatedAt: event.timestamp }
                : t,
            ),
          );
          setTaskDetail((prev) => {
            if (!prev || prev.task.id !== event.taskId) return prev;
            const syntheticId = Date.parse(event.timestamp) || Date.now();
            const exists = prev.auditEvents.some(
              (ev) =>
                ev.toStatus === event.toStatus &&
                ev.createdAt === event.timestamp &&
                ev.actor === event.actor,
            );
            return {
              ...prev,
              task: {
                ...prev.task,
                status: event.toStatus,
                updatedAt: event.timestamp,
              },
              auditEvents: exists
                ? prev.auditEvents
                : [
                    ...prev.auditEvents,
                    {
                      id: syntheticId,
                      taskId: event.taskId,
                      fromStatus: event.fromStatus,
                      toStatus: event.toStatus,
                      actor: event.actor,
                      reason: event.reason,
                      createdAt: event.timestamp,
                    },
                  ],
            };
          });
          scheduleOverviewRefresh();
          break;
        }
        case 'run:started':
        case 'run:finished': {
          setTaskDetail((prev) => {
            if (!prev || prev.task.id !== event.run.taskId) return prev;
            const idx = prev.runs.findIndex((r) => r.id === event.run.id);
            const nextRuns =
              idx === -1
                ? [...prev.runs, event.run]
                : prev.runs.map((r, i) => (i === idx ? event.run : r));
            return { ...prev, runs: nextRuns };
          });
          if (event.type === 'run:finished') {
            scheduleOverviewRefresh();
          }
          break;
        }
        case 'log:chunk': {
          if (selectedTaskIdRef.current === event.entry.taskId) {
            setTaskLogs((prev) => {
              if (prev.some((l) => l.id === event.entry.id)) return prev;
              return [...prev, event.entry];
            });
          }
          break;
        }
        case 'artifact:created': {
          setTaskDetail((prev) => {
            if (!prev || prev.task.id !== event.artifact.taskId) return prev;
            if (prev.artifacts.some((a) => a.id === event.artifact.id)) return prev;
            return { ...prev, artifacts: [...prev.artifacts, event.artifact] };
          });
          break;
        }
        case 'agent:health': {
          setAgents(event.agents);
          scheduleOverviewRefresh();
          break;
        }
      }
    },
    [scheduleOverviewRefresh],
  );

  const { status: sseStatus, lastHeartbeatAt } = useSseEvents(handleSseEvent);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await syncNow();
      const [tasksRes, overviewRes] = await Promise.all([fetchTasks(), fetchOverview()]);
      setTasks(tasksRes);
      setOverview(overviewRes);
      if (selectedTaskIdRef.current) {
        void loadSelectedTask(selectedTaskIdRef.current);
      }
      pushToast(
        'success',
        '同步完成',
        `处理 Issue: ${res.issuesProcessed}，检查 PR: ${res.prsChecked}`,
      );
    } catch (err) {
      pushToast('error', '同步失败', getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleProbeAgents = async () => {
    setProbing(true);
    try {
      const list = await probeAgents();
      setAgents(list);
      void loadOverview();
      const availableCount = list.filter((a) => a.enabled && a.available).length;
      pushToast('success', 'CLI 探测完成', `当前共有 ${availableCount} 个 Agent CLI 可用`);
    } catch (err) {
      pushToast('error', '探测 Agent CLI 失败', getErrorMessage(err));
    } finally {
      setProbing(false);
    }
  };

  const handleRefreshConfig = async () => {
    setLoadingConfig(true);
    try {
      const cfg = await fetchConfig();
      setConfig(cfg);
      pushToast('info', '配置已刷新');
    } catch (err) {
      pushToast('error', '刷新配置失败', getErrorMessage(err));
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleSimulateSubmit = async (payload: SimulateIssuePayload) => {
    setSimSubmitting(true);
    try {
      const res = await simulateIssue(payload);
      setTasks((prev) => upsertTask(prev, res.task));
      setSimModalOpen(false);
      setActiveTab('kanban');
      setSelectedTaskId(res.task.id);
      void loadOverview();
      pushToast(
        'success',
        `模拟 Issue #${res.issueNumber} 已创建`,
        payload.autoTrigger ? '已自动进入流水线执行' : '等待手动触发执行',
      );
    } catch (err) {
      pushToast('error', '创建模拟 Issue 失败', getErrorMessage(err));
    } finally {
      setSimSubmitting(false);
    }
  };

  const runTaskAction = async (label: string, fn: () => Promise<TaskRecord>) => {
    setActionBusy(true);
    try {
      const updated = await fn();
      setTasks((prev) => upsertTask(prev, updated));
      setTaskDetail((prev) =>
        prev && prev.task.id === updated.id ? { ...prev, task: updated } : prev,
      );
      void loadOverview();
      if (selectedTaskIdRef.current === updated.id) {
        void fetchTaskDetail(updated.id)
          .then((detail) => {
            if (selectedTaskIdRef.current === updated.id) {
              setTaskDetail(detail);
            }
          })
          .catch(() => {});
      }
      pushToast('success', `${label}成功`, `当前状态：${updated.status}`);
    } catch (err) {
      pushToast('error', `${label}失败`, getErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const ThemeIcon =
    themePreference === 'light' ? Sun : themePreference === 'dark' ? Moon : Monitor;
  const themeLabel =
    themePreference === 'light' ? '浅色' : themePreference === 'dark' ? '深色' : '跟随系统';

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      {/* Top 52px Sticky Bar */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface-1">
        <div className="mx-auto flex min-h-[52px] max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-1.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-primary-border bg-primary-soft text-primary-text">
              <Terminal className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight text-ink">
                DragonFlow
              </span>
              <span className="hidden rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-muted sm:inline-flex">
                Mission Control
              </span>
            </div>
          </div>

          <nav
            aria-label="主视图切换"
            className="flex items-center gap-0.5 rounded-[8px] border border-hairline bg-canvas p-[2px]"
          >
            <NavTabButton
              active={activeTab === 'kanban'}
              onClick={() => setActiveTab('kanban')}
              icon={<Kanban className="h-4 w-4" />}
              label="任务看板"
              badge={tasks.length}
            />
            <NavTabButton
              active={activeTab === 'agents'}
              onClick={() => setActiveTab('agents')}
              icon={<Cpu className="h-4 w-4" />}
              label="Agent 池"
              badge={agents.filter((a) => a.enabled && a.available).length}
            />
            <NavTabButton
              active={activeTab === 'config'}
              onClick={() => setActiveTab('config')}
              icon={<Settings2 className="h-4 w-4" />}
              label="系统配置"
            />
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleTheme}
              title={`主题模式: ${themeLabel}（点击切换）`}
              className="df-btn-secondary min-h-[32px] px-3 py-1 text-[12.5px] text-ink-muted"
            >
              <ThemeIcon className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{themeLabel}</span>
            </button>

            <SseStatusPill status={sseStatus} lastHeartbeatAt={lastHeartbeatAt} />
          </div>
        </div>
      </header>

      {/* KPI Overview */}
      <OverviewBar
        overview={overview}
        syncing={syncing}
        onSyncNow={() => void handleSyncNow()}
        onOpenSimulateModal={() => setSimModalOpen(true)}
      />

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-3 sm:px-6">
        {activeTab === 'kanban' && (
          <KanbanBoard
            tasks={tasks}
            loading={loadingBoard}
            selectedTaskId={selectedTaskId}
            overlayOpen={selectedTaskId !== null || simModalOpen}
            onSelectTask={(id) => setSelectedTaskId(id)}
          />
        )}

        {activeTab === 'agents' && (
          <AgentPoolView
            agents={agents}
            loading={loadingAgents}
            probing={probing}
            onProbeAgents={() => void handleProbeAgents()}
          />
        )}

        {activeTab === 'config' && (
          <ConfigView
            config={config}
            loading={loadingConfig}
            onRefresh={() => void handleRefreshConfig()}
          />
        )}
      </main>

      {/* Slide-over Task Detail Drawer */}
      <TaskDetailDrawer
        open={selectedTaskId !== null}
        detail={taskDetail}
        logs={taskLogs}
        loadingDetail={loadingDetail}
        loadingLogs={loadingLogs}
        agents={agents}
        actionBusy={actionBusy}
        onClose={() => setSelectedTaskId(null)}
        onTrigger={(taskId, agentId) =>
          runTaskAction('触发任务', () => triggerTask(taskId, agentId))
        }
        onApprovePlan={(taskId) => runTaskAction('批准计划', () => approvePlan(taskId))}
        onRejectPlan={(taskId, feedback) =>
          runTaskAction('驳回计划', () => rejectPlan(taskId, feedback))
        }
        onRetry={(taskId, agentId) =>
          runTaskAction('重试任务', () => retryTask(taskId, agentId))
        }
        onMerge={(taskId) => runTaskAction('合并 PR', () => mergeTask(taskId))}
        onCancel={(taskId) => runTaskAction('取消任务', () => cancelTask(taskId))}
      />

      {/* Demo Simulate Issue Modal */}
      <SimulateIssueModal
        open={simModalOpen}
        submitting={simSubmitting}
        onClose={() => setSimModalOpen(false)}
        onSubmit={handleSimulateSubmit}
      />

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function NavTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-3 py-1 text-[13.5px] font-medium transition duration-150 ${
        active
          ? 'border-hairline-strong bg-surface-2 text-ink'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      <span className={active ? 'text-primary-text' : 'text-ink-subtle'}>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.2 font-mono text-[12px] tabular-nums ${
            active
              ? 'bg-primary-soft text-primary-text'
              : 'bg-surface-2 text-ink-subtle'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function SseStatusPill({
  status,
  lastHeartbeatAt,
}: {
  status: SseConnectionStatus;
  lastHeartbeatAt: string | null;
}) {
  const meta =
    status === 'connected'
      ? {
          label: 'SSE 实时连接',
          dot: 'bg-current df-pulse-dot',
          badge: 'df-badge-success',
        }
      : status === 'disconnected'
        ? {
            label: 'SSE 已断开',
            dot: 'bg-current',
            badge: 'df-badge-danger',
          }
        : {
            label: status === 'reconnecting' ? 'SSE 重连中' : 'SSE 连接中',
            dot: 'bg-current df-pulse-dot',
            badge: 'df-badge-waiting',
          };

  return (
    <div
      title={
        lastHeartbeatAt
          ? `最近心跳：${formatTimestamp(lastHeartbeatAt)}`
          : '等待服务端 SSE 心跳'
      }
      className={`inline-flex h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium tabular-nums ${meta.badge}`}
    >
      <Radio className="h-3 w-3 shrink-0" />
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      <span>{meta.label}</span>
    </div>
  );
}

export default App;
