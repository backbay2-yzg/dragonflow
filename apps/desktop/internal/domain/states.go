package domain

type TaskStatus string

const (
	StatusNew                  TaskStatus = "NEW"
	StatusTriaging             TaskStatus = "TRIAGING"
	StatusAwaitingInfo         TaskStatus = "AWAITING_INFO"
	StatusAwaitingTrigger      TaskStatus = "AWAITING_TRIGGER"
	StatusRouting              TaskStatus = "ROUTING"
	StatusPlanning             TaskStatus = "PLANNING"
	StatusAwaitingPlanApproval TaskStatus = "AWAITING_PLAN_APPROVAL"
	StatusImplementing         TaskStatus = "IMPLEMENTING"
	StatusTesting              TaskStatus = "TESTING"
	StatusCrossReview          TaskStatus = "CROSS_REVIEW"
	StatusPrOpen               TaskStatus = "PR_OPEN"
	StatusCiFixing             TaskStatus = "CI_FIXING"
	StatusReviewFixing         TaskStatus = "REVIEW_FIXING"
	StatusReadyToMerge         TaskStatus = "READY_TO_MERGE"
	StatusMerged               TaskStatus = "MERGED"
	StatusReleasePrOpen        TaskStatus = "RELEASE_PR_OPEN"
	StatusReleased             TaskStatus = "RELEASED"
	StatusNeedsHuman           TaskStatus = "NEEDS_HUMAN"
	StatusCancelled            TaskStatus = "CANCELLED"
	StatusFailed               TaskStatus = "FAILED"
)

var AllTaskStatuses = []TaskStatus{
	StatusNew,
	StatusTriaging,
	StatusAwaitingInfo,
	StatusAwaitingTrigger,
	StatusRouting,
	StatusPlanning,
	StatusAwaitingPlanApproval,
	StatusImplementing,
	StatusTesting,
	StatusCrossReview,
	StatusPrOpen,
	StatusCiFixing,
	StatusReviewFixing,
	StatusReadyToMerge,
	StatusMerged,
	StatusReleasePrOpen,
	StatusReleased,
	StatusNeedsHuman,
	StatusCancelled,
	StatusFailed,
}

func IsValidTaskStatus(s string) bool {
	for _, st := range AllTaskStatuses {
		if string(st) == s {
			return true
		}
	}
	return false
}

type WorkflowTier string

const (
	TierQuickFix WorkflowTier = "quick_fix"
	TierFullSdlc WorkflowTier = "full_sdlc"
)

type IssueCategory string

const (
	CategoryBug       IssueCategory = "bug"
	CategoryFeature   IssueCategory = "feature"
	CategoryDocs      IssueCategory = "docs"
	CategoryRefactor  IssueCategory = "refactor"
	CategoryChore     IssueCategory = "chore"
	CategoryQuestion  IssueCategory = "question"
	CategorySpam      IssueCategory = "spam"
	CategoryDuplicate IssueCategory = "duplicate"
)

type ArtifactKind string

const (
	ArtifactTriage     ArtifactKind = "triage"
	ArtifactSpec       ArtifactKind = "spec"
	ArtifactPlan       ArtifactKind = "plan"
	ArtifactTestReport ArtifactKind = "test_report"
	ArtifactReview     ArtifactKind = "review"
	ArtifactDiff       ArtifactKind = "diff"
	ArtifactPrBody     ArtifactKind = "pr_body"
)

type AgentErrorKind string

const (
	ErrKindNone          AgentErrorKind = "none"
	ErrKindQuotaExceeded AgentErrorKind = "quota_exceeded"
	ErrKindRateLimited   AgentErrorKind = "rate_limited"
	ErrKindAuthFailed    AgentErrorKind = "auth_failed"
	ErrKindTimeout       AgentErrorKind = "timeout"
	ErrKindRuntimeError  AgentErrorKind = "runtime_error"
)

var TerminalStatuses = map[TaskStatus]bool{
	StatusReleased:  true,
	StatusCancelled: true,
	StatusFailed:    true,
}

var ValidTransitions = map[TaskStatus][]TaskStatus{
	StatusNew:                  {StatusTriaging, StatusCancelled, StatusFailed},
	StatusTriaging:             {StatusAwaitingInfo, StatusAwaitingTrigger, StatusRouting, StatusCancelled, StatusNeedsHuman, StatusFailed},
	StatusAwaitingInfo:         {StatusTriaging, StatusAwaitingTrigger, StatusRouting, StatusCancelled, StatusNeedsHuman},
	StatusAwaitingTrigger:      {StatusRouting, StatusTriaging, StatusCancelled, StatusNeedsHuman},
	StatusRouting:              {StatusPlanning, StatusImplementing, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusPlanning:             {StatusAwaitingPlanApproval, StatusImplementing, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusAwaitingPlanApproval: {StatusPlanning, StatusImplementing, StatusCancelled, StatusNeedsHuman},
	StatusImplementing:         {StatusTesting, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusTesting:              {StatusCrossReview, StatusImplementing, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusCrossReview:          {StatusPrOpen, StatusImplementing, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusPrOpen:               {StatusCiFixing, StatusReviewFixing, StatusReadyToMerge, StatusMerged, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusCiFixing:             {StatusPrOpen, StatusReadyToMerge, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusReviewFixing:         {StatusPrOpen, StatusReadyToMerge, StatusNeedsHuman, StatusCancelled, StatusFailed},
	StatusReadyToMerge:         {StatusMerged, StatusCiFixing, StatusReviewFixing, StatusNeedsHuman, StatusCancelled},
	StatusMerged:               {StatusReleasePrOpen, StatusReleased},
	StatusReleasePrOpen:        {StatusReleased, StatusNeedsHuman},
	StatusReleased:             {},
	StatusNeedsHuman: {
		StatusTriaging,
		StatusRouting,
		StatusPlanning,
		StatusImplementing,
		StatusTesting,
		StatusPrOpen,
		StatusCiFixing,
		StatusReviewFixing,
		StatusCancelled,
	},
	StatusFailed:    {StatusTriaging, StatusRouting, StatusPlanning, StatusImplementing, StatusCancelled},
	StatusCancelled: {StatusTriaging, StatusRouting},
}

func CanTransition(from, to TaskStatus) bool {
	if from == to {
		return true
	}
	allowed, ok := ValidTransitions[from]
	if !ok {
		return false
	}
	for _, candidate := range allowed {
		if candidate == to {
			return true
		}
	}
	return false
}

func IsTerminalStatus(status TaskStatus) bool {
	return TerminalStatuses[status]
}
