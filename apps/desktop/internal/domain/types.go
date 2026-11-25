package domain

type GitHubIssue struct {
	Number            int      `json:"number"`
	Title             string   `json:"title"`
	Body              string   `json:"body"`
	Author            string   `json:"author"`
	AuthorAssociation string   `json:"authorAssociation"`
	Labels            []string `json:"labels"`
	State             string   `json:"state"`
	URL               string   `json:"url"`
	CreatedAt         string   `json:"createdAt"`
	UpdatedAt         string   `json:"updatedAt"`
	IsPullRequest     bool     `json:"isPullRequest,omitempty"`
}

type GitHubComment struct {
	ID                int64  `json:"id"`
	Body              string `json:"body"`
	Author            string `json:"author"`
	AuthorAssociation string `json:"authorAssociation"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
	URL               string `json:"url,omitempty"`
}

type GitHubPullRequest struct {
	Number         int      `json:"number"`
	Title          string   `json:"title"`
	Body           string   `json:"body"`
	HeadBranch     string   `json:"headBranch"`
	BaseBranch     string   `json:"baseBranch"`
	State          string   `json:"state"`
	Merged         bool     `json:"merged"`
	MergeCommitSha string   `json:"mergeCommitSha,omitempty"`
	URL            string   `json:"url"`
	Labels         []string `json:"labels"`
	Draft          bool     `json:"draft,omitempty"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type GitHubCheckRun struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	Conclusion    string `json:"conclusion"`
	DetailsURL    string `json:"detailsUrl,omitempty"`
	OutputTitle   string `json:"outputTitle,omitempty"`
	OutputSummary string `json:"outputSummary,omitempty"`
}

type GitHubReview struct {
	ID                int64  `json:"id"`
	Author            string `json:"author"`
	AuthorAssociation string `json:"authorAssociation"`
	State             string `json:"state"`
	Body              string `json:"body"`
	SubmittedAt       string `json:"submittedAt"`
}

type GitHubReviewComment struct {
	ID        int64  `json:"id"`
	Author    string `json:"author"`
	Path      string `json:"path"`
	Line      *int   `json:"line,omitempty"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

type GitHubRelease struct {
	ID          int64  `json:"id"`
	TagName     string `json:"tagName"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	URL         string `json:"url"`
	PublishedAt string `json:"publishedAt"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

type TriageResult struct {
	Category            IssueCategory `json:"category"`
	IsDuplicate         bool          `json:"isDuplicate"`
	DuplicateOf         *int          `json:"duplicateOf,omitempty"`
	NeedsMoreInfo       bool          `json:"needsMoreInfo"`
	ClarifyingQuestions []string      `json:"clarifyingQuestions"`
	SuggestedLabels     []string      `json:"suggestedLabels"`
	EstimatedComplexity int           `json:"estimatedComplexity"`
	RecommendedTier     WorkflowTier  `json:"recommendedTier"`
	Summary             string        `json:"summary"`
	RiskFlags           []string      `json:"riskFlags"`
}

type RoutingDecision struct {
	Tier            WorkflowTier `json:"tier"`
	ComplexityScore int          `json:"complexityScore"`
	PrimaryAgent    string       `json:"primaryAgent"`
	ReviewerAgent   string       `json:"reviewerAgent"`
	FallbackAgents  []string     `json:"fallbackAgents"`
	Rationale       string       `json:"rationale"`
	SelectedBy      string       `json:"selectedBy"`
	MatchedRuleName string       `json:"matchedRuleName,omitempty"`
}

type SpecDocument struct {
	ProblemStatement   string   `json:"problemStatement"`
	AcceptanceCriteria []string `json:"acceptanceCriteria"`
	NonGoals           []string `json:"nonGoals"`
	AffectedAreas      []string `json:"affectedAreas"`
	Markdown           string   `json:"markdown"`
}

type PlanDocument struct {
	ArchitectureSummary string   `json:"architectureSummary"`
	FilesToModify       []string `json:"filesToModify"`
	ImplementationSteps []string `json:"implementationSteps"`
	TestPlan            []string `json:"testPlan"`
	RisksAndMitigations []string `json:"risksAndMitigations"`
	Markdown            string   `json:"markdown"`
}

type CrossReviewFinding struct {
	Severity   string `json:"severity"`
	File       string `json:"file,omitempty"`
	Line       *int   `json:"line,omitempty"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion,omitempty"`
}

type CrossReviewChecklist struct {
	AcceptanceCriteriaMet  bool `json:"acceptanceCriteriaMet"`
	TestsAdequate          bool `json:"testsAdequate"`
	NoObviousSecurityRisks bool `json:"noObviousSecurityRisks"`
	CleanScope             bool `json:"cleanScope"`
}

type CrossReviewResult struct {
	Approved  bool                 `json:"approved"`
	Summary   string               `json:"summary"`
	Findings  []CrossReviewFinding `json:"findings"`
	Checklist CrossReviewChecklist `json:"checklist"`
}

type FallbackAttemptRecord struct {
	FromAgent string         `json:"fromAgent"`
	ToAgent   string         `json:"toAgent"`
	Stage     string         `json:"stage"`
	Reason    string         `json:"reason"`
	ErrorKind AgentErrorKind `json:"errorKind"`
	Timestamp string         `json:"timestamp"`
}

type TaskRecord struct {
	ID                     string                  `json:"id"`
	RepoFullName           string                  `json:"repoFullName"`
	IssueNumber            int                     `json:"issueNumber"`
	IssueTitle             string                  `json:"issueTitle"`
	IssueBody              string                  `json:"issueBody"`
	IssueURL               string                  `json:"issueUrl"`
	IssueAuthor            string                  `json:"issueAuthor"`
	Labels                 []string                `json:"labels"`
	Status                 TaskStatus              `json:"status"`
	Tier                   WorkflowTier            `json:"tier"`
	Category               *IssueCategory          `json:"category,omitempty"`
	ComplexityScore        *int                    `json:"complexityScore,omitempty"`
	AssignedAgent          *string                 `json:"assignedAgent,omitempty"`
	ReviewerAgent          *string                 `json:"reviewerAgent,omitempty"`
	FallbackCount          int                     `json:"fallbackCount"`
	FallbackHistory        []FallbackAttemptRecord `json:"fallbackHistory"`
	RoutingRationale       *string                 `json:"routingRationale,omitempty"`
	BranchName             *string                 `json:"branchName,omitempty"`
	WorktreePath           *string                 `json:"worktreePath,omitempty"`
	PrNumber               *int                    `json:"prNumber,omitempty"`
	PrURL                  *string                 `json:"prUrl,omitempty"`
	ReleasePrNumber        *int                    `json:"releasePrNumber,omitempty"`
	ReleasePrURL           *string                 `json:"releasePrUrl,omitempty"`
	ReleaseTag             *string                 `json:"releaseTag,omitempty"`
	ReleaseURL             *string                 `json:"releaseUrl,omitempty"`
	StatusCommentID        *int64                  `json:"statusCommentId,omitempty"`
	LocalFixRetries        int                     `json:"localFixRetries"`
	CrossReviewRetries     int                     `json:"crossReviewRetries"`
	CiFixRetries           int                     `json:"ciFixRetries"`
	ReviewFixRetries       int                     `json:"reviewFixRetries"`
	LastProcessedCommentID int64                   `json:"lastProcessedCommentId"`
	LastProcessedReviewID  int64                   `json:"lastProcessedReviewId"`
	TotalTokens            int                     `json:"totalTokens"`
	EstimatedCostUsd       float64                 `json:"estimatedCostUsd"`
	LastError              *string                 `json:"lastError,omitempty"`
	CreatedAt              string                  `json:"createdAt"`
	UpdatedAt              string                  `json:"updatedAt"`
}

type TaskRunRecord struct {
	ID         string         `json:"id"`
	TaskID     string         `json:"taskId"`
	Stage      string         `json:"stage"`
	AgentID    string         `json:"agentId"`
	Attempt    int            `json:"attempt"`
	Status     string         `json:"status"`
	ErrorKind  AgentErrorKind `json:"errorKind"`
	ExitCode   *int           `json:"exitCode,omitempty"`
	TokensUsed int            `json:"tokensUsed"`
	CostUsd    float64        `json:"costUsd"`
	Summary    *string        `json:"summary,omitempty"`
	StartedAt  string         `json:"startedAt"`
	FinishedAt *string        `json:"finishedAt,omitempty"`
	DurationMs *int64         `json:"durationMs,omitempty"`
}

type TaskArtifact struct {
	ID        string                 `json:"id"`
	TaskID    string                 `json:"taskId"`
	Kind      ArtifactKind           `json:"kind"`
	Title     string                 `json:"title"`
	Content   string                 `json:"content"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt string                 `json:"createdAt"`
}

type TaskLogEntry struct {
	ID        int64  `json:"id"`
	TaskID    string `json:"taskId"`
	RunID     string `json:"runId"`
	Stream    string `json:"stream"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type AuditEventRecord struct {
	ID         int64       `json:"id"`
	TaskID     string      `json:"taskId"`
	FromStatus *TaskStatus `json:"fromStatus"`
	ToStatus   TaskStatus  `json:"toStatus"`
	Actor      string      `json:"actor"`
	Reason     string      `json:"reason"`
	CreatedAt  string      `json:"createdAt"`
}

type AgentHealthInfo struct {
	ID            string   `json:"id"`
	DisplayName   string   `json:"displayName"`
	Type          string   `json:"type"`
	Enabled       bool     `json:"enabled"`
	Available     bool     `json:"available"`
	Command       string   `json:"command"`
	ResolvedPath  string   `json:"resolvedPath,omitempty"`
	Version       string   `json:"version,omitempty"`
	Strengths     []string `json:"strengths"`
	CostTier      string   `json:"costTier"`
	LastCheckedAt string   `json:"lastCheckedAt"`
	Error         string   `json:"error,omitempty"`
}

type DashboardOverview struct {
	TotalTasks           int            `json:"totalTasks"`
	ActiveTasks          int            `json:"activeTasks"`
	ByStatus             map[string]int `json:"byStatus"`
	ByAgent              map[string]int `json:"byAgent"`
	SuccessRate          float64        `json:"successRate"`
	AvgDurationMs        int64          `json:"avgDurationMs"`
	TotalTokens          int            `json:"totalTokens"`
	EstimatedCostUsd     float64        `json:"estimatedCostUsd"`
	Mode                 string         `json:"mode"`
	RepoFullName         string         `json:"repoFullName"`
	AvailableAgentsCount int            `json:"availableAgentsCount"`
	TotalAgentsCount     int            `json:"totalAgentsCount"`
}

type TaskDetailResponse struct {
	Task        TaskRecord         `json:"task"`
	Runs        []TaskRunRecord    `json:"runs"`
	Artifacts   []TaskArtifact     `json:"artifacts"`
	AuditEvents []AuditEventRecord `json:"auditEvents"`
}

type ParsedCommandType string

const (
	CmdAuto    ParsedCommandType = "auto"
	CmdApprove ParsedCommandType = "approve"
	CmdReject  ParsedCommandType = "reject"
	CmdFix     ParsedCommandType = "fix"
	CmdRetry   ParsedCommandType = "retry"
	CmdMerge   ParsedCommandType = "merge"
	CmdCancel  ParsedCommandType = "cancel"
)

type ParsedCommand struct {
	Command   ParsedCommandType `json:"command"`
	Arg       string            `json:"arg,omitempty"`
	Author    string            `json:"author"`
	CommentID int64             `json:"commentId"`
}

type AppEvent struct {
	Type       string            `json:"type"`
	Timestamp  string            `json:"timestamp,omitempty"`
	Task       *TaskRecord       `json:"task,omitempty"`
	TaskID     string            `json:"taskId,omitempty"`
	FromStatus *TaskStatus       `json:"fromStatus,omitempty"`
	ToStatus   *TaskStatus       `json:"toStatus,omitempty"`
	Actor      string            `json:"actor,omitempty"`
	Reason     string            `json:"reason,omitempty"`
	Run        *TaskRunRecord    `json:"run,omitempty"`
	Entry      *TaskLogEntry     `json:"entry,omitempty"`
	Artifact   *TaskArtifact     `json:"artifact,omitempty"`
	Agents     []AgentHealthInfo `json:"agents,omitempty"`
	Mode       string            `json:"mode,omitempty"`
}

type SecretStatus struct {
	Key        string `json:"key"`
	Configured bool   `json:"configured"`
	Source     string `json:"source"` // "vault" | "env" | "none"
}

type SanitizedGitHubConfig struct {
	GitHubConfig
	TokenConfigured         bool `json:"tokenConfigured"`
	WebhookSecretConfigured bool `json:"webhookSecretConfigured"`
}

type SanitizedLlmConfig struct {
	LlmConfig
	ApiKeyConfigured bool `json:"apiKeyConfigured"`
}

type SanitizedConfig struct {
	Project       ProjectConfig         `json:"project"`
	GitHub        SanitizedGitHubConfig `json:"github"`
	Llm           SanitizedLlmConfig    `json:"llm"`
	Agents        []AgentProfile        `json:"agents"`
	Routing       RoutingConfig         `json:"routing"`
	Workflow      WorkflowConfig        `json:"workflow"`
	Release       ReleaseConfig         `json:"release"`
	Workspace     WorkspaceConfig       `json:"workspace"`
	Notifications NotificationsConfig   `json:"notifications"`
	Server        ServerConfig          `json:"server"`
	Desktop       DesktopConfig         `json:"desktop"`
}

type TraySnapshot struct {
	Mode            string       `json:"mode"`
	RepoFullName    string       `json:"repoFullName"`
	ActiveTasks     int          `json:"activeTasks"`
	TotalTasks      int          `json:"totalTasks"`
	AvailableAgents int          `json:"availableAgents"`
	TotalAgents     int          `json:"totalAgents"`
	PendingTasks    []TaskRecord `json:"pendingTasks"`
	RecentTasks     []TaskRecord `json:"recentTasks"`
}

type DesktopInfo struct {
	Version        string `json:"version"`
	Mode           string `json:"mode"`
	DataDir        string `json:"dataDir"`
	ConfigPath     string `json:"configPath"`
	DBPath         string `json:"dbPath"`
	Portable       bool   `json:"portable"`
	Autostart      bool   `json:"autostart"`
	Theme          string `json:"theme"`
	IsFirstLaunch  bool   `json:"isFirstLaunch"`
	GitAvailable   bool   `json:"gitAvailable"`
	WebhookActive  bool   `json:"webhookActive"`
	WebhookAddress string `json:"webhookAddress,omitempty"`
}

type SimulateIssueInput struct {
	Title       string   `json:"title,omitempty"`
	Body        string   `json:"body,omitempty"`
	Labels      []string `json:"labels,omitempty"`
	TierPreset  string   `json:"tierPreset"`
	AutoTrigger bool     `json:"autoTrigger"`
}

type SimulateIssueResult struct {
	Task        TaskRecord `json:"task"`
	IssueNumber int        `json:"issueNumber"`
}

type SyncResult struct {
	Synced          bool `json:"synced"`
	IssuesProcessed int  `json:"issuesProcessed"`
	PrsChecked      int  `json:"prsChecked"`
}
