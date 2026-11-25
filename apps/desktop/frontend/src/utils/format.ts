import {
  ArtifactKind,
  TaskStatus,
  WorkflowTier,
} from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";

export type SemanticTone = "running" | "waiting" | "success" | "danger" | "neutral";
export type StatusIndicator = "pulse" | "dot" | "waiting" | "check" | "alert" | "error" | "idle";

export interface KanbanColumnDef {
  id: string;
  title: string;
  dotTone: SemanticTone;
  statuses: readonly TaskStatus[];
}

export const KANBAN_COLUMNS: readonly KanbanColumnDef[] = [
  {
    id: "triage",
    title: "分诊与待触发",
    dotTone: "neutral",
    statuses: [
      TaskStatus.StatusNew,
      TaskStatus.StatusTriaging,
      TaskStatus.StatusAwaitingInfo,
      TaskStatus.StatusAwaitingTrigger,
    ],
  },
  {
    id: "planning",
    title: "规划与审批",
    dotTone: "waiting",
    statuses: [
      TaskStatus.StatusRouting,
      TaskStatus.StatusPlanning,
      TaskStatus.StatusAwaitingPlanApproval,
    ],
  },
  {
    id: "coding",
    title: "编码与测试",
    dotTone: "running",
    statuses: [TaskStatus.StatusImplementing, TaskStatus.StatusTesting],
  },
  {
    id: "review",
    title: "Review 与 PR 自愈",
    dotTone: "running",
    statuses: [
      TaskStatus.StatusCrossReview,
      TaskStatus.StatusPrOpen,
      TaskStatus.StatusCiFixing,
      TaskStatus.StatusReviewFixing,
    ],
  },
  {
    id: "release",
    title: "待合并与发版",
    dotTone: "success",
    statuses: [
      TaskStatus.StatusReadyToMerge,
      TaskStatus.StatusMerged,
      TaskStatus.StatusReleasePrOpen,
      TaskStatus.StatusReleased,
    ],
  },
  {
    id: "exception",
    title: "需人工 / 异常",
    dotTone: "danger",
    statuses: [
      TaskStatus.StatusNeedsHuman,
      TaskStatus.StatusFailed,
      TaskStatus.StatusCancelled,
    ],
  },
];

export interface StatusMeta {
  label: string;
  tone: SemanticTone;
  indicator: StatusIndicator;
  badgeClass: string;
  pulsing: boolean;
}

export const STATUS_META: Record<string, StatusMeta> = {
  NEW: {
    label: "新建 Issue",
    tone: "neutral",
    indicator: "idle",
    badgeClass: "df-badge-neutral",
    pulsing: false,
  },
  TRIAGING: {
    label: "AI 分诊中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  AWAITING_INFO: {
    label: "等待补充信息",
    tone: "waiting",
    indicator: "waiting",
    badgeClass: "df-badge-waiting",
    pulsing: false,
  },
  AWAITING_TRIGGER: {
    label: "待触发",
    tone: "waiting",
    indicator: "waiting",
    badgeClass: "df-badge-waiting",
    pulsing: false,
  },
  ROUTING: {
    label: "智能路由中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  PLANNING: {
    label: "规格与规划中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  AWAITING_PLAN_APPROVAL: {
    label: "待审批计划",
    tone: "waiting",
    indicator: "waiting",
    badgeClass: "df-badge-waiting",
    pulsing: false,
  },
  IMPLEMENTING: {
    label: "编码实现中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  TESTING: {
    label: "测试验证中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  CROSS_REVIEW: {
    label: "交叉 Review 中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  PR_OPEN: {
    label: "PR 已开启",
    tone: "running",
    indicator: "dot",
    badgeClass: "df-badge-running",
    pulsing: false,
  },
  CI_FIXING: {
    label: "CI 自愈修复中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  REVIEW_FIXING: {
    label: "Review 修复中",
    tone: "running",
    indicator: "pulse",
    badgeClass: "df-badge-running",
    pulsing: true,
  },
  READY_TO_MERGE: {
    label: "待合并 PR",
    tone: "success",
    indicator: "check",
    badgeClass: "df-badge-success",
    pulsing: false,
  },
  MERGED: {
    label: "PR 已合并",
    tone: "success",
    indicator: "check",
    badgeClass: "df-badge-success",
    pulsing: false,
  },
  RELEASE_PR_OPEN: {
    label: "Release PR 开启",
    tone: "running",
    indicator: "dot",
    badgeClass: "df-badge-running",
    pulsing: false,
  },
  RELEASED: {
    label: "已发版",
    tone: "success",
    indicator: "check",
    badgeClass: "df-badge-success",
    pulsing: false,
  },
  NEEDS_HUMAN: {
    label: "需人工介入",
    tone: "danger",
    indicator: "alert",
    badgeClass: "df-badge-danger",
    pulsing: false,
  },
  FAILED: {
    label: "执行失败",
    tone: "danger",
    indicator: "error",
    badgeClass: "df-badge-danger",
    pulsing: false,
  },
  CANCELLED: {
    label: "已取消",
    tone: "neutral",
    indicator: "idle",
    badgeClass: "df-badge-neutral",
    pulsing: false,
  },
};

export const TIER_META: Record<string, { label: string; className: string }> = {
  [WorkflowTier.TierQuickFix]: {
    label: "Quick Fix",
    className: "bg-surface-3 text-ink-muted border-hairline-strong",
  },
  [WorkflowTier.TierFullSdlc]: {
    label: "Full SDLC",
    className: "bg-primary-soft text-primary-text border-primary-border",
  },
};

export const ARTIFACT_KIND_META: Record<string, { label: string; className: string }> = {
  [ArtifactKind.ArtifactTriage]: { label: "分诊报告", className: "df-badge-neutral" },
  [ArtifactKind.ArtifactSpec]: { label: "需求规格", className: "df-badge-running" },
  [ArtifactKind.ArtifactPlan]: { label: "实施计划", className: "df-badge-running" },
  [ArtifactKind.ArtifactTestReport]: { label: "测试报告", className: "df-badge-success" },
  [ArtifactKind.ArtifactReview]: { label: "交叉 Review", className: "df-badge-waiting" },
  [ArtifactKind.ArtifactDiff]: { label: "代码 Diff", className: "df-badge-neutral" },
  [ArtifactKind.ArtifactPrBody]: { label: "PR 描述", className: "df-badge-success" },
};

export const PIPELINE_STAGES = [
  { key: "triage", label: "分诊触发" },
  { key: "plan", label: "路由规划" },
  { key: "code", label: "编码测试" },
  { key: "review", label: "Review/自愈" },
  { key: "merge", label: "合并就绪" },
  { key: "release", label: "自动发版" },
] as const;

export function getPipelineStageIndex(status: TaskStatus): number {
  switch (status) {
    case TaskStatus.StatusNew:
    case TaskStatus.StatusTriaging:
    case TaskStatus.StatusAwaitingInfo:
    case TaskStatus.StatusAwaitingTrigger:
      return 0;
    case TaskStatus.StatusRouting:
    case TaskStatus.StatusPlanning:
    case TaskStatus.StatusAwaitingPlanApproval:
      return 1;
    case TaskStatus.StatusImplementing:
    case TaskStatus.StatusTesting:
      return 2;
    case TaskStatus.StatusCrossReview:
    case TaskStatus.StatusPrOpen:
    case TaskStatus.StatusCiFixing:
    case TaskStatus.StatusReviewFixing:
      return 3;
    case TaskStatus.StatusReadyToMerge:
    case TaskStatus.StatusMerged:
      return 4;
    case TaskStatus.StatusReleasePrOpen:
    case TaskStatus.StatusReleased:
      return 5;
    default:
      return -1;
  }
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["TRIAGING", "CANCELLED", "FAILED"],
  TRIAGING: ["AWAITING_INFO", "AWAITING_TRIGGER", "ROUTING", "CANCELLED", "NEEDS_HUMAN", "FAILED"],
  AWAITING_INFO: ["TRIAGING", "AWAITING_TRIGGER", "ROUTING", "CANCELLED", "NEEDS_HUMAN"],
  AWAITING_TRIGGER: ["ROUTING", "TRIAGING", "CANCELLED", "NEEDS_HUMAN"],
  ROUTING: ["PLANNING", "IMPLEMENTING", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  PLANNING: ["AWAITING_PLAN_APPROVAL", "IMPLEMENTING", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  AWAITING_PLAN_APPROVAL: ["PLANNING", "IMPLEMENTING", "CANCELLED", "NEEDS_HUMAN"],
  IMPLEMENTING: ["TESTING", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  TESTING: ["CROSS_REVIEW", "IMPLEMENTING", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  CROSS_REVIEW: ["PR_OPEN", "IMPLEMENTING", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  PR_OPEN: ["CI_FIXING", "REVIEW_FIXING", "READY_TO_MERGE", "MERGED", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  CI_FIXING: ["PR_OPEN", "READY_TO_MERGE", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  REVIEW_FIXING: ["PR_OPEN", "READY_TO_MERGE", "NEEDS_HUMAN", "CANCELLED", "FAILED"],
  READY_TO_MERGE: ["MERGED", "CI_FIXING", "REVIEW_FIXING", "NEEDS_HUMAN", "CANCELLED"],
  MERGED: ["RELEASE_PR_OPEN", "RELEASED"],
  RELEASE_PR_OPEN: ["RELEASED", "NEEDS_HUMAN"],
  RELEASED: [],
  NEEDS_HUMAN: ["TRIAGING", "ROUTING", "PLANNING", "IMPLEMENTING", "TESTING", "PR_OPEN", "CI_FIXING", "REVIEW_FIXING", "CANCELLED"],
  FAILED: ["TRIAGING", "ROUTING", "PLANNING", "IMPLEMENTING", "CANCELLED"],
  CANCELLED: ["TRIAGING", "ROUTING"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(ms?: number | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

export function formatRelativeTime(isoString?: string): string {
  if (!isoString) return "-";
  const time = Date.parse(isoString);
  if (Number.isNaN(time)) return isoString;
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 10) return "刚刚";
  if (diffSec < 60) return `${diffSec}s 前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m 前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h 前`;
  return `${Math.floor(diffHour / 24)}d 前`;
}

export function formatTimestamp(isoString?: string): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "发生未知错误";
}
