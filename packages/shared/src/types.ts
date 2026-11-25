import type {
  AgentErrorKind,
  ArtifactKind,
  IssueCategory,
  TaskStatus,
  WorkflowTier,
} from './states.js';
import type { DragonFlowConfig } from './config.js';

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  authorAssociation: string;
  labels: string[];
  state: 'open' | 'closed';
  url: string;
  createdAt: string;
  updatedAt: string;
  isPullRequest?: boolean;
}

export interface GitHubComment {
  id: number;
  body: string;
  author: string;
  authorAssociation: string;
  createdAt: string;
  updatedAt: string;
  url?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha?: string;
  url: string;
  labels: string[];
  draft?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  detailsUrl?: string;
  outputTitle?: string;
  outputSummary?: string;
}

export interface GitHubReview {
  id: number;
  author: string;
  authorAssociation: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  body: string;
  submittedAt: string;
}

export interface GitHubReviewComment {
  id: number;
  author: string;
  path: string;
  line?: number;
  body: string;
  createdAt: string;
}

export interface GitHubRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  url: string;
  publishedAt: string;
  draft: boolean;
  prerelease: boolean;
}

export interface TriageResult {
  category: IssueCategory;
  isDuplicate: boolean;
  duplicateOf?: number;
  needsMoreInfo: boolean;
  clarifyingQuestions: string[];
  suggestedLabels: string[];
  estimatedComplexity: number; // 1..5
  recommendedTier: WorkflowTier;
  summary: string;
  riskFlags: string[];
}

export interface RoutingDecision {
  tier: WorkflowTier;
  complexityScore: number;
  primaryAgent: string;
  reviewerAgent: string;
  fallbackAgents: string[];
  rationale: string;
  selectedBy: 'manual' | 'rule' | 'llm' | 'default_fallback';
  matchedRuleName?: string;
}

export interface SpecDocument {
  problemStatement: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  affectedAreas: string[];
  markdown: string;
}

export interface PlanDocument {
  architectureSummary: string;
  filesToModify: string[];
  implementationSteps: string[];
  testPlan: string[];
  risksAndMitigations: string[];
  markdown: string;
}

export interface CrossReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface CrossReviewResult {
  approved: boolean;
  summary: string;
  findings: CrossReviewFinding[];
  checklist: {
    acceptanceCriteriaMet: boolean;
    testsAdequate: boolean;
    noObviousSecurityRisks: boolean;
    cleanScope: boolean;
  };
}

export interface FallbackAttemptRecord {
  fromAgent: string;
  toAgent: string;
  stage: string;
  reason: string;
  errorKind: AgentErrorKind;
  timestamp: string;
}

export interface TaskRecord {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  issueAuthor: string;
  labels: string[];
  status: TaskStatus;
  tier: WorkflowTier;
  category?: IssueCategory;
  complexityScore?: number;
  assignedAgent?: string;
  reviewerAgent?: string;
  fallbackCount: number;
  fallbackHistory: FallbackAttemptRecord[];
  routingRationale?: string;
  branchName?: string;
  worktreePath?: string;
  prNumber?: number;
  prUrl?: string;
  releasePrNumber?: number;
  releasePrUrl?: string;
  releaseTag?: string;
  releaseUrl?: string;
  statusCommentId?: number;
  localFixRetries: number;
  crossReviewRetries: number;
  ciFixRetries: number;
  reviewFixRetries: number;
  lastProcessedCommentId: number;
  lastProcessedReviewId: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRunRecord {
  id: string;
  taskId: string;
  stage: string;
  agentId: string;
  attempt: number;
  status: 'running' | 'succeeded' | 'failed';
  errorKind: AgentErrorKind;
  exitCode?: number;
  tokensUsed: number;
  costUsd: number;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface TaskArtifact {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface TaskLogEntry {
  id: number;
  taskId: string;
  runId: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: string;
}

export interface AuditEventRecord {
  id: number;
  taskId: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  actor: string;
  reason: string;
  createdAt: string;
}

export interface AgentHealthInfo {
  id: string;
  displayName: string;
  type: string;
  enabled: boolean;
  available: boolean;
  command: string;
  resolvedPath?: string;
  version?: string;
  strengths: string[];
  costTier: 'low' | 'medium' | 'high';
  lastCheckedAt: string;
  error?: string;
}

export interface DashboardOverview {
  totalTasks: number;
  activeTasks: number;
  byStatus: Record<string, number>;
  byAgent: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
  mode: 'live' | 'demo';
  repoFullName: string;
  availableAgentsCount: number;
  totalAgentsCount: number;
}

export interface TaskDetailResponse {
  task: TaskRecord;
  runs: TaskRunRecord[];
  artifacts: TaskArtifact[];
  auditEvents: AuditEventRecord[];
}

export type ParsedCommandType =
  | 'auto'
  | 'approve'
  | 'reject'
  | 'fix'
  | 'retry'
  | 'merge'
  | 'cancel';

export interface ParsedCommand {
  command: ParsedCommandType;
  arg?: string;
  author: string;
  commentId: number;
}

export type SseEvent =
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'task:updated'; task: TaskRecord }
  | {
      type: 'task:transitioned';
      taskId: string;
      fromStatus: TaskStatus | null;
      toStatus: TaskStatus;
      actor: string;
      reason: string;
      timestamp: string;
    }
  | { type: 'run:started'; run: TaskRunRecord }
  | { type: 'run:finished'; run: TaskRunRecord }
  | { type: 'log:chunk'; entry: TaskLogEntry }
  | { type: 'artifact:created'; artifact: TaskArtifact }
  | { type: 'agent:health'; agents: AgentHealthInfo[] };

export type SanitizedConfig = Omit<DragonFlowConfig, 'github' | 'llm'> & {
  github: DragonFlowConfig['github'] & { tokenConfigured: boolean; webhookSecretConfigured: boolean };
  llm: DragonFlowConfig['llm'] & { apiKeyConfigured: boolean };
};
