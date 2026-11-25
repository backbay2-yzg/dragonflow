package router

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/llm"
)

type llmRouterResponse struct {
	PrimaryAgent    string               `json:"primaryAgent"`
	Rationale       string               `json:"rationale"`
	RecommendedTier *domain.WorkflowTier `json:"recommendedTier,omitempty"`
}

type AgentRouter struct {
	cfg      domain.DragonFlowConfig
	registry *adapters.Registry
	llm      llm.Client
}

func NewAgentRouter(cfg domain.DragonFlowConfig, registry *adapters.Registry, llmClient llm.Client) *AgentRouter {
	return &AgentRouter{
		cfg:      cfg,
		registry: registry,
		llm:      llmClient,
	}
}

func (r *AgentRouter) Route(
	ctx context.Context,
	issue domain.GitHubIssue,
	triage domain.TriageResult,
	manualOverrideAgentID string,
	repoSummary string,
	onLog func(stream, message string),
) (domain.RoutingDecision, int, float64, error) {
	available := r.registry.GetAvailableAgents()
	if len(available) == 0 {
		return domain.RoutingDecision{}, 0, 0, fmt.Errorf("No Coding Agent CLIs are currently enabled and available. Run agent probe or configure at least one agent.")
	}

	availableIDs := make(map[string]bool, len(available))
	availNames := make([]string, 0, len(available))
	for _, a := range available {
		availableIDs[a.ID] = true
		availNames = append(availNames, a.ID)
	}

	defaultTier := domain.TierFullSdlc
	if triage.EstimatedComplexity <= r.cfg.Workflow.QuickFixMaxComplexity {
		defaultTier = domain.TierQuickFix
	}

	// Tier 1: Manual override
	if manualOverrideAgentID != "" {
		if !availableIDs[manualOverrideAgentID] {
			return domain.RoutingDecision{}, 0, 0, fmt.Errorf("Requested agent %q is not available. Available agents: %s", manualOverrideAgentID, strings.Join(availNames, ", "))
		}
		return domain.RoutingDecision{
			Tier:            defaultTier,
			ComplexityScore: triage.EstimatedComplexity,
			PrimaryAgent:    manualOverrideAgentID,
			ReviewerAgent:   r.pickReviewer(manualOverrideAgentID, available, availableIDs),
			FallbackAgents:  r.buildFallbackChain(manualOverrideAgentID, available, availableIDs, nil),
			Rationale:       fmt.Sprintf("维护者显式指定使用 Agent %q 执行任务。", manualOverrideAgentID),
			SelectedBy:      "manual",
		}, 0, 0, nil
	}

	// Tier 2: Static routing rules (lowest priority number wins)
	sortedRules := append([]domain.RoutingRule{}, r.cfg.Routing.Rules...)
	sort.SliceStable(sortedRules, func(i, j int) bool {
		return sortedRules[i].Priority < sortedRules[j].Priority
	})
	for _, rule := range sortedRules {
		if !matchesRule(rule, issue, triage) {
			continue
		}
		candidates := append([]string{rule.AgentID}, rule.FallbackAgents...)
		chosen := ""
		for _, id := range candidates {
			if availableIDs[id] {
				chosen = id
				break
			}
		}
		if chosen == "" {
			continue
		}
		tier := defaultTier
		if rule.TierOverride != nil {
			tier = *rule.TierOverride
		}
		return domain.RoutingDecision{
			Tier:            tier,
			ComplexityScore: triage.EstimatedComplexity,
			PrimaryAgent:    chosen,
			ReviewerAgent:   r.pickReviewer(chosen, available, availableIDs),
			FallbackAgents:  r.buildFallbackChain(chosen, available, availableIDs, rule.FallbackAgents),
			Rationale:       fmt.Sprintf("命中静态路由规则 %q（priority=%d），选择 %q。", rule.Name, rule.Priority, chosen),
			SelectedBy:      "rule",
			MatchedRuleName: rule.Name,
		}, 0, 0, nil
	}

	// Tier 3: Router LLM capability matching
	if r.llm != nil {
		if repoSummary == "" {
			repoSummary = "Open-source repository managed by DragonFlow"
		}
		agentDescs := make([]map[string]any, 0, len(available))
		for _, a := range available {
			agentDescs = append(agentDescs, map[string]any{
				"id":          a.ID,
				"displayName": a.DisplayName,
				"costTier":    a.CostTier,
				"strengths":   a.Strengths,
			})
		}
		userPayload := map[string]any{
			"issue": map[string]any{
				"number": issue.Number,
				"title":  issue.Title,
				"labels": issue.Labels,
			},
			"triage":          triage,
			"repoSummary":     repoSummary,
			"availableAgents": agentDescs,
		}
		userBytes, _ := json.MarshalIndent(userPayload, "", "  ")
		systemPrompt := strings.Join([]string{
			"You are the DragonFlow Agent Router.",
			"Select the best available coding agent based on task category, complexity (1..5), and each agent profile (strengths, costTier).",
			"You MUST choose primaryAgent strictly from the provided available agent IDs.",
			"Return JSON: { primaryAgent, rationale, recommendedTier }.",
		}, "\n")

		llmRes, err := llm.CompleteJSON(ctx, r.llm, llm.StructuredRequest{
			Stage:        "routing",
			SystemPrompt: systemPrompt,
			UserPrompt:   string(userBytes),
			OnLog:        onLog,
		}, func(res *llmRouterResponse) error {
			if strings.TrimSpace(res.PrimaryAgent) == "" || strings.TrimSpace(res.Rationale) == "" {
				return fmt.Errorf("primaryAgent and rationale required")
			}
			return nil
		})
		if err == nil && availableIDs[llmRes.Data.PrimaryAgent] {
			primary := llmRes.Data.PrimaryAgent
			tier := defaultTier
			if llmRes.Data.RecommendedTier != nil {
				tier = *llmRes.Data.RecommendedTier
			}
			return domain.RoutingDecision{
				Tier:            tier,
				ComplexityScore: triage.EstimatedComplexity,
				PrimaryAgent:    primary,
				ReviewerAgent:   r.pickReviewer(primary, available, availableIDs),
				FallbackAgents:  r.buildFallbackChain(primary, available, availableIDs, nil),
				Rationale:       llmRes.Data.Rationale,
				SelectedBy:      "llm",
			}, llmRes.Tokens, llmRes.CostUsd, nil
		}
		if err != nil && onLog != nil {
			onLog("system", fmt.Sprintf("[Router] LLM routing failed (%s), using default fallback order.", err.Error()))
		}
	}

	// Deterministic fallback
	defaultCandidate := ""
	if availableIDs[r.cfg.Routing.DefaultAgent] {
		defaultCandidate = r.cfg.Routing.DefaultAgent
	} else {
		for _, id := range r.cfg.Routing.FallbackOrder {
			if availableIDs[id] {
				defaultCandidate = id
				break
			}
		}
		if defaultCandidate == "" {
			defaultCandidate = available[0].ID
		}
	}

	return domain.RoutingDecision{
		Tier:            defaultTier,
		ComplexityScore: triage.EstimatedComplexity,
		PrimaryAgent:    defaultCandidate,
		ReviewerAgent:   r.pickReviewer(defaultCandidate, available, availableIDs),
		FallbackAgents:  r.buildFallbackChain(defaultCandidate, available, availableIDs, nil),
		Rationale:       fmt.Sprintf("采用默认回退策略选择可用 Agent %q。", defaultCandidate),
		SelectedBy:      "default_fallback",
	}, 0, 0, nil
}

func (r *AgentRouter) SelectNextFallback(triedAgents []string, plannedFallbacks []string) string {
	tried := make(map[string]bool, len(triedAgents))
	for _, id := range triedAgents {
		tried[id] = true
	}
	available := r.registry.GetAvailableAgents()
	availableIDs := make(map[string]bool, len(available))
	for _, a := range available {
		availableIDs[a.ID] = true
	}

	for _, id := range append(append([]string{}, plannedFallbacks...), r.cfg.Routing.FallbackOrder...) {
		if !tried[id] && availableIDs[id] {
			return id
		}
	}
	for _, a := range available {
		if !tried[a.ID] {
			return a.ID
		}
	}
	return ""
}

func matchesRule(rule domain.RoutingRule, issue domain.GitHubIssue, triage domain.TriageResult) bool {
	m := rule.Match
	if len(m.Categories) > 0 {
		matchedCat := false
		for _, cat := range m.Categories {
			if cat == triage.Category {
				matchedCat = true
				break
			}
		}
		if !matchedCat {
			return false
		}
	}
	if len(m.Labels) > 0 {
		lowerLabels := make(map[string]bool, len(issue.Labels))
		for _, l := range issue.Labels {
			lowerLabels[strings.ToLower(l)] = true
		}
		hasAny := false
		for _, target := range m.Labels {
			if lowerLabels[strings.ToLower(target)] {
				hasAny = true
				break
			}
		}
		if !hasAny {
			return false
		}
	}
	if m.TitleRegex != "" {
		re, err := regexp.Compile("(?i)" + m.TitleRegex)
		if err != nil || !re.MatchString(issue.Title) {
			return false
		}
	}
	if m.ComplexityMin != nil && triage.EstimatedComplexity < *m.ComplexityMin {
		return false
	}
	if m.ComplexityMax != nil && triage.EstimatedComplexity > *m.ComplexityMax {
		return false
	}
	return true
}

func (r *AgentRouter) buildFallbackChain(primaryAgent string, available []domain.AgentHealthInfo, availableIDs map[string]bool, ruleFallbacks []string) []string {
	ordered := make([]string, 0)
	seen := map[string]bool{primaryAgent: true}

	for _, id := range append(append([]string{}, ruleFallbacks...), r.cfg.Routing.FallbackOrder...) {
		if !seen[id] && availableIDs[id] {
			seen[id] = true
			ordered = append(ordered, id)
		}
	}
	for _, a := range available {
		if !seen[a.ID] {
			seen[a.ID] = true
			ordered = append(ordered, a.ID)
		}
	}
	return ordered
}

func (r *AgentRouter) pickReviewer(primaryAgent string, available []domain.AgentHealthInfo, availableIDs map[string]bool) string {
	preferred := r.cfg.Routing.DefaultReviewerAgent
	if preferred != "" && availableIDs[preferred] && (!r.cfg.Routing.CrossReviewDifferentAgent || preferred != primaryAgent) {
		return preferred
	}
	if r.cfg.Routing.CrossReviewDifferentAgent {
		for _, id := range r.cfg.Routing.FallbackOrder {
			if id != primaryAgent && availableIDs[id] {
				return id
			}
		}
		for _, a := range available {
			if a.ID != primaryAgent {
				return a.ID
			}
		}
	}
	return primaryAgent
}
