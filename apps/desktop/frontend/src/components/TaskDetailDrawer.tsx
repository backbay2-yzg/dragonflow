import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GitMerge,
  GitPullRequest,
  History,
  Play,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Tag,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import {
  ArtifactKind,
  TaskStatus,
  type AgentHealthInfo,
  type TaskDetailResponse,
  type TaskLogEntry,
} from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import {
  ARTIFACT_KIND_META,
  PIPELINE_STAGES,
  STATUS_META,
  TIER_META,
  canTransition,
  formatDuration,
  formatTimestamp,
  formatTokens,
  formatUsd,
  getPipelineStageIndex,
} from "../utils/format";
import { SelectPopover, type SelectOption } from "./SelectPopover";
import { StatusBadge } from "./StatusBadge";

type DrawerTab = "logs" | "artifacts" | "audit";
type LogStreamFilter = "all" | "stdout" | "stderr" | "system";

interface TaskDetailDrawerProps {
  open: boolean;
  detail: TaskDetailResponse | null;
  logs: TaskLogEntry[];
  loadingDetail: boolean;
  loadingLogs: boolean;
  agents: AgentHealthInfo[];
  actionBusy: boolean;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
  onTrigger: (taskId: string, agentId?: string) => Promise<void>;
  onApprovePlan: (taskId: string) => Promise<void>;
  onRejectPlan: (taskId: string, feedback: string) => Promise<void>;
  onRetry: (taskId: string, agentId?: string) => Promise<void>;
  onMerge: (taskId: string) => Promise<void>;
  onCancel: (taskId: string) => Promise<void>;
}

export function TaskDetailDrawer({
  open,
  detail,
  logs,
  loadingDetail,
  loadingLogs,
  agents,
  actionBusy,
  onClose,
  onOpenExternal,
  onTrigger,
  onApprovePlan,
  onRejectPlan,
  onRetry,
  onMerge,
  onCancel,
}: TaskDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>("logs");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [rejectExpanded, setRejectExpanded] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [streamFilter, setStreamFilter] = useState<LogStreamFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [copiedArtifact, setCopiedArtifact] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const task = detail?.task ?? null;
  const runs = detail?.runs ?? [];
  const artifacts = detail?.artifacts ?? [];
  const auditEvents = detail?.auditEvents ?? [];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    setSelectedAgentId("");
    setRejectExpanded(false);
    setRejectFeedback("");
    setSelectedArtifactId(null);
    setCopiedArtifact(false);
  }, [task?.id]);

  useEffect(() => {
    if (artifacts.length > 0 && !artifacts.some((a) => a.id === selectedArtifactId)) {
      setSelectedArtifactId(artifacts[artifacts.length - 1].id);
    }
  }, [artifacts, selectedArtifactId]);

  useEffect(() => {
    if (activeTab === "logs" && autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, activeTab, autoScroll]);

  const filteredLogs = useMemo(() => {
    if (streamFilter === "all") return logs;
    return logs.filter((entry) => entry.stream === streamFilter);
  }, [logs, streamFilter]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? artifacts[artifacts.length - 1] ?? null,
    [artifacts, selectedArtifactId],
  );

  const availableAgents = useMemo(() => agents.filter((a) => a.enabled && a.available), [agents]);

  const agentOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: "自动路由 Agent", tone: "neutral" },
      ...availableAgents.map((a) => ({
        value: a.id,
        label: a.displayName,
        meta: a.id,
        tone: "success" as const,
      })),
    ],
    [availableAgents],
  );

  if (!open) return null;

  const statusMeta = task
    ? STATUS_META[task.status] ?? {
        label: task.status,
        tone: "neutral" as const,
        indicator: "idle" as const,
        badgeClass: "df-badge-neutral",
        pulsing: false,
      }
    : null;
  const tierMeta = task ? TIER_META[task.tier] ?? TIER_META.quick_fix : null;
  const stageIndex = task ? getPipelineStageIndex(task.status) : -1;

  const canTrigger =
    task !== null &&
    ["NEW", "AWAITING_INFO", "AWAITING_TRIGGER"].includes(task.status) &&
    canTransition(task.status, TaskStatus.StatusRouting);
  const canApprove = task !== null && task.status === TaskStatus.StatusAwaitingPlanApproval;
  const canRetry =
    task !== null &&
    (task.status === TaskStatus.StatusNeedsHuman || task.status === TaskStatus.StatusFailed);
  const canMerge =
    task !== null &&
    Boolean(task.prNumber) &&
    (task.status === TaskStatus.StatusReadyToMerge || task.status === TaskStatus.StatusPrOpen);
  const canCancel =
    task !== null &&
    !["RELEASED", "CANCELLED", "FAILED"].includes(task.status) &&
    canTransition(task.status, TaskStatus.StatusCancelled);

  const retryIsPrimary = canRetry && !canTrigger && !canApprove && !canMerge;

  const handleCopyArtifact = async () => {
    if (!selectedArtifact) return;
    try {
      await navigator.clipboard.writeText(selectedArtifact.content);
      setCopiedArtifact(true);
      window.setTimeout(() => setCopiedArtifact(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[var(--df-scrim)]" onClick={onClose}>
      <aside
        className="df-float relative z-10 flex h-full w-[92vw] max-w-[780px] flex-col border-l border-hairline bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Drawer Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline bg-surface-1 px-5 py-3.5">
          {loadingDetail && !task ? (
            <div className="text-[13px] text-ink-subtle">正在加载任务详情...</div>
          ) : task && statusMeta && tierMeta ? (
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[13.5px] font-semibold tabular-nums text-primary-text">
                  #{task.issueNumber}
                </span>
                <StatusBadge status={task.status} size="sm" />
                <span
                  className={`rounded-[4px] border px-2 py-0.5 text-[11.5px] font-medium leading-none ${tierMeta.className}`}
                >
                  {tierMeta.label}
                </span>
                {task.category && (
                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-ink-muted">
                    <Tag className="h-3 w-3 text-ink-subtle" />
                    <span>{task.category}</span>
                  </span>
                )}
              </div>

              <h2 className="selectable [text-wrap:balance] text-[16px] leading-snug font-semibold text-ink">
                {task.issueTitle}
              </h2>

              <div className="flex flex-wrap items-center gap-3 text-[12.5px] tabular-nums text-ink-subtle">
                <span className="selectable font-mono">{task.repoFullName}</span>
                <span className="selectable">作者: {task.issueAuthor}</span>
                {task.branchName && (
                  <span className="selectable inline-flex items-center gap-1 font-mono [overflow-wrap:anywhere] text-ink-muted">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span>{task.branchName}</span>
                  </span>
                )}
                <span className="font-mono">
                  {formatTokens(task.totalTokens)} tok · {formatUsd(task.estimatedCostUsd)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-ink-subtle">未找到任务信息</div>
          )}

          <div className="flex shrink-0 items-center gap-1.5">
            {task?.prUrl && (
              <button
                type="button"
                onClick={() => onOpenExternal(task.prUrl!)}
                className="df-badge-success inline-flex h-[30px] items-center gap-1 rounded-[6px] border px-2.5 py-1 text-[12.5px] font-medium tabular-nums transition hover:opacity-85"
              >
                <GitPullRequest className="h-3.5 w-3.5" />
                <span>PR #{task.prNumber}</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="df-btn-ghost gap-1.5 px-2 py-1"
              aria-label="关闭抽屉"
            >
              <kbd className="df-kbd hidden sm:inline-flex">Esc</kbd>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {task && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* 6-Stage Stepper & Action Bar */}
            <div className="space-y-3 border-b border-hairline bg-canvas px-5 py-3">
              <div className="rounded-[8px] border border-hairline bg-surface-1 p-2">
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {PIPELINE_STAGES.map((st, idx) => {
                    const done = stageIndex > idx || task.status === TaskStatus.StatusReleased;
                    const active = stageIndex === idx && task.status !== TaskStatus.StatusReleased;
                    const isException =
                      task.status === TaskStatus.StatusNeedsHuman ||
                      task.status === TaskStatus.StatusFailed;
                    return (
                      <div
                        key={st.key}
                        className={`flex items-center justify-between gap-1 rounded-[6px] border px-2 py-1 text-[12px] font-medium tabular-nums ${
                          done
                            ? "df-badge-success"
                            : active && isException
                              ? "df-badge-danger"
                              : active
                                ? "border-primary bg-primary-soft text-primary-text"
                                : "border-hairline bg-surface-2 text-ink-subtle"
                        }`}
                      >
                        <span className="truncate">
                          {idx + 1}. {st.label}
                        </span>
                        {done ? (
                          <Check className="h-3 w-3 shrink-0" />
                        ) : active && statusMeta?.pulsing ? (
                          <span className="df-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Agent Info & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-surface-1 px-2 py-0.5 text-ink">
                    <Bot className="h-3.5 w-3.5 text-primary-text" />
                    <span>主 Agent:</span>
                    <code className="selectable font-mono text-primary-text">
                      {task.assignedAgent || "待路由"}
                    </code>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-surface-1 px-2 py-0.5 text-ink-muted">
                    <span>Review:</span>
                    <code className="selectable font-mono">{task.reviewerAgent || "待路由"}</code>
                  </span>
                  {(task.fallbackHistory ?? []).length > 0 && (
                    <span className="df-badge-waiting inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium tabular-nums">
                      <RefreshCw className="h-3 w-3" />
                      <span>已降级 {task.fallbackCount} 次</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(canTrigger || canRetry) && (
                    <SelectPopover
                      value={selectedAgentId}
                      options={agentOptions}
                      onChange={setSelectedAgentId}
                      disabled={actionBusy}
                      ariaLabel="选择目标 Agent"
                      className="min-w-[190px]"
                    />
                  )}

                  {canTrigger && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onTrigger(task.id, selectedAgentId || undefined)}
                      className="df-btn-primary ps-3 pe-3.5"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>触发执行</span>
                    </button>
                  )}

                  {canApprove && (
                    <>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void onApprovePlan(task.id)}
                        className="df-btn-primary ps-3 pe-3.5"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>批准计划</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => setRejectExpanded((v) => !v)}
                        className="df-btn-secondary ps-3 pe-3.5"
                      >
                        <XCircle className="h-3.5 w-3.5 text-[var(--df-waiting)]" />
                        <span>驳回修改</span>
                      </button>
                    </>
                  )}

                  {canMerge && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onMerge(task.id)}
                      className="df-btn-primary ps-3 pe-3.5"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      <span>合并 PR</span>
                    </button>
                  )}

                  {canRetry && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onRetry(task.id, selectedAgentId || undefined)}
                      className={`${retryIsPrimary ? "df-btn-primary" : "df-btn-secondary"} ps-3 pe-3.5`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${actionBusy ? "animate-spin" : ""}`} />
                      <span>重试任务</span>
                    </button>
                  )}

                  {canCancel && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onCancel(task.id)}
                      className="df-btn-danger ps-3 pe-3.5"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>取消</span>
                    </button>
                  )}
                </div>
              </div>

              {rejectExpanded && canApprove && (
                <div className="flex gap-2 rounded-[8px] border border-[var(--df-waiting-border)] bg-[var(--df-waiting-soft)] p-2">
                  <input
                    type="text"
                    value={rejectFeedback}
                    onChange={(e) => setRejectFeedback(e.target.value)}
                    placeholder="输入修改建议以重新生成技术方案..."
                    className="df-input h-[34px] flex-1 px-3 py-1.5 text-[13.5px]"
                  />
                  <button
                    type="button"
                    disabled={actionBusy || !rejectFeedback.trim()}
                    onClick={() => {
                      void onRejectPlan(task.id, rejectFeedback.trim()).then(() => {
                        setRejectExpanded(false);
                        setRejectFeedback("");
                      });
                    }}
                    className="df-btn-secondary"
                  >
                    提交驳回
                  </button>
                </div>
              )}

              {task.lastError && (
                <div className="df-badge-danger selectable flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[13px]">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 font-mono text-[12.5px] [overflow-wrap:anywhere]">
                    {task.lastError}
                  </span>
                </div>
              )}

              {(task.fallbackHistory ?? []).length > 0 && (
                <div className="df-badge-waiting selectable rounded-[6px] border px-3 py-2 text-[12px]">
                  <div className="font-semibold">Agent 降级记录：</div>
                  {(task.fallbackHistory ?? []).map((fb, idx) => (
                    <div key={idx} className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono">
                      <span>{fb.fromAgent}</span>
                      <ArrowRight className="h-3 w-3 opacity-70" />
                      <span>{fb.toAgent}</span>
                      <span className="opacity-80">
                        ({fb.stage} · {fb.errorKind})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sub-Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-1 px-5 py-1.5">
              <div className="flex items-center gap-1">
                <DrawerTabBtn
                  active={activeTab === "logs"}
                  onClick={() => setActiveTab("logs")}
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label={`执行日志 (${logs.length})`}
                />
                <DrawerTabBtn
                  active={activeTab === "artifacts"}
                  onClick={() => setActiveTab("artifacts")}
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label={`产物报告 (${artifacts.length})`}
                />
                <DrawerTabBtn
                  active={activeTab === "audit"}
                  onClick={() => setActiveTab("audit")}
                  icon={<History className="h-3.5 w-3.5" />}
                  label={`状态轨迹 (${auditEvents.length}) & Runs (${runs.length})`}
                />
              </div>

              {activeTab === "logs" && (
                <div className="flex items-center gap-2 text-[12px]">
                  <div className="flex items-center rounded-[8px] border border-hairline bg-canvas p-[2px] text-[12px]">
                    {(["all", "stdout", "stderr", "system"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStreamFilter(s)}
                        className={`rounded-[6px] border px-2.5 py-0.5 font-mono transition duration-150 ${
                          streamFilter === s
                            ? "border-hairline-strong bg-surface-2 text-ink"
                            : "border-transparent text-ink-muted hover:text-ink"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-muted">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--df-primary)]"
                    />
                    <span>自动滚动</span>
                  </label>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {activeTab === "logs" && (
                <div className="selectable min-h-[300px] rounded-[8px] border border-hairline bg-terminal p-3 font-mono text-[13px] leading-[1.6]">
                  {loadingLogs && logs.length === 0 ? (
                    <div className="text-[#8e94a0]">正在加载日志...</div>
                  ) : filteredLogs.length === 0 ? (
                    <div className="text-[#8e94a0]">暂无日志输出</div>
                  ) : (
                    filteredLogs.map((entry) => {
                      const cls =
                        entry.stream === "stderr"
                          ? "text-[#f87171]"
                          : entry.stream === "system"
                            ? "text-[#93c5fd]"
                            : "text-[#e2e6ee]";
                      const badge =
                        entry.stream === "stderr"
                          ? "border-[#632931] bg-[#34191d] text-[#f87171]"
                          : entry.stream === "system"
                            ? "border-[#353c72] bg-[#1e2240] text-[#93c5fd]"
                            : "border-[#23252b] bg-[#111215] text-[#8e94a0]";
                      return (
                        <div
                          key={entry.id}
                          className="flex items-start gap-2 rounded-[4px] px-1.5 py-0.5 hover:bg-white/[0.04]"
                        >
                          <span className="shrink-0 text-[12px] tabular-nums text-[#7d8594]">
                            {formatTimestamp(entry.timestamp).slice(6)}
                          </span>
                          <span
                            className={`mt-0.5 shrink-0 rounded-[4px] border px-1.5 text-[11px] uppercase ${badge}`}
                          >
                            {entry.stream}
                          </span>
                          <span
                            className={`min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${cls}`}
                          >
                            {entry.message}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={logEndRef} />
                </div>
              )}

              {activeTab === "artifacts" && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    {artifacts.length === 0 ? (
                      <div className="rounded-[8px] border border-dashed border-hairline p-4 text-center text-[13px] text-ink-subtle">
                        暂无产物
                      </div>
                    ) : (
                      artifacts.map((art) => {
                        const meta = ARTIFACT_KIND_META[art.kind] ?? {
                          label: art.kind,
                          className: "df-badge-neutral",
                        };
                        const active = selectedArtifact?.id === art.id;
                        return (
                          <button
                            key={art.id}
                            type="button"
                            onClick={() => setSelectedArtifactId(art.id)}
                            className={`w-full rounded-[8px] border p-2.5 text-left transition duration-150 ${
                              active
                                ? "border-primary bg-primary-soft"
                                : "border-hairline bg-surface-2 hover:border-hairline-strong hover:bg-surface-3"
                            }`}
                          >
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                            <div className="mt-1 text-[13px] font-medium text-ink">{art.title}</div>
                            <div className="mt-0.5 font-mono text-[11.5px] tabular-nums text-ink-subtle">
                              {formatTimestamp(art.createdAt)}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Theme-following Artifact Reader */}
                  <div className="md:col-span-2">
                    {selectedArtifact ? (
                      <div className="overflow-hidden rounded-[8px] border border-hairline bg-surface-2">
                        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-surface-1 px-3 py-2">
                          <span className="truncate text-[13px] font-semibold text-ink">
                            {selectedArtifact.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyArtifact()}
                            className="df-btn-secondary min-h-[28px] px-2.5 py-0.5 text-[12px]"
                          >
                            {copiedArtifact ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-[var(--df-success)]" />
                                <span className="text-[var(--df-success)]">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5 text-ink-subtle" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="p-3">
                          {selectedArtifact.kind === ArtifactKind.ArtifactDiff ? (
                            <pre className="selectable overflow-x-auto rounded-[6px] border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-[1.6]">
                              {selectedArtifact.content.split("\n").map((line, i) => {
                                let cls = "text-ink-muted";
                                if (line.startsWith("+") && !line.startsWith("+++")) {
                                  cls = "bg-[var(--df-success-soft)] text-[var(--df-success)]";
                                } else if (line.startsWith("-") && !line.startsWith("---")) {
                                  cls = "bg-[var(--df-danger-soft)] text-[var(--df-danger)]";
                                } else if (line.startsWith("@@")) {
                                  cls = "text-primary-text";
                                } else if (line.startsWith("diff ") || line.startsWith("index ")) {
                                  cls = "text-[var(--df-waiting)] font-semibold";
                                }
                                return (
                                  <div key={i} className={`px-1 ${cls}`}>
                                    {line || " "}
                                  </div>
                                );
                              })}
                            </pre>
                          ) : (
                            <pre className="selectable overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[6px] border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-[1.6] text-ink">
                              {selectedArtifact.content}
                            </pre>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-[8px] border border-dashed border-hairline bg-surface-2 text-[13px] text-ink-subtle">
                        选择左侧产物查看内容
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "audit" && (
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      <ScrollText className="h-4 w-4 text-primary-text" />
                      <span>Agent 运行记录 (Runs)</span>
                    </h4>
                    <div className="space-y-1.5">
                      {runs.map((run) => (
                        <div
                          key={run.id}
                          className="selectable flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px]"
                        >
                          <div className="flex items-center gap-2">
                            {run.status === "succeeded" ? (
                              <CheckCircle2 className="h-4 w-4 text-[var(--df-success)]" />
                            ) : run.status === "failed" ? (
                              <AlertTriangle className="h-4 w-4 text-[var(--df-danger)]" />
                            ) : (
                              <Clock className="h-4 w-4 animate-spin text-primary-text" />
                            )}
                            <span className="font-mono font-semibold text-ink">{run.stage}</span>
                            <span className="font-mono text-ink-muted">
                              agent={run.agentId} #{run.attempt}
                            </span>
                            {run.errorKind !== "none" && (
                              <span className="df-badge-danger rounded-full border px-2 py-0.5 font-mono text-[11.5px]">
                                {run.errorKind}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 font-mono text-[12px] tabular-nums text-ink-subtle">
                            <span>{formatDuration(run.durationMs)}</span>
                            <span>{formatTokens(run.tokensUsed)} tok</span>
                            <span>{formatUsd(run.costUsd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      <History className="h-4 w-4 text-primary-text" />
                      <span>状态机审计轨迹</span>
                    </h4>
                    <div className="space-y-1.5">
                      {auditEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="selectable flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px]"
                        >
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[12.5px]">
                            <span className="text-ink-subtle">{ev.fromStatus || "START"}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-primary-text" />
                            <span className="font-semibold text-primary-text">{ev.toStatus}</span>
                            <span className="text-[12px] [overflow-wrap:anywhere] text-ink-muted">
                              ({ev.actor}) — {ev.reason}
                            </span>
                          </div>
                          <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
                            {formatTimestamp(ev.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function DrawerTabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[13px] font-medium tabular-nums transition duration-150 ${
        active
          ? "border-primary-border bg-primary-soft text-primary-text"
          : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
