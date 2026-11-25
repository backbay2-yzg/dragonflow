import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
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
} from 'lucide-react';
import {
  canTransition,
  type AgentHealthInfo,
  type AuditEventRecord,
  type TaskArtifact,
  type TaskDetailResponse,
  type TaskLogEntry,
  type TaskRecord,
  type TaskRunRecord,
} from '@dragonflow/shared';
import {
  ARTIFACT_KIND_META,
  PIPELINE_STAGES,
  STATUS_META,
  TIER_META,
  formatDuration,
  formatTimestamp,
  formatTokens,
  formatUsd,
  getPipelineStageIndex,
} from '../utils/format';
import { SelectPopover, type SelectOption } from './SelectPopover';
import { StatusBadge } from './StatusBadge';

type DrawerTab = 'logs' | 'artifacts' | 'audit';
type LogStreamFilter = 'all' | 'stdout' | 'stderr' | 'system';

interface TaskDetailDrawerProps {
  open: boolean;
  detail: TaskDetailResponse | null;
  logs: TaskLogEntry[];
  loadingDetail: boolean;
  loadingLogs: boolean;
  agents: AgentHealthInfo[];
  actionBusy: boolean;
  onClose: () => void;
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
  onTrigger,
  onApprovePlan,
  onRejectPlan,
  onRetry,
  onMerge,
  onCancel,
}: TaskDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('logs');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [rejectExpanded, setRejectExpanded] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [streamFilter, setStreamFilter] = useState<LogStreamFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const task = detail?.task ?? null;
  const runs = detail?.runs ?? [];
  const artifacts = detail?.artifacts ?? [];
  const auditEvents = detail?.auditEvents ?? [];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    setSelectedAgentId('');
    setRejectExpanded(false);
    setRejectFeedback('');
    setSelectedArtifactId(null);
  }, [task?.id]);

  useEffect(() => {
    if (artifacts.length > 0 && (!selectedArtifactId || !artifacts.some((a) => a.id === selectedArtifactId))) {
      setSelectedArtifactId(artifacts[artifacts.length - 1].id);
    }
  }, [artifacts, selectedArtifactId]);

  const filteredLogs = useMemo(() => {
    if (streamFilter === 'all') return logs;
    return logs.filter((entry) => entry.stream === streamFilter);
  }, [logs, streamFilter]);

  useEffect(() => {
    if (activeTab === 'logs' && autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [filteredLogs.length, activeTab, autoScroll]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[var(--df-scrim)]"
      onClick={onClose}
    >
      <aside
        className="df-float flex h-full w-[92vw] max-w-[780px] flex-col border-l border-hairline bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline bg-surface-1 px-5 py-3.5">
          {task ? (
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[13.5px] font-semibold tabular-nums text-primary-text">
                  #{task.issueNumber}
                </span>
                <StatusBadge status={task.status} size="sm" />
                <span
                  className={`rounded-[4px] border px-2 py-0.5 text-[11.5px] font-medium leading-none ${
                    TIER_META[task.tier].className
                  }`}
                >
                  {TIER_META[task.tier].label}
                </span>
                {task.category && (
                  <span className="rounded-[4px] border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-ink-muted">
                    {task.category}
                  </span>
                )}
                <span className="font-mono text-[12px] text-ink-subtle">{task.repoFullName}</span>
              </div>

              <h2 className="selectable [text-wrap:balance] text-[16px] leading-snug font-semibold text-ink">
                {task.issueTitle}
              </h2>

              <div className="flex flex-wrap items-center gap-3 text-[12.5px] tabular-nums text-ink-subtle">
                {task.issueUrl && (
                  <a
                    href={task.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary-text hover:underline"
                  >
                    <span>Issue 链接</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {task.prUrl && (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--df-success)] hover:underline"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    <span>PR #{task.prNumber ?? ''}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {task.releaseTag && (
                  <span className="inline-flex items-center gap-1 text-[var(--df-success)]">
                    <Tag className="h-3.5 w-3.5" />
                    {task.releaseUrl ? (
                      <a
                        href={task.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {task.releaseTag}
                      </a>
                    ) : (
                      task.releaseTag
                    )}
                  </span>
                )}
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
            <div className="text-[13px] text-ink-subtle">
              {loadingDetail ? '正在加载任务详情...' : '未选择任务'}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="df-btn-ghost shrink-0 gap-1.5 px-2 py-1"
            aria-label="关闭任务抽屉"
          >
            <kbd className="df-kbd hidden sm:inline-flex">Esc</kbd>
            <X className="h-4 w-4" />
          </button>
        </div>

        {task ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Top summary & actions */}
            <div className="space-y-3 border-b border-hairline bg-canvas px-5 py-3">
              {/* 6-Stage Progress Bar */}
              <PipelineProgressBar task={task} auditEvents={auditEvents} />

              {task.lastError && (
                <div className="df-badge-danger selectable flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[13px]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold">最近异常：</span>
                    <span className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
                      {task.lastError}
                    </span>
                  </div>
                </div>
              )}

              {/* Routing Explainability Card */}
              <RoutingExplainabilityCard task={task} />

              {/* Action Toolbar */}
              <ActionToolbar
                task={task}
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgentId={setSelectedAgentId}
                rejectExpanded={rejectExpanded}
                onToggleReject={() => setRejectExpanded((prev) => !prev)}
                rejectFeedback={rejectFeedback}
                onChangeRejectFeedback={setRejectFeedback}
                actionBusy={actionBusy}
                onTrigger={onTrigger}
                onApprovePlan={onApprovePlan}
                onRejectPlan={async (taskId, feedback) => {
                  await onRejectPlan(taskId, feedback);
                  setRejectExpanded(false);
                  setRejectFeedback('');
                }}
                onRetry={onRetry}
                onMerge={onMerge}
                onCancel={onCancel}
              />
            </div>

            {/* Tabs Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-1 px-5 py-1.5">
              <div className="flex items-center gap-1">
                <TabButton
                  active={activeTab === 'logs'}
                  onClick={() => setActiveTab('logs')}
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label="实时日志"
                  count={logs.length}
                />
                <TabButton
                  active={activeTab === 'artifacts'}
                  onClick={() => setActiveTab('artifacts')}
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="阶段产物"
                  count={artifacts.length}
                />
                <TabButton
                  active={activeTab === 'audit'}
                  onClick={() => setActiveTab('audit')}
                  icon={<History className="h-3.5 w-3.5" />}
                  label="执行与审计"
                  count={runs.length + auditEvents.length}
                />
              </div>

              {activeTab === 'logs' && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-[8px] border border-hairline bg-canvas p-[2px] text-[12px]">
                    {(['all', 'stdout', 'stderr', 'system'] as const).map((stream) => (
                      <button
                        key={stream}
                        type="button"
                        onClick={() => setStreamFilter(stream)}
                        className={`rounded-[6px] border px-2.5 py-0.5 font-mono transition duration-150 ${
                          streamFilter === stream
                            ? 'border-hairline-strong bg-surface-2 text-ink'
                            : 'border-transparent text-ink-muted hover:text-ink'
                        }`}
                      >
                        {stream}
                      </button>
                    ))}
                  </div>
                  <label className="hidden cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-muted sm:inline-flex">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--df-primary)]"
                    />
                    <span>自动滚屏</span>
                  </label>
                </div>
              )}
            </div>

            {/* Tab Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {activeTab === 'logs' && (
                <LogsConsoleTab
                  logs={filteredLogs}
                  loading={loadingLogs}
                  logEndRef={logEndRef}
                />
              )}

              {activeTab === 'artifacts' && (
                <ArtifactsViewerTab
                  artifacts={artifacts}
                  selectedArtifactId={selectedArtifactId}
                  onSelectArtifact={setSelectedArtifactId}
                />
              )}

              {activeTab === 'audit' && (
                <RunsAndAuditTab runs={runs} auditEvents={auditEvents} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-ink-subtle">
            {loadingDetail ? '加载任务数据中...' : '未找到该任务'}
          </div>
        )}
      </aside>
    </div>
  );
}

function PipelineProgressBar({
  task,
  auditEvents,
}: {
  task: TaskRecord;
  auditEvents: AuditEventRecord[];
}) {
  const directStageIndex = getPipelineStageIndex(task.status);
  const isException = directStageIndex === -1;

  const reachedIndex = useMemo(() => {
    if (!isException) return directStageIndex;
    for (let i = auditEvents.length - 1; i >= 0; i -= 1) {
      const ev = auditEvents[i];
      if (ev.fromStatus) {
        const idx = getPipelineStageIndex(ev.fromStatus);
        if (idx >= 0) return idx;
      }
      const toIdx = getPipelineStageIndex(ev.toStatus);
      if (toIdx >= 0) return toIdx;
    }
    return 0;
  }, [auditEvents, directStageIndex, isException]);

  const isReleased = task.status === 'RELEASED';
  const isRunning = STATUS_META[task.status].pulsing;

  return (
    <div className="rounded-[8px] border border-hairline bg-surface-1 p-2">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {PIPELINE_STAGES.map((stage, idx) => {
          const completed = isReleased ? true : idx < reachedIndex;
          const current = !isReleased && idx === reachedIndex;

          let barColor = 'border-hairline bg-surface-2 text-ink-subtle';
          if (completed) {
            barColor = 'df-badge-success';
          } else if (current && isException) {
            barColor = 'df-badge-danger';
          } else if (current) {
            barColor = 'border-primary bg-primary-soft text-primary-text';
          }

          return (
            <div
              key={stage.key}
              className={`flex items-center justify-between gap-1.5 rounded-[6px] border px-2 py-1 text-[12px] font-medium tabular-nums ${barColor}`}
            >
              <span className="truncate">
                {idx + 1}. {stage.label}
              </span>
              {completed ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : current && isRunning ? (
                <span className="df-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              ) : current && isException ? (
                <ShieldAlert className="h-3 w-3 shrink-0" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoutingExplainabilityCard({ task }: { task: TaskRecord }) {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-1 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <Bot className="h-4 w-4 text-primary-text" />
          <span>智能路由与可解释性</span>
        </span>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px] tabular-nums">
          <span className="rounded-[4px] border border-primary-border bg-primary-soft px-2 py-0.5 text-primary-text">
            主 Agent: {task.assignedAgent || '待路由'}
          </span>
          <span className="rounded-[4px] border border-hairline bg-surface-2 px-2 py-0.5 text-ink-muted">
            Reviewer: {task.reviewerAgent || '未指定'}
          </span>
          <span className="rounded-[4px] border border-hairline bg-surface-2 px-2 py-0.5 text-ink-muted">
            复杂度: {task.complexityScore !== undefined ? `${task.complexityScore}/5` : '待评分'}
          </span>
        </div>
      </div>

      <p className="selectable mt-2 text-[12.5px] leading-relaxed text-ink-muted">
        <span className="text-ink-subtle">决策依据：</span>
        {task.routingRationale || '尚无路由决策说明'}
      </p>

      {task.fallbackHistory.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-hairline-subtle pt-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-[var(--df-waiting)]">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>自动降级切换记录 ({task.fallbackHistory.length})</span>
          </div>
          <div className="space-y-1">
            {task.fallbackHistory.map((item, index) => (
              <div
                key={`${item.timestamp}-${index}`}
                className="df-badge-waiting selectable flex flex-wrap items-center justify-between gap-2 rounded-[6px] border px-2.5 py-1.5 text-[12px]"
              >
                <div className="flex flex-wrap items-center gap-1.5 font-mono">
                  <span className="font-semibold">{item.fromAgent}</span>
                  <ArrowRight className="h-3 w-3 opacity-70" />
                  <span className="font-semibold">{item.toAgent}</span>
                  <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-ink-muted">
                    {item.stage}
                  </span>
                  <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-ink">
                    {item.errorKind}
                  </span>
                </div>
                <span className="text-[11.5px] tabular-nums opacity-90">
                  {item.reason} · {formatTimestamp(item.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ActionToolbarProps {
  task: TaskRecord;
  agents: AgentHealthInfo[];
  selectedAgentId: string;
  onSelectAgentId: (id: string) => void;
  rejectExpanded: boolean;
  onToggleReject: () => void;
  rejectFeedback: string;
  onChangeRejectFeedback: (value: string) => void;
  actionBusy: boolean;
  onTrigger: (taskId: string, agentId?: string) => Promise<void>;
  onApprovePlan: (taskId: string) => Promise<void>;
  onRejectPlan: (taskId: string, feedback: string) => Promise<void>;
  onRetry: (taskId: string, agentId?: string) => Promise<void>;
  onMerge: (taskId: string) => Promise<void>;
  onCancel: (taskId: string) => Promise<void>;
}

function ActionToolbar({
  task,
  agents,
  selectedAgentId,
  onSelectAgentId,
  rejectExpanded,
  onToggleReject,
  rejectFeedback,
  onChangeRejectFeedback,
  actionBusy,
  onTrigger,
  onApprovePlan,
  onRejectPlan,
  onRetry,
  onMerge,
  onCancel,
}: ActionToolbarProps) {
  const canTrigger = ['NEW', 'AWAITING_INFO', 'AWAITING_TRIGGER'].includes(task.status);
  const isPlanGate = task.status === 'AWAITING_PLAN_APPROVAL';
  const canRetry = [
    'FAILED',
    'NEEDS_HUMAN',
    'CANCELLED',
    'AWAITING_INFO',
    'PR_OPEN',
    'CI_FIXING',
    'REVIEW_FIXING',
    'READY_TO_MERGE',
  ].includes(task.status);
  const canMerge =
    task.status === 'READY_TO_MERGE' ||
    (task.status === 'PR_OPEN' && Boolean(task.prNumber || task.prUrl));
  const canCancel = canTransition(task.status, 'CANCELLED');

  const agentOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'Agent: 自动路由 / 默认', tone: 'neutral' },
      ...agents.map((agent) => ({
        value: agent.id,
        label: agent.displayName,
        meta: agent.id,
        tone: (agent.available ? 'success' : 'danger') as 'success' | 'danger',
      })),
    ],
    [agents],
  );

  const retryIsPrimary = canRetry && !canTrigger && !isPlanGate && !canMerge;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SelectPopover
            value={selectedAgentId}
            options={agentOptions}
            onChange={onSelectAgentId}
            disabled={actionBusy}
            ariaLabel="选择目标 Agent"
            className="min-w-[205px]"
          />

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

          {isPlanGate && (
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
                onClick={onToggleReject}
                className="df-btn-secondary ps-3 pe-3.5"
              >
                <XCircle className="h-3.5 w-3.5 text-[var(--df-waiting)]" />
                <span>驳回计划</span>
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
              className={`${retryIsPrimary ? 'df-btn-primary' : 'df-btn-secondary'} ps-3 pe-3.5`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${actionBusy ? 'animate-spin' : ''}`} />
              <span>{selectedAgentId ? `切换 ${selectedAgentId} 重试` : '重试 / 切换 Agent'}</span>
            </button>
          )}
        </div>

        {canCancel && (
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void onCancel(task.id)}
            className="df-btn-danger ps-3 pe-3.5"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span>取消任务</span>
          </button>
        )}
      </div>

      {isPlanGate && rejectExpanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = rejectFeedback.trim();
            if (!trimmed) return;
            void onRejectPlan(task.id, trimmed);
          }}
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--df-waiting-border)] bg-[var(--df-waiting-soft)] p-2"
        >
          <input
            type="text"
            value={rejectFeedback}
            onChange={(e) => onChangeRejectFeedback(e.target.value)}
            placeholder="输入驳回意见（如：请补充边界测试并拆分中间件模块）..."
            className="df-input h-[34px] min-w-[220px] flex-1 px-3 py-1.5 text-[13.5px]"
          />
          <button
            type="submit"
            disabled={actionBusy || !rejectFeedback.trim()}
            className="df-btn-secondary"
          >
            确认驳回并重规划
          </button>
        </form>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[13px] font-medium transition duration-150 ${
        active
          ? 'border-primary-border bg-primary-soft text-primary-text'
          : 'border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.2 font-mono text-[11.5px] tabular-nums ${
          active ? 'bg-surface-1 text-primary-text' : 'bg-surface-2 text-ink-subtle'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function LogsConsoleTab({
  logs,
  loading,
  logEndRef,
}: {
  logs: TaskLogEntry[];
  loading: boolean;
  logEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (loading && logs.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-[8px] border border-hairline bg-terminal font-mono text-[13px] text-[#8e94a0]">
        正在拉取执行日志...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-hairline bg-terminal font-mono text-[13px] text-[#8e94a0]">
        <ScrollText className="h-5 w-5 text-[#7d8594]" />
        <span>暂无日志输出，任务执行时将通过 SSE 实时流式推送</span>
      </div>
    );
  }

  return (
    <div className="selectable rounded-[8px] border border-hairline bg-terminal p-3 font-mono text-[13px] leading-[1.6]">
      <div className="space-y-0.5">
        {logs.map((entry) => {
          const lineColor =
            entry.stream === 'stderr'
              ? 'text-[#f87171]'
              : entry.stream === 'system'
                ? 'text-[#93c5fd]'
                : 'text-[#e2e6ee]';
          const streamBadge =
            entry.stream === 'stderr'
              ? 'border-[#632931] bg-[#34191d] text-[#f87171]'
              : entry.stream === 'system'
                ? 'border-[#353c72] bg-[#1e2240] text-[#93c5fd]'
                : 'border-[#23252b] bg-[#111215] text-[#8e94a0]';

          return (
            <div
              key={`${entry.id}-${entry.timestamp}`}
              className="flex items-start gap-2 rounded-[4px] px-1.5 py-0.5 hover:bg-white/[0.04]"
            >
              <span className="shrink-0 text-[12px] tabular-nums text-[#7d8594]">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span
                className={`mt-0.5 shrink-0 rounded-[4px] border px-1.5 text-[11px] uppercase ${streamBadge}`}
              >
                {entry.stream}
              </span>
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${lineColor}`}
              >
                {entry.message}
              </span>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function ArtifactsViewerTab({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}: {
  artifacts: TaskArtifact[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (artifacts.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-hairline bg-surface-2 text-[13px] text-ink-subtle">
        <FileText className="h-5 w-5 text-ink-subtle" />
        <span>尚未生成阶段产物（Triage / Spec / Plan / 测试报告 / Review / Diff）</span>
      </div>
    );
  }

  const activeArtifact =
    artifacts.find((a) => a.id === selectedArtifactId) ?? artifacts[artifacts.length - 1];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeArtifact.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {artifacts.map((artifact) => {
          const kindMeta = ARTIFACT_KIND_META[artifact.kind];
          const isSelected = artifact.id === activeArtifact.id;
          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onSelectArtifact(artifact.id)}
              className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-left text-[13px] transition duration-150 ${
                isSelected
                  ? 'border-primary bg-primary-soft text-ink'
                  : 'border-hairline bg-surface-2 text-ink-muted hover:border-hairline-strong hover:text-ink'
              }`}
            >
              <span
                className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${kindMeta.className}`}
              >
                {kindMeta.label}
              </span>
              <span className="max-w-[200px] truncate font-medium">{artifact.title}</span>
            </button>
          );
        })}
      </div>

      {/* Theme-following Spec / Plan / Review / Diff Reader */}
      <div className="overflow-hidden rounded-[8px] border border-hairline bg-surface-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-1 px-3.5 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${
                ARTIFACT_KIND_META[activeArtifact.kind].className
              }`}
            >
              {ARTIFACT_KIND_META[activeArtifact.kind].label}
            </span>
            <span className="text-[13px] font-semibold text-ink">{activeArtifact.title}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
              {formatTimestamp(activeArtifact.createdAt)}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="df-btn-secondary min-h-[28px] px-2.5 py-0.5 text-[12px]"
            >
              {copied ? (
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
        </div>

        <div className="p-3">
          <ArtifactBody artifact={activeArtifact} />
        </div>
      </div>
    </div>
  );
}

function ArtifactBody({ artifact }: { artifact: TaskArtifact }) {
  if (artifact.kind === 'diff') {
    const lines = artifact.content.split('\n');
    return (
      <pre className="selectable overflow-x-auto rounded-[6px] border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-[1.6]">
        {lines.map((line, i) => {
          let cls = 'text-ink-muted';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            cls = 'bg-[var(--df-success-soft)] text-[var(--df-success)]';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            cls = 'bg-[var(--df-danger-soft)] text-[var(--df-danger)]';
          } else if (line.startsWith('@@')) {
            cls = 'text-primary-text';
          } else if (line.startsWith('diff ') || line.startsWith('index ')) {
            cls = 'text-[var(--df-waiting)] font-semibold';
          }
          return (
            <div key={i} className={`px-1 ${cls}`}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    );
  }

  const parsed = tryParseJsonObject(artifact.content);
  if (parsed) {
    return (
      <pre className="selectable overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[6px] border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-[1.6] text-ink">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  }

  return (
    <pre className="selectable overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[6px] border border-hairline bg-surface-1 p-3 font-mono text-[13px] leading-[1.6] text-ink">
      {artifact.content}
    </pre>
  );
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function RunsAndAuditTab({
  runs,
  auditEvents,
}: {
  runs: TaskRunRecord[];
  auditEvents: AuditEventRecord[];
}) {
  return (
    <div className="space-y-5">
      {/* Runs Table */}
      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-[13.5px] font-semibold tabular-nums text-ink">
          <Terminal className="h-4 w-4 text-primary-text" />
          <span>Agent 执行记录 (Runs · {runs.length})</span>
        </h4>

        {runs.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline p-4 text-center text-[13px] text-ink-subtle">
            暂无执行记录
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-hairline bg-surface-2">
            <table className="w-full border-collapse text-left text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-hairline bg-surface-1 text-[12px] text-ink-subtle">
                  <th className="px-3 py-2 font-medium">阶段</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">错误类型</th>
                  <th className="px-3 py-2 font-medium">耗时</th>
                  <th className="px-3 py-2 font-medium">Tokens / Cost</th>
                  <th className="px-3 py-2 font-medium">开始时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {runs.map((run) => {
                  const statusClass =
                    run.status === 'succeeded'
                      ? 'df-badge-success'
                      : run.status === 'failed'
                        ? 'df-badge-danger'
                        : 'df-badge-running';

                  return (
                    <tr key={run.id} className="hover:bg-surface-3">
                      <td className="selectable px-3 py-2 font-mono text-[12.5px] text-ink">
                        {run.stage} #{run.attempt}
                      </td>
                      <td className="selectable px-3 py-2 font-mono text-[12.5px] text-primary-text">
                        {run.agentId}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${statusClass}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="selectable px-3 py-2 font-mono text-[12.5px] text-ink-muted">
                        {run.errorKind !== 'none' ? (
                          <span className="text-[var(--df-waiting)]">{run.errorKind}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12.5px] text-ink-muted">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12.5px] text-ink-muted">
                        {formatTokens(run.tokensUsed)} / {formatUsd(run.costUsd)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-ink-subtle">
                        {formatTimestamp(run.startedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Audit Timeline */}
      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-[13.5px] font-semibold tabular-nums text-ink">
          <Clock className="h-4 w-4 text-primary-text" />
          <span>状态流转审计时间线 (Audit Events · {auditEvents.length})</span>
        </h4>

        {auditEvents.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline p-4 text-center text-[13px] text-ink-subtle">
            暂无状态流转审计事件
          </div>
        ) : (
          <div className="space-y-2 border-l border-hairline pl-4">
            {auditEvents.map((event) => (
              <div
                key={event.id}
                className="selectable relative rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 text-[13px]"
              >
                <span className="absolute top-3.5 -left-[21px] h-2 w-2 rounded-full border border-primary bg-surface-1" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12.5px]">
                    <span className="text-ink-subtle">{event.fromStatus ?? 'INIT'}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" />
                    <span className="font-semibold text-primary-text">{event.toStatus}</span>
                    <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-ink-muted">
                      actor: {event.actor}
                    </span>
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
                    {formatTimestamp(event.createdAt)}
                  </span>
                </div>
                {event.reason && (
                  <p className="mt-1 text-[12.5px] [overflow-wrap:anywhere] text-ink-muted">
                    {event.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
