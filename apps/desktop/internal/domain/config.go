package domain

import (
	"fmt"
	"strings"
)

type AgentType string

const (
	AgentClaude    AgentType = "claude"
	AgentCodex     AgentType = "codex"
	AgentGemini    AgentType = "gemini"
	AgentOpenCode  AgentType = "opencode"
	AgentAider     AgentType = "aider"
	AgentQoderCLI  AgentType = "qodercli"
	AgentWorkBuddy AgentType = "workbuddy"
	AgentCodeBuddy AgentType = "codebuddy"
	AgentTemplate  AgentType = "template"
)

type AgentTemplateConfig struct {
	ArgsTemplate       []string `yaml:"argsTemplate" json:"argsTemplate"`
	QuotaErrorPatterns []string `yaml:"quotaErrorPatterns" json:"quotaErrorPatterns"`
	VersionArgs        []string `yaml:"versionArgs" json:"versionArgs"`
}

type AgentProfile struct {
	ID           string               `yaml:"id" json:"id"`
	DisplayName  string               `yaml:"displayName" json:"displayName"`
	Type         AgentType            `yaml:"type" json:"type"`
	Enabled      bool                 `yaml:"enabled" json:"enabled"`
	Command      string               `yaml:"command" json:"command"`
	Args         []string             `yaml:"args" json:"args"`
	Model        string               `yaml:"model,omitempty" json:"model,omitempty"`
	Strengths    []string             `yaml:"strengths" json:"strengths"`
	CostTier     string               `yaml:"costTier" json:"costTier"` // low | medium | high
	MaxBudgetUsd *float64             `yaml:"maxBudgetUsd,omitempty" json:"maxBudgetUsd,omitempty"`
	TimeoutSec   int                  `yaml:"timeoutSec" json:"timeoutSec"`
	EnvAllowlist []string             `yaml:"envAllowlist" json:"envAllowlist"`
	PromptMode   string               `yaml:"promptMode" json:"promptMode"` // stdin | arg | file
	OutputMode   string               `yaml:"outputMode" json:"outputMode"` // text | json | stream-json
	Template     *AgentTemplateConfig `yaml:"template,omitempty" json:"template,omitempty"`
}

type RoutingMatch struct {
	Categories    []IssueCategory `yaml:"categories,omitempty" json:"categories,omitempty"`
	Labels        []string        `yaml:"labels,omitempty" json:"labels,omitempty"`
	TitleRegex    string          `yaml:"titleRegex,omitempty" json:"titleRegex,omitempty"`
	ComplexityMin *int            `yaml:"complexityMin,omitempty" json:"complexityMin,omitempty"`
	ComplexityMax *int            `yaml:"complexityMax,omitempty" json:"complexityMax,omitempty"`
}

type RoutingRule struct {
	Name           string        `yaml:"name" json:"name"`
	Priority       int           `yaml:"priority" json:"priority"`
	Match          RoutingMatch  `yaml:"match" json:"match"`
	AgentID        string        `yaml:"agentId" json:"agentId"`
	FallbackAgents []string      `yaml:"fallbackAgents,omitempty" json:"fallbackAgents,omitempty"`
	TierOverride   *WorkflowTier `yaml:"tierOverride,omitempty" json:"tierOverride,omitempty"`
}

type NotificationEventType string

const (
	NotifyTriageCompleted      NotificationEventType = "triage_completed"
	NotifyPlanAwaitingApproval NotificationEventType = "plan_awaiting_approval"
	NotifyPrOpened             NotificationEventType = "pr_opened"
	NotifyCiFailed             NotificationEventType = "ci_failed"
	NotifyReviewRequested      NotificationEventType = "review_requested"
	NotifyReadyToMerge         NotificationEventType = "ready_to_merge"
	NotifyAgentFallback        NotificationEventType = "agent_fallback"
	NotifyNeedsHuman           NotificationEventType = "needs_human"
	NotifyMerged               NotificationEventType = "merged"
	NotifyReleased             NotificationEventType = "released"
	NotifyFailed               NotificationEventType = "failed"
)

type NotificationChannelConfig struct {
	ID        string                  `yaml:"id" json:"id"`
	Type      string                  `yaml:"type" json:"type"` // feishu | dingtalk | wecom | slack | discord | telegram | generic
	Enabled   bool                    `yaml:"enabled" json:"enabled"`
	URLEnv    string                  `yaml:"urlEnv" json:"urlEnv"`
	SecretEnv string                  `yaml:"secretEnv,omitempty" json:"secretEnv,omitempty"`
	ChatIDEnv string                  `yaml:"chatIdEnv,omitempty" json:"chatIdEnv,omitempty"`
	Events    []NotificationEventType `yaml:"events" json:"events"`
}

type RepoConfig struct {
	Owner        string `yaml:"owner" json:"owner"`
	Repo         string `yaml:"repo" json:"repo"`
	BaseBranch   string `yaml:"baseBranch" json:"baseBranch"`
	Enabled      bool   `yaml:"enabled" json:"enabled"`
	TestCommand  string `yaml:"testCommand,omitempty" json:"testCommand,omitempty"`
	BuildCommand string `yaml:"buildCommand,omitempty" json:"buildCommand,omitempty"`
	LintCommand  string `yaml:"lintCommand,omitempty" json:"lintCommand,omitempty"`
}

type AutoMergeLowRiskConfig struct {
	Enabled           bool     `yaml:"enabled" json:"enabled"`
	AllowedCategories []string `yaml:"allowedCategories" json:"allowedCategories"`
	MaxComplexity     int      `yaml:"maxComplexity" json:"maxComplexity"`
	MaxFilesChanged   int      `yaml:"maxFilesChanged" json:"maxFilesChanged"`
	MergeMethod       string   `yaml:"mergeMethod" json:"mergeMethod"` // squash | merge | rebase
}

type ProjectConfig struct {
	Name    string `yaml:"name" json:"name"`
	DataDir string `yaml:"dataDir" json:"dataDir"`
	Mode    string `yaml:"mode" json:"mode"` // live | demo
}

type GitHubConfig struct {
	TokenEnv         string                 `yaml:"tokenEnv" json:"tokenEnv"`
	WebhookSecretEnv string                 `yaml:"webhookSecretEnv" json:"webhookSecretEnv"`
	PollIntervalSec  int                    `yaml:"pollIntervalSec" json:"pollIntervalSec"`
	Repositories     []RepoConfig           `yaml:"repositories" json:"repositories"`
	TriggerLabel     string                 `yaml:"triggerLabel" json:"triggerLabel"`
	NeedsHumanLabel  string                 `yaml:"needsHumanLabel" json:"needsHumanLabel"`
	OwnerFastTrack   bool                   `yaml:"ownerFastTrack" json:"ownerFastTrack"`
	Maintainers      []string               `yaml:"maintainers" json:"maintainers"`
	AutoMergeLowRisk AutoMergeLowRiskConfig `yaml:"autoMergeLowRisk" json:"autoMergeLowRisk"`
}

type LlmConfig struct {
	Mode               string  `yaml:"mode" json:"mode"`         // api | cli_fallback | cli_only
	Provider           string  `yaml:"provider" json:"provider"` // openai-compatible | anthropic | gemini
	BaseURL            string  `yaml:"baseUrl" json:"baseUrl"`
	ApiKeyEnv          string  `yaml:"apiKeyEnv" json:"apiKeyEnv"`
	Model              string  `yaml:"model" json:"model"`
	CliFallbackAgentID string  `yaml:"cliFallbackAgentId,omitempty" json:"cliFallbackAgentId,omitempty"`
	Temperature        float64 `yaml:"temperature" json:"temperature"`
	MaxTokens          int     `yaml:"maxTokens" json:"maxTokens"`
}

type RoutingConfig struct {
	DefaultAgent              string        `yaml:"defaultAgent" json:"defaultAgent"`
	DefaultReviewerAgent      string        `yaml:"defaultReviewerAgent,omitempty" json:"defaultReviewerAgent,omitempty"`
	CrossReviewDifferentAgent bool          `yaml:"crossReviewDifferentAgent" json:"crossReviewDifferentAgent"`
	FallbackOrder             []string      `yaml:"fallbackOrder" json:"fallbackOrder"`
	Rules                     []RoutingRule `yaml:"rules" json:"rules"`
}

type WorkflowConfig struct {
	MaxConcurrentTasks             int    `yaml:"maxConcurrentTasks" json:"maxConcurrentTasks"`
	QuickFixMaxComplexity          int    `yaml:"quickFixMaxComplexity" json:"quickFixMaxComplexity"`
	RequirePlanApprovalForFullSdlc bool   `yaml:"requirePlanApprovalForFullSdlc" json:"requirePlanApprovalForFullSdlc"`
	MaxLocalFixRetries             int    `yaml:"maxLocalFixRetries" json:"maxLocalFixRetries"`
	MaxCrossReviewRetries          int    `yaml:"maxCrossReviewRetries" json:"maxCrossReviewRetries"`
	MaxCiFixRetries                int    `yaml:"maxCiFixRetries" json:"maxCiFixRetries"`
	MaxReviewFixRetries            int    `yaml:"maxReviewFixRetries" json:"maxReviewFixRetries"`
	DefaultTestCommand             string `yaml:"defaultTestCommand" json:"defaultTestCommand"`
	DefaultBuildCommand            string `yaml:"defaultBuildCommand,omitempty" json:"defaultBuildCommand,omitempty"`
	DefaultLintCommand             string `yaml:"defaultLintCommand,omitempty" json:"defaultLintCommand,omitempty"`
}

type ReleaseConfig struct {
	Mode                 string `yaml:"mode" json:"mode"` // release_pr | immediate_per_pr
	ReleasePrTitlePrefix string `yaml:"releasePrTitlePrefix" json:"releasePrTitlePrefix"`
	ReleaseBranchPrefix  string `yaml:"releaseBranchPrefix" json:"releaseBranchPrefix"`
	ConventionalCommits  bool   `yaml:"conventionalCommits" json:"conventionalCommits"`
}

type WorkspaceConfig struct {
	Runner               string `yaml:"runner" json:"runner"` // worktree | docker
	WorktreeRoot         string `yaml:"worktreeRoot" json:"worktreeRoot"`
	ReposRoot            string `yaml:"reposRoot" json:"reposRoot"`
	CleanupOnFinish      bool   `yaml:"cleanupOnFinish" json:"cleanupOnFinish"`
	DockerImage          string `yaml:"dockerImage" json:"dockerImage"`
	DockerNetwork        string `yaml:"dockerNetwork" json:"dockerNetwork"`
	LocalRepoUrlOverride string `yaml:"localRepoUrlOverride,omitempty" json:"localRepoUrlOverride,omitempty"`
}

type NotificationsConfig struct {
	Channels []NotificationChannelConfig `yaml:"channels" json:"channels"`
}

type ServerConfig struct {
	Host           string `yaml:"host" json:"host"`
	Port           int    `yaml:"port" json:"port"`
	CorsOrigin     string `yaml:"corsOrigin" json:"corsOrigin"`
	WebhookEnabled bool   `yaml:"webhookEnabled" json:"webhookEnabled"`
}

type DesktopConfig struct {
	Theme                string                  `yaml:"theme" json:"theme"` // system | light | dark
	NotificationsEnabled bool                    `yaml:"notificationsEnabled" json:"notificationsEnabled"`
	NotifyEvents         []NotificationEventType `yaml:"notifyEvents" json:"notifyEvents"`
}

type DragonFlowConfig struct {
	Project       ProjectConfig       `yaml:"project" json:"project"`
	GitHub        GitHubConfig        `yaml:"github" json:"github"`
	Llm           LlmConfig           `yaml:"llm" json:"llm"`
	Agents        []AgentProfile      `yaml:"agents" json:"agents"`
	Routing       RoutingConfig       `yaml:"routing" json:"routing"`
	Workflow      WorkflowConfig      `yaml:"workflow" json:"workflow"`
	Release       ReleaseConfig       `yaml:"release" json:"release"`
	Workspace     WorkspaceConfig     `yaml:"workspace" json:"workspace"`
	Notifications NotificationsConfig `yaml:"notifications" json:"notifications"`
	Server        ServerConfig        `yaml:"server" json:"server"`
	Desktop       DesktopConfig       `yaml:"desktop" json:"desktop"`
}

func DefaultNotifyEvents() []NotificationEventType {
	return []NotificationEventType{
		NotifyPlanAwaitingApproval,
		NotifyReadyToMerge,
		NotifyNeedsHuman,
		NotifyReleased,
		NotifyFailed,
	}
}

func DefaultConfig() DragonFlowConfig {
	return DragonFlowConfig{
		Project: ProjectConfig{
			Name:    "DragonFlow",
			DataDir: "",
			Mode:    "demo",
		},
		GitHub: GitHubConfig{
			TokenEnv:         "GITHUB_TOKEN",
			WebhookSecretEnv: "GITHUB_WEBHOOK_SECRET",
			PollIntervalSec:  30,
			Repositories:     []RepoConfig{},
			TriggerLabel:     "auto-dev",
			NeedsHumanLabel:  "needs-human",
			OwnerFastTrack:   true,
			Maintainers:      []string{},
			AutoMergeLowRisk: AutoMergeLowRiskConfig{
				Enabled:           false,
				AllowedCategories: []string{"docs", "chore"},
				MaxComplexity:     2,
				MaxFilesChanged:   5,
				MergeMethod:       "squash",
			},
		},
		Llm: LlmConfig{
			Mode:        "cli_fallback",
			Provider:    "openai-compatible",
			BaseURL:     "https://api.openai.com/v1",
			ApiKeyEnv:   "OPENAI_API_KEY",
			Model:       "gpt-4o-mini",
			Temperature: 0.2,
			MaxTokens:   4096,
		},
		Agents: []AgentProfile{},
		Routing: RoutingConfig{
			DefaultAgent:              "claude",
			CrossReviewDifferentAgent: true,
			FallbackOrder:             []string{"claude", "qodercli", "codex", "gemini", "opencode", "aider"},
			Rules:                     []RoutingRule{},
		},
		Workflow: WorkflowConfig{
			MaxConcurrentTasks:             2,
			QuickFixMaxComplexity:          2,
			RequirePlanApprovalForFullSdlc: true,
			MaxLocalFixRetries:             2,
			MaxCrossReviewRetries:          1,
			MaxCiFixRetries:                3,
			MaxReviewFixRetries:            3,
			DefaultTestCommand:             "pnpm test",
		},
		Release: ReleaseConfig{
			Mode:                 "release_pr",
			ReleasePrTitlePrefix: "chore(main): release",
			ReleaseBranchPrefix:  "release-please--",
			ConventionalCommits:  true,
		},
		Workspace: WorkspaceConfig{
			Runner:          "worktree",
			WorktreeRoot:    "",
			ReposRoot:       "",
			CleanupOnFinish: false,
			DockerImage:     "node:22-bookworm",
			DockerNetwork:   "bridge",
		},
		Notifications: NotificationsConfig{
			Channels: []NotificationChannelConfig{},
		},
		Server: ServerConfig{
			Host:           "127.0.0.1",
			Port:           4390,
			CorsOrigin:     "*",
			WebhookEnabled: false,
		},
		Desktop: DesktopConfig{
			Theme:                "system",
			NotificationsEnabled: true,
			NotifyEvents:         DefaultNotifyEvents(),
		},
	}
}

func (c *DragonFlowConfig) ApplyDefaults() {
	def := DefaultConfig()
	if strings.TrimSpace(c.Project.Name) == "" {
		c.Project.Name = def.Project.Name
	}
	if c.Project.Mode != "live" && c.Project.Mode != "demo" {
		c.Project.Mode = def.Project.Mode
	}
	if strings.TrimSpace(c.GitHub.TokenEnv) == "" {
		c.GitHub.TokenEnv = def.GitHub.TokenEnv
	}
	if strings.TrimSpace(c.GitHub.WebhookSecretEnv) == "" {
		c.GitHub.WebhookSecretEnv = def.GitHub.WebhookSecretEnv
	}
	if c.GitHub.PollIntervalSec < 5 {
		c.GitHub.PollIntervalSec = def.GitHub.PollIntervalSec
	}
	if c.GitHub.Repositories == nil {
		c.GitHub.Repositories = []RepoConfig{}
	}
	for i := range c.GitHub.Repositories {
		if strings.TrimSpace(c.GitHub.Repositories[i].BaseBranch) == "" {
			c.GitHub.Repositories[i].BaseBranch = "main"
		}
	}
	if strings.TrimSpace(c.GitHub.TriggerLabel) == "" {
		c.GitHub.TriggerLabel = def.GitHub.TriggerLabel
	}
	if strings.TrimSpace(c.GitHub.NeedsHumanLabel) == "" {
		c.GitHub.NeedsHumanLabel = def.GitHub.NeedsHumanLabel
	}
	if c.GitHub.Maintainers == nil {
		c.GitHub.Maintainers = []string{}
	}
	if c.GitHub.AutoMergeLowRisk.AllowedCategories == nil {
		c.GitHub.AutoMergeLowRisk.AllowedCategories = def.GitHub.AutoMergeLowRisk.AllowedCategories
	}
	if c.GitHub.AutoMergeLowRisk.MaxComplexity < 1 || c.GitHub.AutoMergeLowRisk.MaxComplexity > 5 {
		c.GitHub.AutoMergeLowRisk.MaxComplexity = def.GitHub.AutoMergeLowRisk.MaxComplexity
	}
	if c.GitHub.AutoMergeLowRisk.MaxFilesChanged <= 0 {
		c.GitHub.AutoMergeLowRisk.MaxFilesChanged = def.GitHub.AutoMergeLowRisk.MaxFilesChanged
	}
	if c.GitHub.AutoMergeLowRisk.MergeMethod == "" {
		c.GitHub.AutoMergeLowRisk.MergeMethod = def.GitHub.AutoMergeLowRisk.MergeMethod
	}
	if c.Llm.Mode == "" {
		c.Llm.Mode = def.Llm.Mode
	}
	if c.Llm.Provider == "" {
		c.Llm.Provider = def.Llm.Provider
	}
	if c.Llm.BaseURL == "" {
		c.Llm.BaseURL = def.Llm.BaseURL
	}
	if c.Llm.ApiKeyEnv == "" {
		c.Llm.ApiKeyEnv = def.Llm.ApiKeyEnv
	}
	if c.Llm.Model == "" {
		c.Llm.Model = def.Llm.Model
	}
	if c.Llm.MaxTokens <= 0 {
		c.Llm.MaxTokens = def.Llm.MaxTokens
	}
	if c.Agents == nil {
		c.Agents = []AgentProfile{}
	}
	if c.Routing.DefaultAgent == "" {
		c.Routing.DefaultAgent = def.Routing.DefaultAgent
	}
	if c.Routing.FallbackOrder == nil {
		c.Routing.FallbackOrder = def.Routing.FallbackOrder
	}
	if c.Routing.Rules == nil {
		c.Routing.Rules = []RoutingRule{}
	}
	if c.Workflow.MaxConcurrentTasks <= 0 {
		c.Workflow.MaxConcurrentTasks = def.Workflow.MaxConcurrentTasks
	}
	if c.Workflow.QuickFixMaxComplexity < 1 || c.Workflow.QuickFixMaxComplexity > 5 {
		c.Workflow.QuickFixMaxComplexity = def.Workflow.QuickFixMaxComplexity
	}
	if c.Workflow.DefaultTestCommand == "" {
		c.Workflow.DefaultTestCommand = def.Workflow.DefaultTestCommand
	}
	if c.Release.Mode == "" {
		c.Release.Mode = def.Release.Mode
	}
	if c.Release.ReleasePrTitlePrefix == "" {
		c.Release.ReleasePrTitlePrefix = def.Release.ReleasePrTitlePrefix
	}
	if c.Release.ReleaseBranchPrefix == "" {
		c.Release.ReleaseBranchPrefix = def.Release.ReleaseBranchPrefix
	}
	if c.Workspace.Runner == "" {
		c.Workspace.Runner = def.Workspace.Runner
	}
	if c.Workspace.DockerImage == "" {
		c.Workspace.DockerImage = def.Workspace.DockerImage
	}
	if c.Workspace.DockerNetwork == "" {
		c.Workspace.DockerNetwork = def.Workspace.DockerNetwork
	}
	if c.Notifications.Channels == nil {
		c.Notifications.Channels = []NotificationChannelConfig{}
	}
	for i := range c.Notifications.Channels {
		if len(c.Notifications.Channels[i].Events) == 0 {
			c.Notifications.Channels[i].Events = DefaultNotifyEvents()
		}
	}
	if c.Server.Host == "" {
		c.Server.Host = def.Server.Host
	}
	if c.Server.Port <= 0 {
		c.Server.Port = def.Server.Port
	}
	if c.Server.CorsOrigin == "" {
		c.Server.CorsOrigin = def.Server.CorsOrigin
	}
	if c.Desktop.Theme != "system" && c.Desktop.Theme != "light" && c.Desktop.Theme != "dark" {
		c.Desktop.Theme = def.Desktop.Theme
	}
	if c.Desktop.NotifyEvents == nil {
		c.Desktop.NotifyEvents = DefaultNotifyEvents()
	}
}

func (c *DragonFlowConfig) Validate() error {
	if c.Project.Mode != "live" && c.Project.Mode != "demo" {
		return fmt.Errorf("invalid project.mode %q: must be live or demo", c.Project.Mode)
	}
	if c.GitHub.PollIntervalSec < 5 {
		return fmt.Errorf("github.pollIntervalSec must be >= 5")
	}
	for i, r := range c.GitHub.Repositories {
		if strings.TrimSpace(r.Owner) == "" || strings.TrimSpace(r.Repo) == "" {
			return fmt.Errorf("github.repositories[%d] requires both owner and repo", i)
		}
	}
	switch c.Llm.Mode {
	case "api", "cli_fallback", "cli_only":
	default:
		return fmt.Errorf("invalid llm.mode %q", c.Llm.Mode)
	}
	switch c.Llm.Provider {
	case "openai-compatible", "anthropic", "gemini":
	default:
		return fmt.Errorf("invalid llm.provider %q", c.Llm.Provider)
	}
	switch c.Workspace.Runner {
	case "worktree", "docker":
	default:
		return fmt.Errorf("invalid workspace.runner %q", c.Workspace.Runner)
	}
	return nil
}
