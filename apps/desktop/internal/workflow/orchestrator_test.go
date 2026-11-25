package workflow

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/config"
	"github.com/dragonflow/desktop/internal/db"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/events"
	"github.com/dragonflow/desktop/internal/github"
	"github.com/dragonflow/desktop/internal/llm"
	"github.com/dragonflow/desktop/internal/notify"
	"github.com/dragonflow/desktop/internal/router"
	"github.com/dragonflow/desktop/internal/triage"
	"github.com/dragonflow/desktop/internal/workspace"
)

type testHarness struct {
	cfg      domain.DragonFlowConfig
	database *db.Database
	repo     *db.Repository
	gh       *github.InMemoryGitHubClient
	orch     *Orchestrator
}

func newTestHarness(t *testing.T, available []string, behaviors map[string]adapters.MockAgentBehavior, responder llm.MockResponder) *testHarness {
	t.Helper()
	tmp := t.TempDir()
	bareRepo, err := workspace.EnsureDemoBareGitRepo(context.Background(), tmp)
	if err != nil {
		t.Fatalf("EnsureDemoBareGitRepo failed: %v", err)
	}

	cfg := config.DefaultDesktopConfig(tmp)
	cfg.GitHub.AutoMergeLowRisk.Enabled = false
	cfg.GitHub.Repositories = []domain.RepoConfig{
		{
			Owner:       "acme",
			Repo:        "demo",
			BaseBranch:  "main",
			Enabled:     true,
			TestCommand: "builtin:demo-test",
		},
	}
	cfg.GitHub.Maintainers = []string{"maintainer"}
	cfg.Workflow.DefaultTestCommand = "builtin:demo-test"
	cfg.Workflow.DefaultBuildCommand = ""
	cfg.Workflow.DefaultLintCommand = ""
	cfg.Workspace.ReposRoot = filepath.Join(tmp, "repos")
	cfg.Workspace.WorktreeRoot = filepath.Join(tmp, "worktrees")
	cfg.Workspace.LocalRepoUrlOverride = bareRepo

	database, err := db.OpenDatabase(":memory:")
	if err != nil {
		t.Fatalf("OpenDatabase failed: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	bus := events.NewEventBus()
	repo := db.NewRepository(database.SQL, bus)
	gh := github.NewInMemoryGitHubClient(bareRepo)

	availSet := make(map[string]bool)
	for _, id := range available {
		availSet[id] = true
	}

	reg := adapters.NewRegistry(config.DefaultAgentPresets(), bus, func(p domain.AgentProfile) adapters.CodingAgentAdapter {
		if behaviors != nil {
			if b, ok := behaviors[p.ID]; ok {
				return adapters.NewMockCodingAgentAdapter(p, availSet[p.ID], b)
			}
		}
		return adapters.NewMockCodingAgentAdapter(p, availSet[p.ID], func(ctx adapters.AgentExecContext) adapters.AgentExecResult {
			if ctx.Cwd != "" {
				_ = os.WriteFile(filepath.Join(ctx.Cwd, "src", "sum.txt"), []byte("// FIXED by "+p.ID+"\nsum(a, b) => Number(a) + Number(b)\n"), 0o644)
			}
			return adapters.AgentExecResult{Success: true, OutputText: "Applied clean fix with " + p.ID, TokensUsed: 500, CostUsd: 0.01}
		})
	})
	reg.ProbeAll(context.Background())

	llmClient := llm.NewMockStructuredClient(responder)
	triSvc := triage.NewIssueTriageService(llmClient, cfg.Workflow.QuickFixMaxComplexity)
	rtr := router.NewAgentRouter(cfg, reg, llmClient)

	var ws workspace.WorkspaceRunner
	if bareRepo != "" {
		ws = workspace.NewGitWorktreeRunner(cfg.Workspace.ReposRoot, cfg.Workspace.WorktreeRoot)
	} else {
		ws = workspace.NewLocalDemoWorkspaceRunner(cfg.Workspace.WorktreeRoot)
	}

	disp := notify.NewDispatcher(nil, nil, nil)
	orch := NewOrchestrator(OrchestratorDeps{
		Config:        cfg,
		Repo:          repo,
		GitHub:        gh,
		TriageService: triSvc,
		Router:        rtr,
		LLM:           llmClient,
		Registry:      reg,
		Workspace:     ws,
		Notifier:      disp,
		EventBus:      bus,
	})
	t.Cleanup(func() { orch.WaitForIdle() })

	return &testHarness{cfg: cfg, database: database, repo: repo, gh: gh, orch: orch}
}

func TestOrchestratorEndToEndScenarios(t *testing.T) {
	ctx := context.Background()

	t.Run("Scenario1_ExternalIssueWaitAndQuickFix", func(t *testing.T) {
		h := newTestHarness(t, []string{"claude", "qodercli", "codex"}, nil, nil)
		issue := h.gh.SeedIssue(github.SeedIssueInput{
			Number:            1,
			Title:             "Fix typo in math add input coercion",
			Body:              "Calling add('1', 2) should coerce numbers cleanly instead of concatenation.",
			Author:            "external-user",
			AuthorAssociation: "NONE",
		})
		t1, err := h.orch.IngestIssue(ctx, "acme/demo", issue)
		if err != nil || t1.Status != domain.StatusAwaitingTrigger {
			t.Fatalf("expected AWAITING_TRIGGER, got %+v err=%v", t1.Status, err)
		}

		issue.Labels = append(issue.Labels, "auto-dev")
		t2, err := h.orch.IngestIssueWithOptions(ctx, "acme/demo", issue, IngestOptions{AwaitCompletion: true})
		if err != nil || t2.Status != domain.StatusPrOpen || t2.PrNumber == nil {
			t.Fatalf("expected PR_OPEN, got status=%s lastErr=%v err=%v", t2.Status, t2.LastError, err)
		}
		if t2.AssignedAgent == nil || t2.ReviewerAgent == nil || *t2.AssignedAgent == *t2.ReviewerAgent {
			t.Fatalf("expected distinct author and reviewer, got %v vs %v", t2.AssignedAgent, t2.ReviewerAgent)
		}
	})

	t.Run("Scenario2_FullSDLCPlanGateAndSelfHeal", func(t *testing.T) {
		implAttempt := 0
		reviewCalls := 0
		h := newTestHarness(t, []string{"claude", "qodercli", "codex"}, map[string]adapters.MockAgentBehavior{
			"claude": func(execCtx adapters.AgentExecContext) adapters.AgentExecResult {
				implAttempt++
				if implAttempt == 1 {
					// Broken content causes builtin:demo-test to fail and self-heal on attempt 2
					_ = os.WriteFile(filepath.Join(execCtx.Cwd, "src", "sum.txt"), []byte("// broken\nsum(a,b) => 999\n"), 0o644)
					return adapters.AgentExecResult{Success: true, OutputText: "Attempt 1"}
				}
				_ = os.WriteFile(filepath.Join(execCtx.Cwd, "src", "sum.txt"), []byte("// FIXED\nsum(a, b) => Number(a) + Number(b)\n"), 0o644)
				return adapters.AgentExecResult{Success: true, OutputText: "Attempt 2 fixed"}
			},
		}, func(stage, prompt string) any {
			switch stage {
			case "triage":
				return map[string]any{
					"category": "feature", "isDuplicate": false, "needsMoreInfo": false,
					"clarifyingQuestions": []string{}, "suggestedLabels": []string{"enhancement"},
					"estimatedComplexity": 4, "recommendedTier": "full_sdlc",
					"summary": "OAuth architecture feature", "riskFlags": []string{},
				}
			case "routing":
				return map[string]any{"primaryAgent": "claude", "rationale": "Complex feature", "recommendedTier": "full_sdlc"}
			case "spec":
				return map[string]any{"problemStatement": "Add OAuth", "acceptanceCriteria": []string{"Pass tests"}, "nonGoals": []string{}, "affectedAreas": []string{"src/"}}
			case "plan":
				arch := "Initial design"
				if strings.Contains(prompt, "Add caching") {
					arch = "Revised architecture with caching layer"
				}
				return map[string]any{"architectureSummary": arch, "filesToModify": []string{"src/sum.txt"}, "implementationSteps": []string{"Code", "Test"}, "testPlan": []string{"builtin:demo-test"}, "risksAndMitigations": []string{}}
			case "cross_review":
				reviewCalls++
				if reviewCalls == 1 {
					return map[string]any{"approved": false, "summary": "Add comment", "findings": []map[string]any{{"severity": "major", "message": "Add doc"}}, "checklist": map[string]any{"acceptanceCriteriaMet": true, "testsAdequate": true, "noObviousSecurityRisks": true, "cleanScope": false}}
				}
				return map[string]any{"approved": true, "summary": "LGTM", "findings": []any{}, "checklist": map[string]any{"acceptanceCriteriaMet": true, "testsAdequate": true, "noObviousSecurityRisks": true, "cleanScope": true}}
			}
			return map[string]any{}
		})

		issue := h.gh.SeedIssue(github.SeedIssueInput{
			Number:            2,
			Title:             "Implement OAuth2 plugin architecture",
			Body:              "Full feature request with token refresh and session storage.",
			Author:            "maintainer",
			AuthorAssociation: "OWNER",
		})
		paused, err := h.orch.IngestIssueWithOptions(ctx, "acme/demo", issue, IngestOptions{AwaitCompletion: true})
		if err != nil || paused.Status != domain.StatusAwaitingPlanApproval {
			t.Fatalf("expected AWAITING_PLAN_APPROVAL, got %s err=%v", paused.Status, err)
		}

		rej := h.gh.SeedComment(2, "/reject Add caching support", "maintainer", "OWNER")
		revised, err := h.orch.HandleCommentWithOptions(ctx, "acme/demo", 2, rej, true)
		if err != nil || revised.Status != domain.StatusAwaitingPlanApproval {
			t.Fatalf("expected AWAITING_PLAN_APPROVAL after reject, got %+v err=%v", revised, err)
		}
		planArt, _ := h.repo.GetLatestArtifact(paused.ID, domain.ArtifactPlan)
		if planArt == nil || !strings.Contains(planArt.Content, "caching layer") {
			t.Fatalf("expected revised plan artifact")
		}

		app := h.gh.SeedComment(2, "/approve", "maintainer", "OWNER")
		fin, err := h.orch.HandleCommentWithOptions(ctx, "acme/demo", 2, app, true)
		if err != nil || fin.Status != domain.StatusPrOpen || fin.LocalFixRetries != 1 || fin.CrossReviewRetries != 1 {
			t.Fatalf("expected PR_OPEN with 1 local & 1 CR retry, got %+v err=%v", fin, err)
		}
	})

	t.Run("Scenario3_QuotaExceededAutoFallback", func(t *testing.T) {
		h := newTestHarness(t, []string{"claude", "qodercli", "codex"}, map[string]adapters.MockAgentBehavior{
			"codex": func(_ adapters.AgentExecContext) adapters.AgentExecResult {
				return adapters.AgentExecResult{Success: false, ErrorKind: domain.ErrKindQuotaExceeded, RawStderr: "insufficient_quota"}
			},
			"qodercli": func(_ adapters.AgentExecContext) adapters.AgentExecResult {
				return adapters.AgentExecResult{Success: false, ErrorKind: domain.ErrKindQuotaExceeded, RawStderr: "insufficient_quota"}
			},
		}, nil)
		issue := h.gh.SeedIssue(github.SeedIssueInput{
			Number:            3,
			Title:             "Fix null check bug",
			Body:              "Localized bug fix with clear repro steps in parser.",
			Author:            "maintainer",
			AuthorAssociation: "OWNER",
		})
		res, err := h.orch.IngestIssueWithOptions(ctx, "acme/demo", issue, IngestOptions{AwaitCompletion: true})
		if err != nil || res.Status != domain.StatusPrOpen || res.FallbackCount == 0 || res.AssignedAgent == nil || *res.AssignedAgent != "claude" {
			t.Fatalf("expected fallback to claude & PR_OPEN, got status=%s fb=%d agent=%v err=%v", res.Status, res.FallbackCount, res.AssignedAgent, err)
		}
	})

	t.Run("Scenario4_CIFailHealAndReleaseLifecycle", func(t *testing.T) {
		h := newTestHarness(t, []string{"claude", "qodercli", "codex"}, nil, nil)
		issue := h.gh.SeedIssue(github.SeedIssueInput{
			Number:            4,
			Title:             "Fix typo in README",
			Body:              "Minor documentation typo correction with full description.",
			Author:            "maintainer",
			AuthorAssociation: "OWNER",
		})
		opened, err := h.orch.IngestIssueWithOptions(ctx, "acme/demo", issue, IngestOptions{AwaitCompletion: true})
		if err != nil || opened.Status != domain.StatusPrOpen || opened.PrNumber == nil {
			t.Fatalf("expected PR_OPEN, got %+v err=%v", opened, err)
		}
		prNum := *opened.PrNumber

		// Remote CI fails -> heals back to PR_OPEN
		h.gh.SetPrCheckRuns(prNum, []domain.GitHubCheckRun{{ID: 1, Name: "ci / test", Status: "completed", Conclusion: "failure", OutputTitle: "Lint error"}})
		_, _ = h.orch.PollOpenPrs(ctx, "acme/demo")
		task, _ := h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusPrOpen || task.CiFixRetries != 1 {
			t.Fatalf("expected PR_OPEN with ciFixRetries=1, got %s (%d)", task.Status, task.CiFixRetries)
		}

		// CI passes + review requests changes -> heals -> CI green -> READY_TO_MERGE
		h.gh.SetPrCheckRuns(prNum, []domain.GitHubCheckRun{{ID: 1, Name: "ci / test", Status: "completed", Conclusion: "success"}})
		h.gh.SeedPrReview(prNum, "maintainer", "OWNER", "CHANGES_REQUESTED", "Rename variable")
		_, _ = h.orch.PollOpenPrs(ctx, "acme/demo")
		task, _ = h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusPrOpen || task.ReviewFixRetries != 1 {
			t.Fatalf("expected PR_OPEN with reviewFixRetries=1, got %s (%d)", task.Status, task.ReviewFixRetries)
		}

		_, _ = h.orch.PollOpenPrs(ctx, "acme/demo")
		task, _ = h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusReadyToMerge {
			t.Fatalf("expected READY_TO_MERGE, got %s", task.Status)
		}

		mergeCmd := h.gh.SeedComment(4, "/merge", "maintainer", "OWNER")
		_, _ = h.orch.HandleCommentWithOptions(ctx, "acme/demo", 4, mergeCmd, true)
		task, _ = h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusMerged {
			t.Fatalf("expected MERGED, got %s", task.Status)
		}

		relPR := h.gh.SeedReleasePr("chore(main): release 0.2.0", "release-please--branches--main")
		_, _ = h.orch.PollOpenPrs(ctx, "acme/demo")
		task, _ = h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusReleasePrOpen || task.ReleasePrNumber == nil || *task.ReleasePrNumber != relPR.Number {
			t.Fatalf("expected RELEASE_PR_OPEN, got %s", task.Status)
		}

		h.gh.SeedRelease("v0.2.0", "Release 0.2.0")
		_, _ = h.orch.PollOpenPrs(ctx, "acme/demo")
		task, _ = h.repo.GetTask(opened.ID)
		if task.Status != domain.StatusReleased || task.ReleaseTag == nil || *task.ReleaseTag != "v0.2.0" {
			t.Fatalf("expected RELEASED v0.2.0, got %s", task.Status)
		}
	})

	t.Run("Scenario5_EscalateNeedsHumanWhenExhausted", func(t *testing.T) {
		h := newTestHarness(t, []string{"claude"}, map[string]adapters.MockAgentBehavior{
			"claude": func(_ adapters.AgentExecContext) adapters.AgentExecResult {
				return adapters.AgentExecResult{Success: false, ErrorKind: domain.ErrKindQuotaExceeded, RawStderr: "credit balance is too low"}
			},
		}, nil)
		issue := h.gh.SeedIssue(github.SeedIssueInput{
			Number:            5,
			Title:             "Fix build failure",
			Body:              "Consistent failure in build step on Windows.",
			Author:            "maintainer",
			AuthorAssociation: "OWNER",
		})
		res, err := h.orch.IngestIssueWithOptions(ctx, "acme/demo", issue, IngestOptions{AwaitCompletion: true})
		if err != nil || res.Status != domain.StatusNeedsHuman {
			t.Fatalf("expected NEEDS_HUMAN, got %s err=%v", res.Status, err)
		}
	})
}
