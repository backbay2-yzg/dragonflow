package router

import (
	"context"
	"testing"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/config"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/llm"
)

func TestThreeTierRouter(t *testing.T) {
	cfg, err := config.ParseYAML(`
routing:
  defaultAgent: claude
  crossReviewDifferentAgent: true
  fallbackOrder: [claude, qodercli, gemini, opencode]
  rules:
    - name: docs-rule
      priority: 10
      match:
        categories: [docs]
      agentId: gemini
      fallbackAgents: [opencode]
`)
	if err != nil {
		t.Fatalf("ParseYAML failed: %v", err)
	}

	avail := map[string]bool{"claude": true, "qodercli": true, "gemini": true}
	reg := adapters.NewRegistry(config.DefaultAgentPresets(), nil, func(p domain.AgentProfile) adapters.CodingAgentAdapter {
		return adapters.NewMockCodingAgentAdapter(p, avail[p.ID], nil)
	})
	reg.ProbeAll(context.Background())

	r := NewAgentRouter(cfg, reg, llm.NewMockStructuredClient(nil))
	issue := domain.GitHubIssue{Number: 7, Title: "Improve docs", Labels: []string{"documentation"}}
	tr := domain.TriageResult{Category: domain.CategoryDocs, EstimatedComplexity: 1, RecommendedTier: domain.TierQuickFix, Summary: "docs fix"}

	// 1. Manual override
	manual, _, _, err := r.Route(context.Background(), issue, tr, "qodercli", "", nil)
	if err != nil || manual.SelectedBy != "manual" || manual.PrimaryAgent != "qodercli" || manual.ReviewerAgent == "qodercli" {
		t.Fatalf("unexpected manual routing: %+v err=%v", manual, err)
	}

	// 2. Static rule
	ruleRes, _, _, err := r.Route(context.Background(), issue, tr, "", "", nil)
	if err != nil || ruleRes.SelectedBy != "rule" || ruleRes.PrimaryAgent != "gemini" || ruleRes.ReviewerAgent != "claude" {
		t.Fatalf("unexpected rule routing: %+v err=%v", ruleRes, err)
	}

	// 3. LLM routing
	featTriage := tr
	featTriage.Category = domain.CategoryFeature
	featTriage.EstimatedComplexity = 4
	featTriage.RecommendedTier = domain.TierFullSdlc
	llmRes, _, _, err := r.Route(context.Background(), domain.GitHubIssue{Number: 8, Title: "Add OAuth", Labels: []string{"enhancement"}}, featTriage, "", "", nil)
	if err != nil || llmRes.SelectedBy != "llm" || llmRes.PrimaryAgent != "claude" || llmRes.ReviewerAgent != "qodercli" {
		t.Fatalf("unexpected llm routing: %+v err=%v", llmRes, err)
	}

	// 4. Fallback chain
	if next := r.SelectNextFallback([]string{"claude"}, llmRes.FallbackAgents); next != "qodercli" {
		t.Fatalf("expected qodercli, got %q", next)
	}
	if next := r.SelectNextFallback([]string{"claude", "qodercli"}, llmRes.FallbackAgents); next != "gemini" {
		t.Fatalf("expected gemini, got %q", next)
	}
	if next := r.SelectNextFallback([]string{"claude", "qodercli", "gemini"}, llmRes.FallbackAgents); next != "" {
		t.Fatalf("expected empty fallback, got %q", next)
	}
}
