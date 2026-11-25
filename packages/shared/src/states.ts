export const TASK_STATUSES = [
  'NEW',
  'TRIAGING',
  'AWAITING_INFO',
  'AWAITING_TRIGGER',
  'ROUTING',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'IMPLEMENTING',
  'TESTING',
  'CROSS_REVIEW',
  'PR_OPEN',
  'CI_FIXING',
  'REVIEW_FIXING',
  'READY_TO_MERGE',
  'MERGED',
  'RELEASE_PR_OPEN',
  'RELEASED',
  'NEEDS_HUMAN',
  'CANCELLED',
  'FAILED',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type WorkflowTier = 'quick_fix' | 'full_sdlc';

export type IssueCategory =
  | 'bug'
  | 'feature'
  | 'docs'
  | 'refactor'
  | 'chore'
  | 'question'
  | 'spam'
  | 'duplicate';

export type ArtifactKind =
  | 'triage'
  | 'spec'
  | 'plan'
  | 'test_report'
  | 'review'
  | 'diff'
  | 'pr_body';

export type AgentErrorKind =
  | 'none'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'auth_failed'
  | 'timeout'
  | 'runtime_error';

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'RELEASED',
  'CANCELLED',
  'FAILED',
]);

export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  NEW: ['TRIAGING', 'CANCELLED', 'FAILED'],
  TRIAGING: ['AWAITING_INFO', 'AWAITING_TRIGGER', 'ROUTING', 'CANCELLED', 'NEEDS_HUMAN', 'FAILED'],
  AWAITING_INFO: ['TRIAGING', 'AWAITING_TRIGGER', 'ROUTING', 'CANCELLED', 'NEEDS_HUMAN'],
  AWAITING_TRIGGER: ['ROUTING', 'TRIAGING', 'CANCELLED', 'NEEDS_HUMAN'],
  ROUTING: ['PLANNING', 'IMPLEMENTING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  PLANNING: ['AWAITING_PLAN_APPROVAL', 'IMPLEMENTING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  AWAITING_PLAN_APPROVAL: ['PLANNING', 'IMPLEMENTING', 'CANCELLED', 'NEEDS_HUMAN'],
  IMPLEMENTING: ['TESTING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  TESTING: ['CROSS_REVIEW', 'IMPLEMENTING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  CROSS_REVIEW: ['PR_OPEN', 'IMPLEMENTING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  PR_OPEN: ['CI_FIXING', 'REVIEW_FIXING', 'READY_TO_MERGE', 'MERGED', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  CI_FIXING: ['PR_OPEN', 'READY_TO_MERGE', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  REVIEW_FIXING: ['PR_OPEN', 'READY_TO_MERGE', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  READY_TO_MERGE: ['MERGED', 'CI_FIXING', 'REVIEW_FIXING', 'NEEDS_HUMAN', 'CANCELLED'],
  MERGED: ['RELEASE_PR_OPEN', 'RELEASED'],
  RELEASE_PR_OPEN: ['RELEASED', 'NEEDS_HUMAN'],
  RELEASED: [],
  NEEDS_HUMAN: [
    'TRIAGING',
    'ROUTING',
    'PLANNING',
    'IMPLEMENTING',
    'TESTING',
    'PR_OPEN',
    'CI_FIXING',
    'REVIEW_FIXING',
    'CANCELLED',
  ],
  FAILED: ['TRIAGING', 'ROUTING', 'PLANNING', 'IMPLEMENTING', 'CANCELLED'],
  CANCELLED: ['TRIAGING', 'ROUTING'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
