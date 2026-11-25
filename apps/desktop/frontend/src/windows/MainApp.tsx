import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentHealthInfo,
  AppEvent,
  DashboardOverview,
  DesktopInfo,
  SanitizedConfig,
  SecretStatus,
  SimulateIssueInput,
  TaskDetailResponse,
  TaskLogEntry,
  TaskRecord,
} from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import * as AgentService from "../../bindings/github.com/dragonflow/desktop/services/agentservice";
import * as AppService from "../../bindings/github.com/dragonflow/desktop/services/appservice";
import * as ConfigService from "../../bindings/github.com/dragonflow/desktop/services/configservice";
import * as DashboardService from "../../bindings/github.com/dragonflow/desktop/services/dashboardservice";
import { AgentPoolView } from "../components/AgentPoolView";
import { ConfigEditorView } from "../components/ConfigEditorView";
import { KanbanBoard } from "../components/KanbanBoard";
import { OverviewBar } from "../components/OverviewBar";
import { SimulateIssueModal } from "../components/SimulateIssueModal";
import { TaskDetailDrawer } from "../components/TaskDetailDrawer";
import { Titlebar, type NavTab } from "../components/Titlebar";
import { ToastContainer, type ToastItem } from "../components/ToastContainer";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { useWailsEvents } from "../hooks/useWailsEvents";
import { getErrorMessage } from "../utils/format";

export function MainApp() {
  const [activeTab, setActiveTab] = useState<NavTab>("kanban");
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [agents, setAgents] = useState<AgentHealthInfo[]>([]);
  const [config, setConfig] = useState<SanitizedConfig | null>(null);
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);

  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [probingAgents, setProbingAgents] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [simulateModalOpen, setSimulateModalOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  selectedTaskIdRef.current = selectedTaskId;

  const { preference: themePreference, changeTheme } = useTheme(
    ((desktopInfo?.theme as ThemePreference | undefined) ?? "system"),
  );

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (type: "success" | "error" | "info", title: string, message?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
      const timer = setTimeout(() => {
        toastTimers.current.delete(id);
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 4500);
      toastTimers.current.set(id, timer);
    },
    [],
  );

  useEffect(() => {
    return () => {
      for (const t of toastTimers.current.values()) {
        clearTimeout(t);
      }
      toastTimers.current.clear();
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    };
  }, []);

  const loadCoreData = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) {
        setLoadingTasks(true);
        setLoadingAgents(true);
      }
      try {
        const [ovRes, tasksRes, agentsRes, cfgRes, secRes, infoRes] = await Promise.all([
          DashboardService.GetOverview(),
          DashboardService.ListTasks("", ""),
          AgentService.ListAgents(),
          ConfigService.GetConfig(),
          ConfigService.GetSecretsStatus(),
          AppService.GetDesktopInfo(),
        ]);
        setOverview(ovRes);
        setTasks(tasksRes ?? []);
        setAgents(agentsRes ?? []);
        setConfig(cfgRes);
        setSecrets(secRes ?? []);
        setDesktopInfo(infoRes);
      } catch (err) {
        pushToast("error", "加载桌面数据失败", getErrorMessage(err));
      } finally {
        if (showSpinner) {
          setLoadingTasks(false);
          setLoadingAgents(false);
        }
      }
    },
    [pushToast],
  );

  const loadTaskInspector = useCallback(
    async (taskID: string, showSpinner = true) => {
      if (showSpinner) {
        setLoadingDetail(true);
        setLoadingLogs(true);
      }
      try {
        const [detailRes, logsRes] = await Promise.all([
          DashboardService.GetTaskDetail(taskID),
          DashboardService.GetTaskLogs(taskID, 500, 0),
        ]);
        if (selectedTaskIdRef.current === taskID) {
          setTaskDetail(detailRes);
          setTaskLogs(logsRes ?? []);
        }
      } catch (err) {
        if (showSpinner) {
          pushToast("error", "获取任务详情失败", getErrorMessage(err));
        }
      } finally {
        if (showSpinner) {
          setLoadingDetail(false);
          setLoadingLogs(false);
        }
      }
    },
    [pushToast],
  );

  useEffect(() => {
    void loadCoreData(true);
  }, [loadCoreData]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskDetail(null);
      setTaskLogs([]);
      return;
    }
    void loadTaskInspector(selectedTaskId, true);
  }, [selectedTaskId, loadTaskInspector]);

  const scheduleRefresh = useCallback((refreshDetailTaskId?: string) => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void Promise.all([
        DashboardService.GetOverview(),
        DashboardService.ListTasks("", ""),
        AppService.GetDesktopInfo(),
      ])
        .then(([ovRes, tasksRes, infoRes]) => {
          setOverview(ovRes);
          setTasks(tasksRes ?? []);
          setDesktopInfo(infoRes);
        })
        .catch(() => {});

      const targetId = refreshDetailTaskId ?? selectedTaskIdRef.current;
      if (targetId && selectedTaskIdRef.current === targetId) {
        void DashboardService.GetTaskDetail(targetId)
          .then((detailRes) => {
            if (selectedTaskIdRef.current === targetId) {
              setTaskDetail(detailRes);
            }
          })
          .catch(() => {});
      }
    }, 150);
  }, []);

  useWailsEvents({
    onAppEvent: (ev: AppEvent) => {
      if (ev.type === "task:log" && ev.entry && ev.taskId === selectedTaskIdRef.current) {
        const entry = ev.entry;
        setTaskLogs((prev) => {
          if (prev.some((existing) => existing.id === entry.id)) {
            return prev;
          }
          const next = [...prev, entry];
          return next.length > 600 ? next.slice(next.length - 600) : next;
        });
        return;
      }

      if (ev.type === "agents:probed" && ev.agents) {
        setAgents(ev.agents);
      }

      if (ev.type === "mode:changed" || ev.type === "config:saved") {
        void loadCoreData(false);
        return;
      }

      scheduleRefresh(ev.taskId);
    },
    onFocusTask: (taskID: string) => {
      setActiveTab("kanban");
      setSelectedTaskId(taskID);
    },
    onNavigate: (tab: string) => {
      if (tab === "simulate") {
        setActiveTab("kanban");
        setSimulateModalOpen(true);
        return;
      }
      if (tab === "kanban" || tab === "agents" || tab === "config") {
        setActiveTab(tab);
      }
    },
  });

  const handleSwitchMode = async (nextMode: "demo" | "live") => {
    const curMode = overview?.mode ?? desktopInfo?.mode ?? "demo";
    if (nextMode === curMode) return;
    setSwitchingMode(true);
    try {
      const nextCfg = await ConfigService.SwitchMode(nextMode);
      setConfig(nextCfg);
      setSelectedTaskId(null);
      await loadCoreData(false);
      pushToast(
        "success",
        nextMode === "demo" ? "已切换至 Demo 演练模式" : "已切换至 Live 实战模式",
        nextMode === "demo"
          ? "零密钥本地演练，不会对外部仓库产生变更。"
          : "已启用真实 GitHub 与本地 Worktree/CLI 管道。",
      );
    } catch (err) {
      pushToast("error", "切换运行模式失败", getErrorMessage(err));
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleCycleTheme = () => {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const idx = order.indexOf(themePreference);
    const next = order[(idx + 1) % order.length];
    void changeTheme(next);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await DashboardService.SyncNow();
      await loadCoreData(false);
      if (selectedTaskId) {
        await loadTaskInspector(selectedTaskId, false);
      }
      pushToast(
        "success",
        "同步检查完成",
        `新处理 Issue ${res.issuesProcessed} 个，检查 PR 状态 ${res.prsChecked} 个。`,
      );
    } catch (err) {
      pushToast("error", "同步失败", getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleProbeAgents = async () => {
    setProbingAgents(true);
    try {
      const probed = await AgentService.ProbeAgents();
      setAgents(probed ?? []);
      const ov = await DashboardService.GetOverview();
      setOverview(ov);
      pushToast("success", "CLI 探测完成", "已刷新本机编码 CLI 可用性与版本状态。");
    } catch (err) {
      pushToast("error", "探测 CLI 失败", getErrorMessage(err));
    } finally {
      setProbingAgents(false);
    }
  };

  const handleSimulateSubmit = async (payload: SimulateIssueInput) => {
    setSimulating(true);
    try {
      const res = await DashboardService.SimulateIssue(payload);
      setSimulateModalOpen(false);
      await loadCoreData(false);
      if (res?.task?.id) {
        setActiveTab("kanban");
        setSelectedTaskId(res.task.id);
      }
      pushToast("success", `已创建演练任务 #${res.issueNumber}`, payload.title ?? "流水线已触发");
    } catch (err) {
      pushToast("error", "模拟 Issue 失败", getErrorMessage(err));
    } finally {
      setSimulating(false);
    }
  };

  const runTaskAction = async (
    label: string,
    fn: () => Promise<TaskRecord>,
    taskID: string,
  ) => {
    setActionBusy(true);
    try {
      await fn();
      await Promise.all([loadCoreData(false), loadTaskInspector(taskID, false)]);
      pushToast("success", `${label}已执行`);
    } catch (err) {
      pushToast("error", `${label}失败`, getErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const currentMode = overview?.mode ?? desktopInfo?.mode ?? "demo";
  const availableAgentsCount = agents.filter((a) => a.enabled && a.available).length;
  const showFirstLaunchBanner =
    !bannerDismissed && currentMode === "demo" && Boolean(desktopInfo?.isFirstLaunch);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
      <Titlebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        tasksCount={tasks.length}
        availableAgentsCount={availableAgentsCount}
        mode={currentMode}
        switchingMode={switchingMode}
        onSwitchMode={(m) => void handleSwitchMode(m)}
        themePreference={themePreference}
        onCycleTheme={handleCycleTheme}
        onMinimize={() => void AppService.MinimizeMain()}
        onToggleMaximize={() => AppService.ToggleMaximizeMain()}
        onHideToTray={() => void AppService.HideMainToTray()}
      />

      {activeTab === "kanban" && (
        <OverviewBar
          overview={overview}
          syncing={syncing}
          showFirstLaunchBanner={showFirstLaunchBanner}
          gitAvailable={desktopInfo?.gitAvailable ?? true}
          onDismissBanner={() => setBannerDismissed(true)}
          onGoConfig={() => setActiveTab("config")}
          onSyncNow={() => void handleSyncNow()}
          onOpenSimulateModal={() => setSimulateModalOpen(true)}
        />
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5">
        {activeTab === "kanban" && (
          <KanbanBoard
            tasks={tasks}
            loading={loadingTasks}
            selectedTaskId={selectedTaskId}
            overlayOpen={Boolean(selectedTaskId) || simulateModalOpen}
            onSelectTask={(id) => setSelectedTaskId(id)}
            onOpenExternal={(url) => void AppService.OpenExternalURL(url)}
          />
        )}

        {activeTab === "agents" && (
          <AgentPoolView
            agents={agents}
            loading={loadingAgents}
            probing={probingAgents}
            onProbeAgents={() => void handleProbeAgents()}
          />
        )}

        {activeTab === "config" && (
          <ConfigEditorView
            config={config}
            desktopInfo={desktopInfo}
            secrets={secrets}
            onSaved={(nextCfg) => {
              setConfig(nextCfg);
              void loadCoreData(false);
            }}
            onSecretsUpdated={(nextSecrets) => {
              setSecrets(nextSecrets);
              void loadCoreData(false);
            }}
            onDesktopInfoUpdated={(nextInfo) => setDesktopInfo(nextInfo)}
            onToast={pushToast}
          />
        )}
      </main>

      <TaskDetailDrawer
        open={Boolean(selectedTaskId)}
        detail={taskDetail}
        logs={taskLogs}
        loadingDetail={loadingDetail}
        loadingLogs={loadingLogs}
        agents={agents}
        actionBusy={actionBusy}
        onClose={() => setSelectedTaskId(null)}
        onOpenExternal={(url) => void AppService.OpenExternalURL(url)}
        onTrigger={(taskID, agentID) =>
          runTaskAction("触发执行", () => DashboardService.TriggerTask(taskID, agentID ?? ""), taskID)
        }
        onApprovePlan={(taskID) =>
          runTaskAction("批准方案", () => DashboardService.ApprovePlan(taskID), taskID)
        }
        onRejectPlan={(taskID, feedback) =>
          runTaskAction("打回方案", () => DashboardService.RejectPlan(taskID, feedback), taskID)
        }
        onRetry={(taskID, agentID) =>
          runTaskAction("重试任务", () => DashboardService.RetryTask(taskID, agentID ?? ""), taskID)
        }
        onMerge={(taskID) =>
          runTaskAction("合并 PR", () => DashboardService.MergeTask(taskID), taskID)
        }
        onCancel={(taskID) =>
          runTaskAction("取消任务", () => DashboardService.CancelTask(taskID), taskID)
        }
      />

      <SimulateIssueModal
        open={simulateModalOpen}
        submitting={simulating}
        onClose={() => !simulating && setSimulateModalOpen(false)}
        onSubmit={handleSimulateSubmit}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
