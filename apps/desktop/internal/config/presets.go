package config

import (
	"path/filepath"

	"github.com/dragonflow/desktop/internal/domain"
)

func ptrFloat(v float64) *float64                { return &v }
func ptrInt(v int) *int                          { return &v }
func ptrTier(v domain.WorkflowTier) *domain.WorkflowTier { return &v }

func DefaultAgentPresets() []domain.AgentProfile {
	return []domain.AgentProfile{
		{
			ID:           "claude",
			DisplayName:  "Claude Code",
			Type:         domain.AgentClaude,
			Enabled:      true,
			Command:      "claude",
			Args:         []string{},
			Strengths:    []string{"architecture", "complex-bug", "refactoring", "fullstack", "code-review"},
			CostTier:     "high",
			MaxBudgetUsd: ptrFloat(3),
			TimeoutSec:   900,
			EnvAllowlist: []string{"ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK"},
			PromptMode:   "stdin",
			OutputMode:   "stream-json",
		},
		{
			ID:           "qodercli",
			DisplayName:  "Qoder CLI",
			Type:         domain.AgentQoderCLI,
			Enabled:      true,
			Command:      "qodercli",
			Args:         []string{},
			Strengths:    []string{"fullstack", "bug-fix", "feature", "refactoring", "chinese-context"},
			CostTier:     "medium",
			TimeoutSec:   900,
			EnvAllowlist: []string{"QODER_API_KEY", "QODER_BASE_URL"},
			PromptMode:   "stdin",
			OutputMode:   "text",
		},
		{
			ID:           "codex",
			DisplayName:  "OpenAI Codex CLI",
			Type:         domain.AgentCodex,
			Enabled:      true,
			Command:      "codex",
			Args:         []string{},
			Strengths:    []string{"backend", "algorithms", "testing", "bug-fix"},
			CostTier:     "high",
			TimeoutSec:   900,
			EnvAllowlist: []string{"OPENAI_API_KEY", "OPENAI_BASE_URL"},
			PromptMode:   "stdin",
			OutputMode:   "json",
		},
		{
			ID:           "gemini",
			DisplayName:  "Gemini CLI",
			Type:         domain.AgentGemini,
			Enabled:      true,
			Command:      "gemini",
			Args:         []string{},
			Strengths:    []string{"large-context", "docs", "frontend", "code-review"},
			CostTier:     "medium",
			TimeoutSec:   900,
			EnvAllowlist: []string{"GEMINI_API_KEY", "GOOGLE_API_KEY"},
			PromptMode:   "stdin",
			OutputMode:   "json",
		},
		{
			ID:           "opencode",
			DisplayName:  "OpenCode",
			Type:         domain.AgentOpenCode,
			Enabled:      true,
			Command:      "opencode",
			Args:         []string{},
			Strengths:    []string{"quick-fix", "docs", "multi-model", "low-cost"},
			CostTier:     "low",
			TimeoutSec:   600,
			EnvAllowlist: []string{"OPENAI_API_KEY", "OPENAI_BASE_URL", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"},
			PromptMode:   "stdin",
			OutputMode:   "json",
		},
		{
			ID:           "aider",
			DisplayName:  "Aider",
			Type:         domain.AgentAider,
			Enabled:      true,
			Command:      "aider",
			Args:         []string{},
			Strengths:    []string{"targeted-edit", "refactoring", "low-cost"},
			CostTier:     "low",
			TimeoutSec:   600,
			EnvAllowlist: []string{"OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"},
			PromptMode:   "file",
			OutputMode:   "text",
		},
		{
			ID:           "workbuddy",
			DisplayName:  "WorkBuddy",
			Type:         domain.AgentWorkBuddy,
			Enabled:      true,
			Command:      "workbuddy",
			Args:         []string{},
			Strengths:    []string{"feature", "fullstack", "workflow"},
			CostTier:     "medium",
			TimeoutSec:   900,
			EnvAllowlist: []string{"WORKBUDDY_API_KEY", "OPENAI_API_KEY"},
			PromptMode:   "stdin",
			OutputMode:   "text",
		},
		{
			ID:           "codebuddy",
			DisplayName:  "CodeBuddy",
			Type:         domain.AgentCodeBuddy,
			Enabled:      true,
			Command:      "codebuddy",
			Args:         []string{},
			Strengths:    []string{"bug-fix", "feature", "code-review"},
			CostTier:     "medium",
			TimeoutSec:   900,
			EnvAllowlist: []string{"CODEBUDDY_API_KEY", "OPENAI_API_KEY"},
			PromptMode:   "stdin",
			OutputMode:   "text",
		},
	}
}

func DefaultDesktopConfig(dataDir string) domain.DragonFlowConfig {
	cfg := domain.DefaultConfig()
	cfg.Project.Name = "DragonFlow"
	cfg.Project.DataDir = dataDir
	cfg.Project.Mode = "demo"
	cfg.GitHub.PollIntervalSec = 15
	cfg.GitHub.Maintainers = []string{"dragon-maintainer"}
	cfg.GitHub.Repositories = []domain.RepoConfig{
		{
			Owner:        "dragonflow-org",
			Repo:         "awesome-oss",
			BaseBranch:   "main",
			Enabled:      true,
			TestCommand:  "builtin:demo-test",
			BuildCommand: "builtin:demo-build",
			LintCommand:  "builtin:demo-lint",
		},
	}
	cfg.GitHub.AutoMergeLowRisk = domain.AutoMergeLowRiskConfig{
		Enabled:           true,
		AllowedCategories: []string{"docs", "chore"},
		MaxComplexity:     2,
		MaxFilesChanged:   5,
		MergeMethod:       "squash",
	}
	cfg.Llm.CliFallbackAgentID = "claude"
	cfg.Agents = DefaultAgentPresets()
	cfg.Routing = domain.RoutingConfig{
		DefaultAgent:              "claude",
		DefaultReviewerAgent:      "codex",
		CrossReviewDifferentAgent: true,
		FallbackOrder: []string{
			"claude", "qodercli", "codex", "gemini",
			"opencode", "aider", "workbuddy", "codebuddy",
		},
		Rules: []domain.RoutingRule{
			{
				Name:     "demo-docs-chore-fast",
				Priority: 10,
				Match: domain.RoutingMatch{
					Categories:    []domain.IssueCategory{domain.CategoryDocs, domain.CategoryChore},
					ComplexityMax: ptrInt(2),
				},
				AgentID:        "gemini",
				FallbackAgents: []string{"opencode", "claude"},
				TierOverride:   ptrTier(domain.TierQuickFix),
			},
			{
				Name:     "demo-bugfix-codex",
				Priority: 20,
				Match: domain.RoutingMatch{
					Categories:    []domain.IssueCategory{domain.CategoryBug},
					ComplexityMax: ptrInt(2),
				},
				AgentID:        "codex",
				FallbackAgents: []string{"claude", "qodercli"},
				TierOverride:   ptrTier(domain.TierQuickFix),
			},
			{
				Name:     "demo-feature-refactor-full-sdlc",
				Priority: 30,
				Match: domain.RoutingMatch{
					Categories:    []domain.IssueCategory{domain.CategoryFeature, domain.CategoryRefactor},
					ComplexityMin: ptrInt(3),
				},
				AgentID:        "claude",
				FallbackAgents: []string{"qodercli", "codex"},
				TierOverride:   ptrTier(domain.TierFullSdlc),
			},
		},
	}
	cfg.Workflow.DefaultTestCommand = "builtin:demo-test"
	cfg.Workflow.DefaultBuildCommand = "builtin:demo-build"
	cfg.Workflow.DefaultLintCommand = "builtin:demo-lint"
	cfg.Workspace.ReposRoot = filepath.Join(dataDir, "repos")
	cfg.Workspace.WorktreeRoot = filepath.Join(dataDir, "worktrees")
	cfg.Notifications.Channels = []domain.NotificationChannelConfig{
		{
			ID:        "feishu-default",
			Type:      "feishu",
			Enabled:   false,
			URLEnv:    "FEISHU_WEBHOOK_URL",
			SecretEnv: "FEISHU_WEBHOOK_SECRET",
			Events:    domain.DefaultNotifyEvents(),
		},
		{
			ID:      "slack-default",
			Type:    "slack",
			Enabled: false,
			URLEnv:  "SLACK_WEBHOOK_URL",
			Events:  domain.DefaultNotifyEvents(),
		},
	}
	return cfg
}
