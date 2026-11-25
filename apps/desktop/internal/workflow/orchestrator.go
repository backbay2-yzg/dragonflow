package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/adapters"
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

type OrchestratorDeps struct {
	Config        domain.DragonFlowConfig
	Repo          *db.Repository
	GitHub        github.GitHubClient
	TriageService *triage.IssueTriageService
	Router        *router.AgentRouter
	LLM           llm.Client
	Registry      *adapters.Registry
	Workspace     workspace.WorkspaceRunner
	Notifier      *notify.Dispatcher
	EventBus      *events.EventBus
}

type IngestOptions struct {
	AwaitCompletion bool
	ManualAgentID   string
}

type Orchestrator struct {
	deps      OrchestratorDeps
	sem       chan struct{}
	locksMu   sync.Mutex
	taskLocks map[string]*sync.Mutex
	bgWg      sync.WaitGroup
	bgCtx     context.Context
	bgCancel  context.CancelFunc

	ciHookMu       sync.Mutex
	ciFailInjected map[string]bool
	unsubCIHook    func()
}

func NewOrchestrator(deps OrchestratorDeps) *Orchestrator {
	maxConc := deps.Config.Workflow.MaxConcurrentTasks
	if maxConc <= 0 {
		maxConc = 2
	}
	ctx, cancel := context.WithCancel(context.Background())
	o := &Orchestrator{
		deps:           deps,
		sem:            make(chan struct{}, maxConc),
		taskLocks:      make(map[string]*sync.Mutex),
		bgCtx:          ctx,
		bgCancel:       cancel,
		ciFailInjected: make(map[string]bool),
	}

	// Wire Demo [CIFailHeal] automatic check failure -> self-heal simulation
	if deps.Config.Project.Mode == "demo" && deps.EventBus != nil {
		if mockGH, ok := deps.GitHub.(*github.InMemoryGitHubClient); ok {
			o.unsubCIHook = deps.EventBus.Subscribe(func(ev domain.AppEvent) {
				if ev.Type != "task:transitioned" || ev.ToStatus == nil || *ev.ToStatus != domain.StatusPrOpen {
					return
				}
				task, err := o.deps.Repo.GetTask(ev.TaskID)
				if err != nil || task == nil || task.PrNumber == nil {
					return
				}
				o.ciHookMu.Lock()
				alreadyInjected := o.ciFailInjected[task.ID]
				if strings.Contains(task.IssueTitle, "[CIFailHeal]") && !alreadyInjected {
					o.ciFailInjected[task.ID] = true
					o.ciHookMu.Unlock()
					mockGH.SetPrCheckRuns(*task.PrNumber, []domain.GitHubCheckRun{
						{
							ID:            901,
							Name:          "ci / test & lint",
							Status:        "completed",
							Conclusion:    "failure",
							OutputTitle:   "Simulated CI failure",
							OutputSummary: "Demo preset injected initial CI check failure to trigger auto-heal.",
						},
					})
					o.scheduleBackground(func(ctx context.Context) {
						select {
						case <-time.After(750 * time.Millisecond):
						case <-ctx.Done():
							return
						}
						_, _ = o.PollOpenPrs(ctx, "")
					})
					return
				}
				o.ciHookMu.Unlock()

				if task.CiFixRetries > 0 {
					mockGH.SetPrCheckRuns(*task.PrNumber, []domain.GitHubCheckRun{
						{
							ID:            901,
							Name:          "ci / test & lint",
							Status:        "completed",
							Conclusion:    "success",
							OutputTitle:   "All checks passed",
							OutputSummary: "Auto-healed CI run succeeded.",
						},
					})
					o.scheduleBackground(func(ctx context.Context) {
						select {
						case <-time.After(750 * time.Millisecond):
						case <-ctx.Done():
							return
						}
						_, _ = o.PollOpenPrs(ctx, "")
					})
				}
			})
		}
	}

	return o
}

func (o *Orchestrator) WaitForIdle() {
	if o.unsubCIHook != nil {
		o.unsubCIHook()
		o.unsubCIHook = nil
	}
	o.bgCancel()
	o.bgWg.Wait()
}

func (o *Orchestrator) lockTask(taskID string) func() {
	o.locksMu.Lock()
	mu, ok := o.taskLocks[taskID]
	if !ok {
		mu = &sync.Mutex{}
		o.taskLocks[taskID] = mu
	}
	o.locksMu.Unlock()
	mu.Lock()
	return mu.Unlock
}

func (o *Orchestrator) scheduleBackground(fn func(ctx context.Context)) {
	o.bgWg.Add(1)
	go func() {
		defer o.bgWg.Done()
		fn(o.bgCtx)
	}()
}

func (o *Orchestrator) acquireSem(ctx context.Context) error {
	select {
	case o.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (o *Orchestrator) releaseSem() {
	<-o.sem
}

func (o *Orchestrator) splitRepo(repoFullName string) (owner, repo string, cfg *domain.RepoConfig) {
	parts := strings.SplitN(repoFullName, "/", 2)
	if len(parts) == 2 {
		owner, repo = parts[0], parts[1]
	} else {
		owner = repoFullName
	}
	for i := range o.deps.Config.GitHub.Repositories {
		r := &o.deps.Config.GitHub.Repositories[i]
		if strings.EqualFold(r.Owner+"/"+r.Repo, repoFullName) {
			cfg = r
			break
		}
	}
	return owner, repo, cfg
}

func (o *Orchestrator) emitNotification(ctx context.Context, ev domain.NotificationEventType, task domain.TaskRecord, summary string) {
	if o.deps.Notifier == nil {
		return
	}
	agentID := ""
	if task.AssignedAgent != nil {
		agentID = *task.AssignedAgent
	}
	prURL := ""
	if task.PrURL != nil {
		prURL = *task.PrURL
	}
	relURL := ""
	if task.ReleaseURL != nil {
		relURL = *task.ReleaseURL
	}
	o.deps.Notifier.Notify(ctx, notify.NotificationMessage{
		TaskID:       task.ID,
		Event:        ev,
		RepoFullName: task.RepoFullName,
		IssueNumber:  task.IssueNumber,
		Title:        task.IssueTitle,
		Summary:      summary,
		AgentID:      agentID,
		PrURL:        prURL,
		ReleaseURL:   relURL,
		IssueURL:     task.IssueURL,
	})
}

func (o *Orchestrator) IngestIssue(ctx context.Context, repoFullName string, issue domain.GitHubIssue) (domain.TaskRecord, error) {
	return o.IngestIssueWithOptions(ctx, repoFullName, issue, IngestOptions{})
}

func (o *Orchestrator) IngestIssueWithOptions(ctx context.Context, repoFullName string, issue domain.GitHubIssue, opts IngestOptions) (domain.TaskRecord, error) {
	task, created, err := o.deps.Repo.UpsertTaskFromIssue(repoFullName, issue)
	if err != nil {
		return domain.TaskRecord{}, err
	}

	hasTriggerLabel := false
	for _, l := range issue.Labels {
		if strings.EqualFold(l, o.deps.Config.GitHub.TriggerLabel) {
			hasTriggerLabel = true
			break
		}
	}

	if !created && task.Status != domain.StatusNew {
		if hasTriggerLabel && (task.Status == domain.StatusAwaitingInfo || task.Status == domain.StatusAwaitingTrigger) {
			return o.TriggerTask(ctx, task.ID, opts.ManualAgentID, "github:label", opts.AwaitCompletion)
		}
		return task, nil
	}

	unlock := o.lockTask(task.ID)
	startPipeline := false
	var outcomeTask domain.TaskRecord

	func() {
		defer unlock()
		current, err := o.deps.Repo.GetTask(task.ID)
		if err != nil || current == nil {
			outcomeTask = task
			return
		}
		if current.Status != domain.StatusNew {
			outcomeTask = *current
			return
		}

		_, _ = o.deps.Repo.TransitionTask(current.ID, domain.StatusTriaging, "dragonflow", "Running read-only triage", nil)
		owner, repo, _ := o.splitRepo(repoFullName)
		recent, _ := o.deps.GitHub.ListOpenIssues(ctx, owner, repo, "")
		triageRun, _ := o.deps.Repo.CreateRun(current.ID, "triage", "structured-llm", 1)

		trRes, tokens, cost, err := o.deps.TriageService.Triage(ctx, issue, recent, func(stream, msg string) {
			_, _ = o.deps.Repo.AppendLog(current.ID, triageRun.ID, stream, msg)
		})
		if err != nil {
			errMsg := err.Error()
			_, _ = o.deps.Repo.FinishRun(triageRun.ID, db.FinishRunResult{
				Status:    "failed",
				ErrorKind: domain.ErrKindRuntimeError,
				Summary:   &errMsg,
			})
			failed, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusNeedsHuman, "dragonflow", "Triage failed: "+errMsg, &db.TaskPatch{
				LastError: &errMsg,
			})
			o.syncStatusCard(ctx, failed, nil)
			o.emitNotification(ctx, domain.NotifyNeedsHuman, failed, "分诊失败："+errMsg)
			outcomeTask = failed
			return
		}

		_, _ = o.deps.Repo.FinishRun(triageRun.ID, db.FinishRunResult{
			Status:     "succeeded",
			ErrorKind:  domain.ErrKindNone,
			TokensUsed: tokens,
			CostUsd:    cost,
			Summary:    &trRes.Summary,
		})

		dupStr := "否"
		if trRes.IsDuplicate {
			dupNum := "unknown"
			if trRes.DuplicateOf != nil {
				dupNum = fmt.Sprintf("%d", *trRes.DuplicateOf)
			}
			dupStr = fmt.Sprintf("是 (#%s)", dupNum)
		}
		infoStr := "完整"
		if trRes.NeedsMoreInfo {
			infoStr = "待补充"
		}
		extraQuestions := ""
		if len(trRes.ClarifyingQuestions) > 0 {
			var qlines []string
			for _, q := range trRes.ClarifyingQuestions {
				qlines = append(qlines, "- "+q)
			}
			extraQuestions = "\n### 需补充信息\n" + strings.Join(qlines, "\n")
		}
		triageMD := strings.Join([]string{
			"## 分诊结果",
			fmt.Sprintf("- **分类**: `%s`", trRes.Category),
			fmt.Sprintf("- **复杂度**: %d/5", trRes.EstimatedComplexity),
			fmt.Sprintf("- **推荐流程**: `%s`", trRes.RecommendedTier),
			fmt.Sprintf("- **重复 Issue**: %s", dupStr),
			fmt.Sprintf("- **信息是否完整**: %s", infoStr),
			"",
			"### 摘要",
			trRes.Summary + extraQuestions,
		}, "\n")

		metaMap := toStringMap(trRes)
		_, _ = o.deps.Repo.SaveArtifact(current.ID, domain.ArtifactTriage, fmt.Sprintf("Issue #%d 自动分诊报告", issue.Number), triageMD, metaMap)
		_, _ = o.deps.Repo.UpdateTask(current.ID, db.TaskPatch{
			Category:        &trRes.Category,
			ComplexityScore: &trRes.EstimatedComplexity,
			Tier:            &trRes.RecommendedTier,
		})

		if len(trRes.SuggestedLabels) > 0 {
			_ = o.deps.GitHub.AddLabels(ctx, owner, repo, issue.Number, trRes.SuggestedLabels)
		}

		ownerFastTrack := o.deps.Config.GitHub.OwnerFastTrack &&
			strings.EqualFold(issue.AuthorAssociation, "OWNER") &&
			trRes.Category != domain.CategorySpam &&
			trRes.Category != domain.CategoryQuestion &&
			trRes.Category != domain.CategoryDuplicate

		if trRes.NeedsMoreInfo && !hasTriggerLabel && !ownerFastTrack {
			updated, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusAwaitingInfo, "dragonflow", "Issue needs clarification before automation", nil)
			o.syncStatusCard(ctx, updated, &trRes)
			o.emitNotification(ctx, domain.NotifyTriageCompleted, updated, "分诊完成：等待提问者补充信息")
			outcomeTask = updated
			return
		}

		if hasTriggerLabel || ownerFastTrack {
			reason := "Admitted via owner fast-track"
			if hasTriggerLabel {
				reason = fmt.Sprintf("Admitted via %q label", o.deps.Config.GitHub.TriggerLabel)
			}
			routed, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusRouting, "dragonflow", reason, nil)
			outcomeTask = routed
			startPipeline = true
			return
		}

		awaiting, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusAwaitingTrigger, "dragonflow", fmt.Sprintf("Awaiting %q label or /auto command", o.deps.Config.GitHub.TriggerLabel), nil)
		o.syncStatusCard(ctx, awaiting, &trRes)
		o.emitNotification(ctx, domain.NotifyTriageCompleted, awaiting, "分诊完成：等待维护者打标签或 /auto 放行")
		outcomeTask = awaiting
	}()

	if startPipeline {
		if opts.AwaitCompletion {
			o.runRoutingAndExecution(ctx, outcomeTask.ID, opts.ManualAgentID)
			if refreshed, err := o.deps.Repo.GetTask(outcomeTask.ID); err == nil && refreshed != nil {
				return *refreshed, nil
			}
		} else {
			tid := outcomeTask.ID
			manual := opts.ManualAgentID
			o.scheduleBackground(func(bgCtx context.Context) {
				o.runRoutingAndExecution(bgCtx, tid, manual)
			})
		}
	}
	return outcomeTask, nil
}

func (o *Orchestrator) HandleComment(ctx context.Context, repoFullName string, issueNumber int, comment domain.GitHubComment) (*domain.TaskRecord, error) {
	return o.HandleCommentWithOptions(ctx, repoFullName, issueNumber, comment, false)
}

func (o *Orchestrator) HandleCommentWithOptions(ctx context.Context, repoFullName string, issueNumber int, comment domain.GitHubComment, awaitCompletion bool) (*domain.TaskRecord, error) {
	task, err := o.deps.Repo.GetTaskByRepoIssue(repoFullName, issueNumber)
	if err != nil || task == nil {
		return nil, err
	}
	if comment.ID <= task.LastProcessedCommentID {
		return task, nil
	}
	if strings.Contains(comment.Body, "dragonflow:status-card") {
		updated, err := o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{LastProcessedCommentID: &comment.ID})
		return &updated, err
	}

	_, _ = o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{LastProcessedCommentID: &comment.ID})
	parsed := github.ParseMaintainerCommand(comment.Body, comment.Author, comment.ID)
	if parsed == nil {
		if task.Status == domain.StatusAwaitingInfo && strings.EqualFold(comment.Author, task.IssueAuthor) {
			newBody := task.IssueBody + "\n\n---\nAuthor Supplement:\n" + comment.Body
			updated, _ := o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{IssueBody: &newBody})
			_, _ = o.deps.Repo.TransitionTask(updated.ID, domain.StatusTriaging, comment.Author, "Author provided info", nil)
			reRes, _, _, err := o.deps.TriageService.Triage(ctx, domain.GitHubIssue{
				Number:            updated.IssueNumber,
				Title:             updated.IssueTitle,
				Body:              updated.IssueBody,
				Author:            updated.IssueAuthor,
				AuthorAssociation: "NONE",
				Labels:            updated.Labels,
				State:             "open",
				URL:               updated.IssueURL,
				CreatedAt:         updated.CreatedAt,
				UpdatedAt:         updated.UpdatedAt,
			}, nil, nil)
			if err != nil {
				return &updated, err
			}
			if !reRes.NeedsMoreInfo {
				awaiting, _ := o.deps.Repo.TransitionTask(updated.ID, domain.StatusAwaitingTrigger, "dragonflow", "Supplemented info is sufficient; awaiting maintainer trigger", nil)
				o.syncStatusCard(ctx, awaiting, &reRes)
				return &awaiting, nil
			}
			still, _ := o.deps.Repo.TransitionTask(updated.ID, domain.StatusAwaitingInfo, "dragonflow", "Still missing details after supplement", nil)
			o.syncStatusCard(ctx, still, &reRes)
			return &still, nil
		}
		return task, nil
	}

	if !github.IsMaintainer(comment.Author, comment.AuthorAssociation, o.deps.Config) {
		return task, nil
	}

	switch parsed.Command {
	case domain.CmdAuto:
		res, err := o.TriggerTask(ctx, task.ID, parsed.Arg, comment.Author, awaitCompletion)
		return &res, err
	case domain.CmdApprove:
		res, err := o.ApprovePlan(ctx, task.ID, comment.Author, awaitCompletion)
		return &res, err
	case domain.CmdReject:
		fb := parsed.Arg
		if fb == "" {
			fb = "请根据 Issue 需求重新优化实现方案与边界处理。"
		}
		res, err := o.RejectPlan(ctx, task.ID, fb, comment.Author)
		return &res, err
	case domain.CmdRetry:
		res, err := o.RetryTask(ctx, task.ID, parsed.Arg, comment.Author, awaitCompletion)
		return &res, err
	case domain.CmdFix:
		fb := parsed.Arg
		if fb == "" {
			fb = "请根据最新评论检查并修复 PR 问题。"
		}
		res, err := o.RequestManualFix(ctx, task.ID, fb, comment.Author, awaitCompletion)
		return &res, err
	case domain.CmdMerge:
		res, err := o.MergeTaskPr(ctx, task.ID, comment.Author)
		return &res, err
	case domain.CmdCancel:
		res, err := o.CancelTask(ctx, task.ID, comment.Author)
		return &res, err
	default:
		return task, nil
	}
}

func (o *Orchestrator) TriggerTask(ctx context.Context, taskID, manualAgentID, actor string, awaitCompletion bool) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "dashboard"
	}
	unlock := o.lockTask(taskID)
	var updated domain.TaskRecord
	var err error
	func() {
		defer unlock()
		current, gerr := o.deps.Repo.GetTask(taskID)
		if gerr != nil {
			err = gerr
			return
		}
		if current == nil {
			err = fmt.Errorf("Task not found: %s", taskID)
			return
		}
		if domain.IsTerminalStatus(current.Status) {
			err = fmt.Errorf("Cannot trigger task in terminal status: %s", current.Status)
			return
		}
		switch current.Status {
		case domain.StatusNew, domain.StatusAwaitingInfo, domain.StatusAwaitingTrigger, domain.StatusNeedsHuman, domain.StatusFailed:
			reason := "Triggered for execution"
			if manualAgentID != "" {
				reason = fmt.Sprintf("Triggered with explicit agent %q", manualAgentID)
			}
			updated, err = o.deps.Repo.TransitionTask(current.ID, domain.StatusRouting, actor, reason, &db.TaskPatch{ClearLastError: true})
		default:
			updated = *current
		}
	}()
	if err != nil {
		return domain.TaskRecord{}, err
	}

	if updated.Status == domain.StatusRouting {
		if awaitCompletion {
			o.runRoutingAndExecution(ctx, updated.ID, manualAgentID)
		} else {
			o.scheduleBackground(func(bgCtx context.Context) {
				o.runRoutingAndExecution(bgCtx, updated.ID, manualAgentID)
			})
		}
	}
	refreshed, err := o.deps.Repo.GetTask(updated.ID)
	if err != nil || refreshed == nil {
		return updated, err
	}
	return *refreshed, nil
}

func (o *Orchestrator) ApprovePlan(ctx context.Context, taskID, actor string, awaitCompletion bool) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "maintainer"
	}
	unlock := o.lockTask(taskID)
	var updated domain.TaskRecord
	var err error
	func() {
		defer unlock()
		current, gerr := o.deps.Repo.GetTask(taskID)
		if gerr != nil {
			err = gerr
			return
		}
		if current == nil {
			err = fmt.Errorf("Task not found: %s", taskID)
			return
		}
		if current.Status != domain.StatusAwaitingPlanApproval {
			err = fmt.Errorf("Task is in status %s, expected AWAITING_PLAN_APPROVAL", current.Status)
			return
		}
		updated, err = o.deps.Repo.TransitionTask(current.ID, domain.StatusImplementing, actor, "Plan approved; starting implementation", nil)
	}()
	if err != nil {
		return domain.TaskRecord{}, err
	}

	if awaitCompletion {
		o.runImplementationToPr(ctx, updated.ID)
	} else {
		o.scheduleBackground(func(bgCtx context.Context) {
			o.runImplementationToPr(bgCtx, updated.ID)
		})
	}
	refreshed, err := o.deps.Repo.GetTask(updated.ID)
	if err != nil || refreshed == nil {
		return updated, err
	}
	return *refreshed, nil
}

func (o *Orchestrator) RejectPlan(ctx context.Context, taskID, feedback, actor string) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "maintainer"
	}
	unlock := o.lockTask(taskID)
	defer unlock()

	current, err := o.deps.Repo.GetTask(taskID)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if current == nil {
		return domain.TaskRecord{}, fmt.Errorf("Task not found: %s", taskID)
	}
	if current.Status != domain.StatusAwaitingPlanApproval {
		return domain.TaskRecord{}, fmt.Errorf("Task is in status %s, expected AWAITING_PLAN_APPROVAL", current.Status)
	}
	if _, err := o.deps.Repo.TransitionTask(current.ID, domain.StatusPlanning, actor, "Plan revision requested: "+feedback, nil); err != nil {
		return domain.TaskRecord{}, err
	}
	if err := o.generateSpecAndPlan(ctx, current.ID, feedback); err != nil {
		return domain.TaskRecord{}, err
	}
	updated, err := o.deps.Repo.TransitionTask(current.ID, domain.StatusAwaitingPlanApproval, "dragonflow", "Revised plan generated; awaiting maintainer approval", nil)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	o.syncStatusCard(ctx, updated, nil)
	o.emitNotification(ctx, domain.NotifyPlanAwaitingApproval, updated, "技术方案已修订，等待审批")
	return updated, nil
}

func (o *Orchestrator) RetryTask(ctx context.Context, taskID, overrideAgentID, actor string, awaitCompletion bool) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "dashboard"
	}
	unlock := o.lockTask(taskID)
	var updated domain.TaskRecord
	var err error
	func() {
		defer unlock()
		current, gerr := o.deps.Repo.GetTask(taskID)
		if gerr != nil {
			err = gerr
			return
		}
		if current == nil {
			err = fmt.Errorf("Task not found: %s", taskID)
			return
		}
		zero := 0
		patch := &db.TaskPatch{
			LocalFixRetries:    &zero,
			CrossReviewRetries: &zero,
			CiFixRetries:       &zero,
			ReviewFixRetries:   &zero,
			ClearLastError:     true,
		}
		if overrideAgentID != "" {
			patch.AssignedAgent = &overrideAgentID
		}
		if current.PrNumber != nil {
			reason := "Retrying PR fix"
			if overrideAgentID != "" {
				reason = "Retrying PR fix with agent " + overrideAgentID
			}
			updated, err = o.deps.Repo.TransitionTask(current.ID, domain.StatusCiFixing, actor, reason, patch)
			return
		}
		reason := "Retrying task"
		if overrideAgentID != "" {
			reason = "Retrying from routing with agent " + overrideAgentID
		}
		updated, err = o.deps.Repo.TransitionTask(current.ID, domain.StatusRouting, actor, reason, patch)
	}()
	if err != nil {
		return domain.TaskRecord{}, err
	}

	runner := func(rctx context.Context) {
		if updated.Status == domain.StatusCiFixing {
			o.runPrFixLoop(rctx, updated.ID, "CI_FIXING", "Manual retry requested")
		} else {
			o.runRoutingAndExecution(rctx, updated.ID, overrideAgentID)
		}
	}
	if awaitCompletion {
		runner(ctx)
	} else {
		o.scheduleBackground(runner)
	}
	refreshed, err := o.deps.Repo.GetTask(updated.ID)
	if err != nil || refreshed == nil {
		return updated, err
	}
	return *refreshed, nil
}

func (o *Orchestrator) RequestManualFix(ctx context.Context, taskID, instructions, actor string, awaitCompletion bool) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "maintainer"
	}
	unlock := o.lockTask(taskID)
	var updated domain.TaskRecord
	var err error
	func() {
		defer unlock()
		current, gerr := o.deps.Repo.GetTask(taskID)
		if gerr != nil {
			err = gerr
			return
		}
		if current == nil {
			err = fmt.Errorf("Task not found: %s", taskID)
			return
		}
		if current.PrNumber == nil {
			err = fmt.Errorf("Cannot run /fix before a PR is opened")
			return
		}
		updated, err = o.deps.Repo.TransitionTask(current.ID, domain.StatusReviewFixing, actor, "Manual fix requested: "+instructions, nil)
	}()
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if awaitCompletion {
		o.runPrFixLoop(ctx, updated.ID, "REVIEW_FIXING", instructions)
	} else {
		o.scheduleBackground(func(bgCtx context.Context) {
			o.runPrFixLoop(bgCtx, updated.ID, "REVIEW_FIXING", instructions)
		})
	}
	refreshed, err := o.deps.Repo.GetTask(updated.ID)
	if err != nil || refreshed == nil {
		return updated, err
	}
	return *refreshed, nil
}

func (o *Orchestrator) MergeTaskPr(ctx context.Context, taskID, actor string) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "maintainer"
	}
	unlock := o.lockTask(taskID)
	defer unlock()

	current, err := o.deps.Repo.GetTask(taskID)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if current == nil {
		return domain.TaskRecord{}, fmt.Errorf("Task not found: %s", taskID)
	}
	if current.PrNumber == nil {
		return domain.TaskRecord{}, fmt.Errorf("Task does not have an open PR to merge")
	}
	if current.Status != domain.StatusPrOpen && current.Status != domain.StatusReadyToMerge {
		return domain.TaskRecord{}, fmt.Errorf("Task in status %s cannot be merged", current.Status)
	}

	owner, repo, _ := o.splitRepo(current.RepoFullName)
	method := o.deps.Config.GitHub.AutoMergeLowRisk.MergeMethod
	commitTitle := fmt.Sprintf("%s(#%d): %s", formatCommitPrefix(current.Category), current.IssueNumber, current.IssueTitle)
	res, err := o.deps.GitHub.MergePullRequest(ctx, owner, repo, *current.PrNumber, method, commitTitle)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if !res.Merged {
		return domain.TaskRecord{}, fmt.Errorf("GitHub refused to merge PR #%d", *current.PrNumber)
	}

	merged, err := o.deps.Repo.TransitionTask(current.ID, domain.StatusMerged, actor, fmt.Sprintf("Merged PR #%d", *current.PrNumber), nil)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if o.deps.Config.Workspace.CleanupOnFinish && merged.WorktreePath != nil && *merged.WorktreePath != "" {
		_ = o.deps.Workspace.CleanupWorkspace(ctx, merged.RepoFullName, *merged.WorktreePath)
	}
	o.syncStatusCard(ctx, merged, nil)
	o.emitNotification(ctx, domain.NotifyMerged, merged, fmt.Sprintf("PR #%d 已合入主分支", *merged.PrNumber))
	return merged, nil
}

func (o *Orchestrator) CancelTask(ctx context.Context, taskID, actor string) (domain.TaskRecord, error) {
	if actor == "" {
		actor = "maintainer"
	}
	unlock := o.lockTask(taskID)
	defer unlock()

	current, err := o.deps.Repo.GetTask(taskID)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	if current == nil {
		return domain.TaskRecord{}, fmt.Errorf("Task not found: %s", taskID)
	}
	if domain.IsTerminalStatus(current.Status) {
		return *current, nil
	}
	cancelled, err := o.deps.Repo.TransitionTask(current.ID, domain.StatusCancelled, actor, "Task cancelled", nil)
	if err != nil {
		return domain.TaskRecord{}, err
	}
	o.syncStatusCard(ctx, cancelled, nil)
	return cancelled, nil
}

func (o *Orchestrator) SimulateDemoIssue(ctx context.Context, input domain.SimulateIssueInput) (domain.SimulateIssueResult, error) {
	mockGH, ok := o.deps.GitHub.(*github.InMemoryGitHubClient)
	if !ok || o.deps.Config.Project.Mode != "demo" {
		return domain.SimulateIssueResult{}, fmt.Errorf("Simulate issue is only enabled in demo mode")
	}

	type preset struct {
		title  string
		body   string
		labels []string
	}
	templates := map[string]preset{
		"quick_fix": {
			title:  "Fix numeric input parsing edge case in sum helper",
			body:   `Calling sum("1", 2) concatenates strings instead of numeric addition. Need clean coercion and unit test.`,
			labels: []string{"bug"},
		},
		"full_sdlc": {
			title:  "Implement OAuth2 plugin authentication architecture",
			body:   "Support pluggable OAuth2 providers with token refresh, session storage, and integration test suite.",
			labels: []string{"enhancement", "architecture"},
		},
		"quota_fallback": {
			title:  "[QuotaFallback] Optimize batch indexing with automatic agent fallback",
			body:   "Primary agent hits simulated quota_exceeded limit; verify seamless fallback to secondary agent.",
			labels: []string{"bug"},
		},
		"ci_fail_heal": {
			title:  "[CIFailHeal] Add strict date formatter with PR CI self-healing",
			body:   "Simulate initial remote CI failure after PR opens so DragonFlow auto-heals and turns checks green.",
			labels: []string{"bug"},
		},
	}

	chosen, exists := templates[input.TierPreset]
	if !exists {
		chosen = templates["quick_fix"]
	}
	labels := append([]string{}, chosen.labels...)
	if len(input.Labels) > 0 {
		labels = append([]string{}, input.Labels...)
	}
	if input.AutoTrigger {
		has := false
		for _, l := range labels {
			if l == o.deps.Config.GitHub.TriggerLabel {
				has = true
				break
			}
		}
		if !has {
			labels = append(labels, o.deps.Config.GitHub.TriggerLabel)
		}
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = chosen.title
	}
	body := strings.TrimSpace(input.Body)
	if body == "" {
		body = chosen.body
	}
	author := "community-contributor"
	assoc := "NONE"
	if input.AutoTrigger {
		author = "maintainer"
		assoc = "OWNER"
	}

	issue := mockGH.SeedIssue(github.SeedIssueInput{
		Title:             title,
		Body:              body,
		Labels:            labels,
		Author:            author,
		AuthorAssociation: assoc,
	})

	repoFullName := "dragonflow-org/awesome-oss"
	if len(o.deps.Config.GitHub.Repositories) > 0 {
		r := o.deps.Config.GitHub.Repositories[0]
		repoFullName = r.Owner + "/" + r.Repo
	}

	task, err := o.IngestIssue(ctx, repoFullName, issue)
	if err != nil {
		return domain.SimulateIssueResult{}, err
	}
	return domain.SimulateIssueResult{
		Task:        task,
		IssueNumber: issue.Number,
	}, nil
}

func (o *Orchestrator) runRoutingAndExecution(ctx context.Context, taskID, manualAgentID string) {
	if err := o.acquireSem(ctx); err != nil {
		return
	}
	defer o.releaseSem()

	needsApproval := false
	unlock := o.lockTask(taskID)
	func() {
		defer unlock()
		task, err := o.deps.Repo.GetTask(taskID)
		if err != nil || task == nil || task.Status != domain.StatusRouting {
			return
		}
		owner, repo, _ := o.splitRepo(task.RepoFullName)
		triageArt, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactTriage)
		tr := domain.TriageResult{
			Category:            domain.CategoryBug,
			EstimatedComplexity: 2,
			RecommendedTier:     task.Tier,
			Summary:             task.IssueTitle,
		}
		if task.Category != nil {
			tr.Category = *task.Category
		}
		if task.ComplexityScore != nil {
			tr.EstimatedComplexity = *task.ComplexityScore
		}
		if triageArt != nil && triageArt.Metadata != nil {
			if raw, merr := json.Marshal(triageArt.Metadata); merr == nil {
				_ = json.Unmarshal(raw, &tr)
			}
		}

		repoSummary, err := o.deps.GitHub.GetRepoSummary(ctx, owner, repo)
		if err != nil {
			repoSummary = task.RepoFullName
		}

		routeRun, _ := o.deps.Repo.CreateRun(task.ID, "routing", "router", 1)
		decision, rTokens, rCost, err := o.deps.Router.Route(ctx, domain.GitHubIssue{
			Number:            task.IssueNumber,
			Title:             task.IssueTitle,
			Body:              task.IssueBody,
			Author:            task.IssueAuthor,
			AuthorAssociation: "NONE",
			Labels:            task.Labels,
			State:             "open",
			URL:               task.IssueURL,
			CreatedAt:         task.CreatedAt,
			UpdatedAt:         task.UpdatedAt,
		}, tr, manualAgentID, repoSummary, func(stream, msg string) {
			_, _ = o.deps.Repo.AppendLog(task.ID, routeRun.ID, stream, msg)
		})
		if err != nil {
			errMsg := err.Error()
			_, _ = o.deps.Repo.FinishRun(routeRun.ID, db.FinishRunResult{
				Status:    "failed",
				ErrorKind: domain.ErrKindRuntimeError,
				Summary:   &errMsg,
			})
			failed, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusNeedsHuman, "router", "Routing failed: "+errMsg, &db.TaskPatch{LastError: &errMsg})
			o.syncStatusCard(ctx, failed, nil)
			o.emitNotification(ctx, domain.NotifyNeedsHuman, failed, "Agent 路由失败："+errMsg)
			return
		}

		_, _ = o.deps.Repo.FinishRun(routeRun.ID, db.FinishRunResult{
			Status:     "succeeded",
			ErrorKind:  domain.ErrKindNone,
			TokensUsed: rTokens,
			CostUsd:    rCost,
			Summary:    &decision.Rationale,
		})

		branchName := fmt.Sprintf("dragonflow/issue-%d", task.IssueNumber)
		_, _ = o.deps.Repo.TransitionTask(task.ID, domain.StatusPlanning, "router", fmt.Sprintf("Selected %s (%s)", decision.PrimaryAgent, decision.Tier), &db.TaskPatch{
			Tier:             &decision.Tier,
			ComplexityScore:  &decision.ComplexityScore,
			AssignedAgent:    &decision.PrimaryAgent,
			ReviewerAgent:    &decision.ReviewerAgent,
			RoutingRationale: &decision.Rationale,
			BranchName:       &branchName,
		})

		if err := o.generateSpecAndPlan(ctx, task.ID, ""); err != nil {
			errMsg := err.Error()
			failed, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusNeedsHuman, "dragonflow", "Planning failed: "+errMsg, &db.TaskPatch{LastError: &errMsg})
			o.syncStatusCard(ctx, failed, nil)
			o.emitNotification(ctx, domain.NotifyNeedsHuman, failed, "方案生成失败："+errMsg)
			return
		}

		if decision.Tier == domain.TierFullSdlc && o.deps.Config.Workflow.RequirePlanApprovalForFullSdlc {
			waiting, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusAwaitingPlanApproval, "dragonflow", "Full SDLC plan ready; waiting for maintainer /approve", nil)
			o.syncStatusCard(ctx, waiting, nil)
			o.emitNotification(ctx, domain.NotifyPlanAwaitingApproval, waiting, "已完成 Spec 与技术方案，请确认审批（/approve）后开始编码。")
			needsApproval = true
			return
		}

		_, _ = o.deps.Repo.TransitionTask(task.ID, domain.StatusImplementing, "dragonflow", "Proceeding directly to implementation", nil)
	}()

	if !needsApproval {
		current, err := o.deps.Repo.GetTask(taskID)
		if err == nil && current != nil && current.Status == domain.StatusImplementing {
			o.executeImplementationPipeline(ctx, taskID)
		}
	}
}

func (o *Orchestrator) runImplementationToPr(ctx context.Context, taskID string) {
	if err := o.acquireSem(ctx); err != nil {
		return
	}
	defer o.releaseSem()
	o.executeImplementationPipeline(ctx, taskID)
}

func (o *Orchestrator) generateSpecAndPlan(ctx context.Context, taskID, revisionFeedback string) error {
	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil {
		return fmt.Errorf("task not found")
	}
	planRun, _ := o.deps.Repo.CreateRun(task.ID, "planning", "structured-llm", 1)

	userPromptParts := []string{
		fmt.Sprintf("Issue #%d: %s", task.IssueNumber, task.IssueTitle),
		"Body:\n" + task.IssueBody,
	}
	if revisionFeedback != "" {
		userPromptParts = append(userPromptParts, "\nMaintainer Feedback:\n"+revisionFeedback)
	}

	specRes, err := llm.CompleteJSON(ctx, o.deps.LLM, llm.StructuredRequest{
		Stage:        "spec",
		SystemPrompt: "You are a Staff Product & Requirements Engineer.\nProduce a clear, testable software specification from the GitHub issue.\nReturn JSON: { problemStatement, acceptanceCriteria, nonGoals, affectedAreas }.",
		UserPrompt:   strings.Join(userPromptParts, "\n"),
		OnLog: func(s, m string) {
			_, _ = o.deps.Repo.AppendLog(task.ID, planRun.ID, s, m)
		},
	}, func(s *domain.SpecDocument) error {
		if strings.TrimSpace(s.ProblemStatement) == "" {
			return fmt.Errorf("problemStatement required")
		}
		return nil
	})
	if err != nil {
		errMsg := err.Error()
		_, _ = o.deps.Repo.FinishRun(planRun.ID, db.FinishRunResult{Status: "failed", ErrorKind: domain.ErrKindRuntimeError, Summary: &errMsg})
		return err
	}

	specBlocks := []string{
		fmt.Sprintf("## 需求规格说明书 (Spec) — #%d", task.IssueNumber),
		"### 问题描述",
		specRes.Data.ProblemStatement,
		"### 验收标准 (Acceptance Criteria)",
	}
	for _, c := range specRes.Data.AcceptanceCriteria {
		specBlocks = append(specBlocks, "- [ ] "+c)
	}
	if len(specRes.Data.NonGoals) > 0 {
		var lines []string
		for _, g := range specRes.Data.NonGoals {
			lines = append(lines, "- "+g)
		}
		specBlocks = append(specBlocks, "### 非目标 (Non-Goals)\n"+strings.Join(lines, "\n"))
	}
	if len(specRes.Data.AffectedAreas) > 0 {
		var lines []string
		for _, a := range specRes.Data.AffectedAreas {
			lines = append(lines, fmt.Sprintf("- `%s`", a))
		}
		specBlocks = append(specBlocks, "### 影响范围\n"+strings.Join(lines, "\n"))
	}
	specMD := strings.Join(specBlocks, "\n\n")
	_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactSpec, fmt.Sprintf("需求规格 Spec (#%d)", task.IssueNumber), specMD, toStringMap(specRes.Data))

	totalTokens := specRes.Tokens
	totalCost := specRes.CostUsd

	if task.Tier == domain.TierFullSdlc {
		planPrompt := "Spec:\n" + specMD
		if revisionFeedback != "" {
			planPrompt += "\n\nMaintainer Revision Feedback:\n" + revisionFeedback
		}
		planRes, err := llm.CompleteJSON(ctx, o.deps.LLM, llm.StructuredRequest{
			Stage:        "plan",
			SystemPrompt: "You are a Principal Software Architect.\nCreate an actionable technical design & test plan.\nReturn JSON: { architectureSummary, filesToModify, implementationSteps, testPlan, risksAndMitigations }.",
			UserPrompt:   planPrompt,
			OnLog: func(s, m string) {
				_, _ = o.deps.Repo.AppendLog(task.ID, planRun.ID, s, m)
			},
		}, func(p *domain.PlanDocument) error {
			if strings.TrimSpace(p.ArchitectureSummary) == "" {
				return fmt.Errorf("architectureSummary required")
			}
			return nil
		})
		if err != nil {
			errMsg := err.Error()
			_, _ = o.deps.Repo.FinishRun(planRun.ID, db.FinishRunResult{Status: "failed", ErrorKind: domain.ErrKindRuntimeError, Summary: &errMsg})
			return err
		}
		totalTokens += planRes.Tokens
		totalCost += planRes.CostUsd

		planBlocks := []string{
			fmt.Sprintf("## 技术方案与测试计划 (Plan) — #%d", task.IssueNumber),
			"### 架构设计",
			planRes.Data.ArchitectureSummary,
		}
		if len(planRes.Data.FilesToModify) > 0 {
			var lines []string
			for _, f := range planRes.Data.FilesToModify {
				lines = append(lines, fmt.Sprintf("- `%s`", f))
			}
			planBlocks = append(planBlocks, "### 预计改动文件\n"+strings.Join(lines, "\n"))
		}
		if len(planRes.Data.ImplementationSteps) > 0 {
			var lines []string
			for _, s := range planRes.Data.ImplementationSteps {
				lines = append(lines, "- "+s)
			}
			planBlocks = append(planBlocks, "### 实施步骤\n"+strings.Join(lines, "\n"))
		}
		if len(planRes.Data.TestPlan) > 0 {
			var lines []string
			for _, tp := range planRes.Data.TestPlan {
				lines = append(lines, "- "+tp)
			}
			planBlocks = append(planBlocks, "### 测试计划\n"+strings.Join(lines, "\n"))
		}
		if len(planRes.Data.RisksAndMitigations) > 0 {
			var lines []string
			for _, rm := range planRes.Data.RisksAndMitigations {
				lines = append(lines, "- "+rm)
			}
			planBlocks = append(planBlocks, "### 风险与兜底\n"+strings.Join(lines, "\n"))
		}
		_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactPlan, fmt.Sprintf("技术方案 Plan (#%d)", task.IssueNumber), strings.Join(planBlocks, "\n\n"), toStringMap(planRes.Data))
	}

	summary := "Generated Quick Spec"
	if task.Tier == domain.TierFullSdlc {
		summary = "Generated Spec & Plan"
	}
	_, _ = o.deps.Repo.FinishRun(planRun.ID, db.FinishRunResult{
		Status:     "succeeded",
		ErrorKind:  domain.ErrKindNone,
		TokensUsed: totalTokens,
		CostUsd:    totalCost,
		Summary:    &summary,
	})
	return nil
}

func (o *Orchestrator) executeImplementationPipeline(ctx context.Context, taskID string) {
	unlock := o.lockTask(taskID)
	defer unlock()

	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil || task.Status != domain.StatusImplementing {
		return
	}

	owner, repo, cfg := o.splitRepo(task.RepoFullName)
	baseBranch := "main"
	if cfg != nil && cfg.BaseBranch != "" {
		baseBranch = cfg.BaseBranch
	}
	branchName := fmt.Sprintf("dragonflow/issue-%d", task.IssueNumber)
	if task.BranchName != nil && *task.BranchName != "" {
		branchName = *task.BranchName
	}
	remoteURL := o.deps.Config.Workspace.LocalRepoUrlOverride
	if remoteURL == "" {
		remoteURL, _ = o.deps.GitHub.GetRepoCloneURL(ctx, owner, repo)
	}

	worktreePath, err := o.deps.Workspace.CreateTaskWorkspace(ctx, task.ID, task.RepoFullName, remoteURL, branchName, baseBranch)
	if err != nil {
		o.escalateNeedsHuman(ctx, task.ID, "创建 Git Worktree 失败："+err.Error())
		return
	}
	updatedTask, _ := o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{
		WorktreePath: &worktreePath,
		BranchName:   &branchName,
	})
	task = &updatedTask

	specContent := ""
	if art, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactSpec); art != nil {
		specContent = art.Content
	}
	planContent := ""
	if art, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactPlan); art != nil {
		planContent = art.Content
	}

	feedbackPrompt := ""
	triedAgents := make(map[string]bool)

	for {
		task, _ = o.deps.Repo.GetTask(task.ID)
		if task == nil {
			return
		}
		primaryAgent := o.deps.Config.Routing.DefaultAgent
		if task.AssignedAgent != nil && *task.AssignedAgent != "" {
			primaryAgent = *task.AssignedAgent
		}
		triedAgents[primaryAgent] = true

		promptParts := []string{
			fmt.Sprintf("You are implementing GitHub Issue #%d in repository %s.", task.IssueNumber, task.RepoFullName),
			"Title: " + task.IssueTitle,
			"Description:\n" + task.IssueBody,
		}
		if specContent != "" {
			promptParts = append(promptParts, specContent)
		}
		if planContent != "" {
			promptParts = append(promptParts, planContent)
		}
		if feedbackPrompt != "" {
			promptParts = append(promptParts, "## Previous Failure / Review Feedback to Fix\n"+feedbackPrompt)
		}
		promptParts = append(promptParts, "Instructions: Modify the codebase cleanly, write or update tests, do NOT run git push.")

		usedAgent, _, ok, errMsg := o.executeAgentWithFallback(ctx, task.ID, "implementing", worktreePath, branchName, strings.Join(promptParts, "\n\n"), triedAgents)
		if !ok {
			o.escalateNeedsHuman(ctx, task.ID, errMsg)
			return
		}

		diffText, _ := o.deps.Workspace.GetDiff(ctx, worktreePath, baseBranch)
		_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactDiff, fmt.Sprintf("代码变更 Diff (%s)", usedAgent), diffText, nil)

		tTesting, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusTesting, "dragonflow", "Running local lint, test, and build verification", nil)
		task = &tTesting

		passed, reportMD, failureOut := o.runVerificationSuite(ctx, task.ID, worktreePath, cfg)
		statusText := "通过"
		if !passed {
			statusText = "失败"
		}
		_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactTestReport, fmt.Sprintf("本地测试验证报告 (%s)", statusText), reportMD, map[string]any{"passed": passed})

		if !passed {
			if task.LocalFixRetries < o.deps.Config.Workflow.MaxLocalFixRetries {
				nextRetries := task.LocalFixRetries + 1
				t2, _ := o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{LocalFixRetries: &nextRetries})
				task = &t2
				feedbackPrompt = fmt.Sprintf("Local test/build verification failed (retry %d):\n%s", nextRetries, failureOut)
				t3, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusImplementing, "dragonflow", fmt.Sprintf("Local verification failed; self-healing retry %d", nextRetries), nil)
				task = &t3
				continue
			}

			nextAgent := o.deps.Router.SelectNextFallback(mapKeys(triedAgents), nil)
			if nextAgent != "" {
				o.recordFallback(ctx, task.ID, primaryAgent, nextAgent, "testing", "Exceeded local test-fix retries with current agent", domain.ErrKindRuntimeError)
				zero := 0
				_, _ = o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{LocalFixRetries: &zero})
				feedbackPrompt = fmt.Sprintf("Previous agent (%s) failed tests repeatedly:\n%s", primaryAgent, failureOut)
				t3, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusImplementing, "dragonflow", fmt.Sprintf("Falling back to %s after repeated test failures", nextAgent), nil)
				task = &t3
				continue
			}

			o.escalateNeedsHuman(ctx, task.ID, "本地测试连续失败且已无可用备选 Agent：\n"+truncateStr(failureOut, 600))
			return
		}

		reviewer := "reviewer"
		if task.ReviewerAgent != nil && *task.ReviewerAgent != "" {
			reviewer = *task.ReviewerAgent
		}
		tCR, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusCrossReview, "dragonflow", "Starting cross-review by "+reviewer, nil)
		task = &tCR

		review := o.runCrossReview(ctx, *task, specContent, diffText, reportMD)
		crLabel := "需修改"
		if review.Approved {
			crLabel = "通过"
		}
		_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactReview, fmt.Sprintf("跨 Agent 独立 Review (%s): %s", reviewer, crLabel), formatReviewMarkdown(review, reviewer), toStringMap(review))

		if !review.Approved {
			if task.CrossReviewRetries < o.deps.Config.Workflow.MaxCrossReviewRetries {
				nextCR := task.CrossReviewRetries + 1
				t2, _ := o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{CrossReviewRetries: &nextCR})
				task = &t2
				feedbackPrompt = fmt.Sprintf("Cross-review by %s requested fixes:\n%s", reviewer, formatReviewMarkdown(review, reviewer))
				t3, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusImplementing, reviewer, fmt.Sprintf("Cross-review found blocking issues; fixing (attempt %d)", nextCR), nil)
				task = &t3
				continue
			}
			o.escalateNeedsHuman(ctx, task.ID, "独立 Cross-Review 多次未通过："+review.Summary)
			return
		}
		break
	}

	task, _ = o.deps.Repo.GetTask(taskID)
	if task == nil {
		return
	}
	prefix := formatCommitPrefix(task.Category)
	commitMsg := fmt.Sprintf("%s(issue-%d): %s", prefix, task.IssueNumber, task.IssueTitle)
	pushRemote := !o.deps.GitHub.IsMock()

	commitRes, err := o.deps.Workspace.CommitAndPush(ctx, worktreePath, commitMsg, branchName, pushRemote)
	if err != nil {
		o.escalateNeedsHuman(ctx, task.ID, "Git 提交或推送失败："+err.Error())
		return
	}

	prBody := o.buildPrBody(*task, commitRes.ChangedFiles)
	_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactPrBody, fmt.Sprintf("Pull Request 描述 (#%d)", task.IssueNumber), prBody, nil)

	pr, err := o.deps.GitHub.CreatePullRequest(ctx, owner, repo, github.CreatePrParams{
		Title:      fmt.Sprintf("%s: %s (#%d)", prefix, task.IssueTitle, task.IssueNumber),
		Body:       prBody,
		HeadBranch: branchName,
		BaseBranch: baseBranch,
	})
	if err != nil {
		o.escalateNeedsHuman(ctx, task.ID, "创建 Pull Request 失败："+err.Error())
		return
	}

	opened, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusPrOpen, "dragonflow", fmt.Sprintf("Opened PR #%d", pr.Number), &db.TaskPatch{
		PrNumber: &pr.Number,
		PrURL:    &pr.URL,
	})
	o.syncStatusCard(ctx, opened, nil)
	agentName := ""
	if opened.AssignedAgent != nil {
		agentName = *opened.AssignedAgent
	}
	revName := ""
	if opened.ReviewerAgent != nil {
		revName = *opened.ReviewerAgent
	}
	o.emitNotification(ctx, domain.NotifyPrOpened, opened, fmt.Sprintf("已由 %s 实现并经 %s 交叉审查，PR #%d 已创建。", agentName, revName, pr.Number))
}

func (o *Orchestrator) executeAgentWithFallback(
	ctx context.Context,
	taskID, stage, cwd, branchName, prompt string,
	triedAgents map[string]bool,
) (string, adapters.AgentExecResult, bool, string) {
	task, _ := o.deps.Repo.GetTask(taskID)
	currentAgentID := o.deps.Config.Routing.DefaultAgent
	if task != nil && task.AssignedAgent != nil && *task.AssignedAgent != "" {
		currentAgentID = *task.AssignedAgent
	}
	attempt := 0

	for {
		attempt++
		triedAgents[currentAgentID] = true
		adapter := o.deps.Registry.GetAdapter(currentAgentID)
		if adapter == nil || !o.deps.Registry.IsAvailable(currentAgentID) {
			next := o.deps.Router.SelectNextFallback(mapKeys(triedAgents), nil)
			if next == "" {
				return "", adapters.AgentExecResult{}, false, fmt.Sprintf("Agent %q 不可用且无可用备选 Agent", currentAgentID)
			}
			o.recordFallback(ctx, taskID, currentAgentID, next, stage, fmt.Sprintf("Agent %q unavailable", currentAgentID), domain.ErrKindRuntimeError)
			currentAgentID = next
			continue
		}

		run, _ := o.deps.Repo.CreateRun(taskID, stage, currentAgentID, attempt)
		res := adapter.Execute(ctx, adapters.AgentExecContext{
			TaskID:     taskID,
			RunID:      run.ID,
			Stage:      stage,
			Cwd:        cwd,
			BranchName: branchName,
			Prompt:     prompt,
			OnLog: func(stream, msg string) {
				_, _ = o.deps.Repo.AppendLog(taskID, run.ID, stream, msg)
			},
		})

		status := "failed"
		if res.Success {
			status = "succeeded"
		}
		summary := truncateStr(res.OutputText, 300)
		exitCode := res.ExitCode
		_, _ = o.deps.Repo.FinishRun(run.ID, db.FinishRunResult{
			Status:     status,
			ErrorKind:  res.ErrorKind,
			ExitCode:   &exitCode,
			TokensUsed: res.TokensUsed,
			CostUsd:    res.CostUsd,
			Summary:    &summary,
		})

		if res.Success {
			return currentAgentID, res, true, ""
		}

		next := o.deps.Router.SelectNextFallback(mapKeys(triedAgents), nil)
		if next == "" {
			return "", res, false, fmt.Sprintf("Agent %q 执行失败 (%s) 且已无可用备选 Agent：%s", currentAgentID, res.ErrorKind, truncateStr(res.RawStderr, 300))
		}
		o.recordFallback(ctx, taskID, currentAgentID, next, stage, fmt.Sprintf("Agent %q failed with %s", currentAgentID, res.ErrorKind), res.ErrorKind)
		currentAgentID = next
	}
}

func (o *Orchestrator) recordFallback(ctx context.Context, taskID, fromAgent, toAgent, stage, reason string, errKind domain.AgentErrorKind) {
	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil {
		return
	}
	entry := domain.FallbackAttemptRecord{
		FromAgent: fromAgent,
		ToAgent:   toAgent,
		Stage:     stage,
		Reason:    reason,
		ErrorKind: errKind,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	}
	count := task.FallbackCount + 1
	history := append(append([]domain.FallbackAttemptRecord{}, task.FallbackHistory...), entry)
	updated, _ := o.deps.Repo.UpdateTask(taskID, db.TaskPatch{
		AssignedAgent:   &toAgent,
		FallbackCount:   &count,
		FallbackHistory: &history,
	})
	o.emitNotification(ctx, domain.NotifyAgentFallback, updated, fmt.Sprintf("Agent 从 %q 自动降级切换至 %q（阶段: %s，原因: %s）", fromAgent, toAgent, stage, errKind))
}

func (o *Orchestrator) runVerificationSuite(ctx context.Context, taskID, worktreePath string, repoCfg *domain.RepoConfig) (bool, string, string) {
	type cmdItem struct{ label, cmd string }
	var commands []cmdItem

	lintCmd := o.deps.Config.Workflow.DefaultLintCommand
	testCmd := o.deps.Config.Workflow.DefaultTestCommand
	buildCmd := o.deps.Config.Workflow.DefaultBuildCommand
	if repoCfg != nil {
		if repoCfg.LintCommand != "" {
			lintCmd = repoCfg.LintCommand
		}
		if repoCfg.TestCommand != "" {
			testCmd = repoCfg.TestCommand
		}
		if repoCfg.BuildCommand != "" {
			buildCmd = repoCfg.BuildCommand
		}
	}
	if lintCmd != "" {
		commands = append(commands, cmdItem{"Lint", lintCmd})
	}
	if testCmd != "" {
		commands = append(commands, cmdItem{"Test", testCmd})
	}
	if buildCmd != "" {
		commands = append(commands, cmdItem{"Build", buildCmd})
	}

	if len(commands) == 0 {
		return true, "### 本地验证\n未配置显式测试/构建命令，跳过命令行验证。", ""
	}

	run, _ := o.deps.Repo.CreateRun(taskID, "testing", "local-runner", 1)
	var reportParts []string
	allPassed := true
	failureOut := ""

	for _, item := range commands {
		_, _ = o.deps.Repo.AppendLog(taskID, run.ID, "system", fmt.Sprintf("[Verify:%s] $ %s", item.label, item.cmd))
		res, err := o.deps.Workspace.RunShellCommand(ctx, worktreePath, item.cmd, 300_000, func(stream, line string) {
			_, _ = o.deps.Repo.AppendLog(taskID, run.ID, stream, line)
		})
		if err != nil {
			allPassed = false
			failureOut = fmt.Sprintf("[%s] error: %s", item.label, err.Error())
			reportParts = append(reportParts, fmt.Sprintf("### %s: `%s` (error)\n```\n%s\n```", item.label, item.cmd, err.Error()))
			break
		}
		combined := strings.TrimSpace(strings.TrimSpace(res.Stdout) + "\n" + strings.TrimSpace(res.Stderr))
		outTail := combined
		if len(outTail) > 2000 {
			outTail = outTail[len(outTail)-2000:]
		}
		if outTail == "" {
			outTail = "(no output)"
		}
		reportParts = append(reportParts, fmt.Sprintf("### %s: `%s` (exit=%d)\n```\n%s\n```", item.label, item.cmd, res.ExitCode, outTail))
		if res.ExitCode != 0 || res.TimedOut {
			allPassed = false
			failureOut = fmt.Sprintf("[%s] exit=%d\n%s", item.label, res.ExitCode, combined)
			break
		}
	}

	status := "failed"
	errKind := domain.ErrKindRuntimeError
	summary := truncateStr(failureOut, 200)
	if allPassed {
		status = "succeeded"
		errKind = domain.ErrKindNone
		summary = "All verification commands passed"
	}
	_, _ = o.deps.Repo.FinishRun(run.ID, db.FinishRunResult{
		Status:    status,
		ErrorKind: errKind,
		Summary:   &summary,
	})

	header := "## 本地构建与测试报告 — 存在失败"
	if allPassed {
		header = "## 本地构建与测试报告 — 全部通过"
	}
	return allPassed, header + "\n\n" + strings.Join(reportParts, "\n\n"), failureOut
}

func (o *Orchestrator) runCrossReview(ctx context.Context, task domain.TaskRecord, specContent, diffText, testReport string) domain.CrossReviewResult {
	reviewerID := "reviewer"
	if task.ReviewerAgent != nil && *task.ReviewerAgent != "" {
		reviewerID = *task.ReviewerAgent
	} else if task.AssignedAgent != nil && *task.AssignedAgent != "" {
		reviewerID = *task.AssignedAgent
	}
	assigned := ""
	if task.AssignedAgent != nil {
		assigned = *task.AssignedAgent
	}

	run, _ := o.deps.Repo.CreateRun(task.ID, "cross_review", reviewerID, task.CrossReviewRetries+1)
	cwd := ""
	if task.WorktreePath != nil {
		cwd = *task.WorktreePath
	}

	res, err := llm.CompleteJSON(ctx, o.deps.LLM, llm.StructuredRequest{
		Stage: "cross_review",
		SystemPrompt: strings.Join([]string{
			fmt.Sprintf("You are an independent Senior Code Reviewer (%s), distinct from the author (%s).", reviewerID, assigned),
			"Inspect the spec, git diff, and test report rigorously.",
			"Approve ONLY if acceptance criteria are met, tests pass, scope is clean, and there are no critical/major bugs or security vulnerabilities.",
			"Return JSON: { approved, summary, findings: [{ severity, file?, line?, message, suggestion? }], checklist: { acceptanceCriteriaMet, testsAdequate, noObviousSecurityRisks, cleanScope } }.",
		}, "\n"),
		UserPrompt: strings.Join([]string{
			fmt.Sprintf("Issue #%d: %s", task.IssueNumber, task.IssueTitle),
			specContent,
			"### Diff\n" + truncateStr(diffText, 12000),
			"### Test Report\n" + truncateStr(testReport, 4000),
		}, "\n\n"),
		Cwd: cwd,
		OnLog: func(s, m string) {
			_, _ = o.deps.Repo.AppendLog(task.ID, run.ID, s, m)
		},
	}, func(cr *domain.CrossReviewResult) error {
		if strings.TrimSpace(cr.Summary) == "" {
			return fmt.Errorf("cross-review summary required")
		}
		if cr.Findings == nil {
			cr.Findings = []domain.CrossReviewFinding{}
		}
		return nil
	})
	if err != nil {
		errMsg := err.Error()
		_, _ = o.deps.Repo.FinishRun(run.ID, db.FinishRunResult{
			Status:    "failed",
			ErrorKind: domain.ErrKindRuntimeError,
			Summary:   &errMsg,
		})
		return domain.CrossReviewResult{
			Approved: false,
			Summary:  "Cross-review execution error: " + errMsg,
			Findings: []domain.CrossReviewFinding{{Severity: "major", Message: errMsg}},
		}
	}

	_, _ = o.deps.Repo.FinishRun(run.ID, db.FinishRunResult{
		Status:     "succeeded",
		ErrorKind:  domain.ErrKindNone,
		TokensUsed: res.Tokens,
		CostUsd:    res.CostUsd,
		Summary:    &res.Data.Summary,
	})
	return res.Data
}

func (o *Orchestrator) PollOpenPrs(ctx context.Context, repoFullNameFilter string) (int, error) {
	tasks, err := o.deps.Repo.ListTasks("", "")
	if err != nil {
		return 0, err
	}
	checked := 0

	for _, t := range tasks {
		if repoFullNameFilter != "" && t.RepoFullName != repoFullNameFilter {
			continue
		}
		switch t.Status {
		case domain.StatusPrOpen, domain.StatusReadyToMerge, domain.StatusMerged, domain.StatusReleasePrOpen:
		default:
			continue
		}

		unlock := o.lockTask(t.ID)
		func() {
			defer unlock()
			current, err := o.deps.Repo.GetTask(t.ID)
			if err != nil || current == nil {
				return
			}
			owner, repo, _ := o.splitRepo(current.RepoFullName)
			checked++

			if current.Status == domain.StatusPrOpen || current.Status == domain.StatusReadyToMerge {
				if current.PrNumber == nil {
					return
				}
				pr, err := o.deps.GitHub.GetPullRequest(ctx, owner, repo, *current.PrNumber)
				if err != nil {
					return
				}
				if pr.Merged {
					merged, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusMerged, "github", fmt.Sprintf("PR #%d merged", pr.Number), nil)
					if o.deps.Config.Workspace.CleanupOnFinish && merged.WorktreePath != nil && *merged.WorktreePath != "" {
						_ = o.deps.Workspace.CleanupWorkspace(ctx, merged.RepoFullName, *merged.WorktreePath)
					}
					o.syncStatusCard(ctx, merged, nil)
					o.emitNotification(ctx, domain.NotifyMerged, merged, fmt.Sprintf("PR #%d 已合并", pr.Number))
					o.checkReleaseState(ctx, merged.ID)
					return
				}

				reviews, err := o.deps.GitHub.ListPrReviews(ctx, owner, repo, pr.Number)
				if err == nil {
					for _, rev := range reviews {
						if rev.ID <= current.LastProcessedReviewID {
							continue
						}
						rid := rev.ID
						_, _ = o.deps.Repo.UpdateTask(current.ID, db.TaskPatch{LastProcessedReviewID: &rid})
						if rev.State == "CHANGES_REQUESTED" && github.IsMaintainer(rev.Author, rev.AuthorAssociation, o.deps.Config) {
							lineComments, _ := o.deps.GitHub.ListPrReviewComments(ctx, owner, repo, pr.Number)
							lines := []string{fmt.Sprintf("Reviewer %s requested changes: %s", rev.Author, rev.Body)}
							for _, lc := range lineComments {
								lineNo := "?"
								if lc.Line != nil {
									lineNo = fmt.Sprintf("%d", *lc.Line)
								}
								lines = append(lines, fmt.Sprintf("- %s:%s %s", lc.Path, lineNo, lc.Body))
							}
							details := strings.Join(lines, "\n")
							if current.ReviewFixRetries < o.deps.Config.Workflow.MaxReviewFixRetries {
								nextRF := current.ReviewFixRetries + 1
								fixing, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusReviewFixing, rev.Author, fmt.Sprintf("Addressing maintainer review #%d", rev.ID), &db.TaskPatch{ReviewFixRetries: &nextRF})
								o.emitNotification(ctx, domain.NotifyReviewRequested, fixing, fmt.Sprintf("收到维护者 %s 的 Review 修改意见，正在自动修复...", rev.Author))
								o.executePrFix(ctx, fixing.ID, "REVIEW_FIXING", details)
								return
							}
							o.escalateNeedsHuman(ctx, current.ID, fmt.Sprintf("PR Review 修改意见重试已达上限 (%d)", o.deps.Config.Workflow.MaxReviewFixRetries))
							return
						}
					}
				}

				checkRuns, err := o.deps.GitHub.ListPrCheckRuns(ctx, owner, repo, pr.Number)
				if err != nil {
					return
				}
				var failedChecks []domain.GitHubCheckRun
				for _, cr := range checkRuns {
					if cr.Status == "completed" && (cr.Conclusion == "failure" || cr.Conclusion == "timed_out" || cr.Conclusion == "cancelled") {
						failedChecks = append(failedChecks, cr)
					}
				}
				if len(failedChecks) > 0 {
					var names []string
					var sumLines []string
					for _, fc := range failedChecks {
						names = append(names, fc.Name)
						sumLines = append(sumLines, fmt.Sprintf("- %s (%s): %s %s", fc.Name, fc.Conclusion, fc.OutputTitle, fc.OutputSummary))
					}
					ciSummary := strings.Join(sumLines, "\n")
					if current.CiFixRetries < o.deps.Config.Workflow.MaxCiFixRetries {
						nextCI := current.CiFixRetries + 1
						fixing, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusCiFixing, "github-ci", fmt.Sprintf("Remote CI failed (%s)", strings.Join(names, ", ")), &db.TaskPatch{CiFixRetries: &nextCI})
						o.emitNotification(ctx, domain.NotifyCiFailed, fixing, fmt.Sprintf("PR #%d 远程 CI 失败，正在自动拉取日志并自愈修复...", pr.Number))
						o.executePrFix(ctx, fixing.ID, "CI_FIXING", ciSummary)
						return
					}
					o.escalateNeedsHuman(ctx, current.ID, fmt.Sprintf("远程 CI 连续修复 %d 次仍失败：\n%s", o.deps.Config.Workflow.MaxCiFixRetries, ciSummary))
					return
				}

				allPassed := len(checkRuns) > 0
				for _, cr := range checkRuns {
					if cr.Status != "completed" || (cr.Conclusion != "success" && cr.Conclusion != "neutral") {
						allPassed = false
						break
					}
				}
				if allPassed && current.Status == domain.StatusPrOpen {
					ready, _ := o.deps.Repo.TransitionTask(current.ID, domain.StatusReadyToMerge, "github-ci", "All CI checks passed", nil)
					o.syncStatusCard(ctx, ready, nil)

					autoCfg := o.deps.Config.GitHub.AutoMergeLowRisk
					changedCount := 0
					if ready.WorktreePath != nil && *ready.WorktreePath != "" {
						if files, ferr := o.deps.Workspace.GetChangedFiles(ctx, *ready.WorktreePath); ferr == nil {
							changedCount = len(files)
						}
					}
					catAllowed := false
					if ready.Category != nil {
						for _, ac := range autoCfg.AllowedCategories {
							if ac == string(*ready.Category) {
								catAllowed = true
								break
							}
						}
					}
					score := 5
					if ready.ComplexityScore != nil {
						score = *ready.ComplexityScore
					}
					if autoCfg.Enabled && catAllowed && score <= autoCfg.MaxComplexity && changedCount <= autoCfg.MaxFilesChanged && ready.PrNumber != nil {
						o2, r2, _ := o.splitRepo(ready.RepoFullName)
						if mres, merr := o.deps.GitHub.MergePullRequest(ctx, o2, r2, *ready.PrNumber, autoCfg.MergeMethod, ""); merr == nil && mres.Merged {
							autoMerged, _ := o.deps.Repo.TransitionTask(ready.ID, domain.StatusMerged, "auto-merge", "Low-risk PR auto-merged after CI & Cross-Review passed", nil)
							o.syncStatusCard(ctx, autoMerged, nil)
							o.emitNotification(ctx, domain.NotifyMerged, autoMerged, fmt.Sprintf("低风险 PR #%d 已满足规则并自动合并", *ready.PrNumber))
							o.checkReleaseState(ctx, autoMerged.ID)
							return
						}
					}

					o.emitNotification(ctx, domain.NotifyReadyToMerge, ready, fmt.Sprintf("PR #%d CI 已全绿，可随时合并（或回复 /merge）", *ready.PrNumber))
				}
				return
			}

			if current.Status == domain.StatusMerged || current.Status == domain.StatusReleasePrOpen {
				o.checkReleaseState(ctx, current.ID)
			}
		}()
	}
	return checked, nil
}

func (o *Orchestrator) runPrFixLoop(ctx context.Context, taskID, mode, feedback string) {
	if err := o.acquireSem(ctx); err != nil {
		return
	}
	defer o.releaseSem()
	unlock := o.lockTask(taskID)
	defer unlock()
	o.executePrFix(ctx, taskID, mode, feedback)
}

func (o *Orchestrator) executePrFix(ctx context.Context, taskID, mode, feedback string) {
	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil {
		return
	}
	owner, repo, cfg := o.splitRepo(task.RepoFullName)
	baseBranch := "main"
	if cfg != nil && cfg.BaseBranch != "" {
		baseBranch = cfg.BaseBranch
	}
	branchName := fmt.Sprintf("dragonflow/issue-%d", task.IssueNumber)
	if task.BranchName != nil && *task.BranchName != "" {
		branchName = *task.BranchName
	}
	remoteURL := o.deps.Config.Workspace.LocalRepoUrlOverride
	if remoteURL == "" {
		remoteURL, _ = o.deps.GitHub.GetRepoCloneURL(ctx, owner, repo)
	}
	worktreePath := ""
	if task.WorktreePath != nil {
		worktreePath = *task.WorktreePath
	}
	if worktreePath == "" {
		worktreePath, err = o.deps.Workspace.CreateTaskWorkspace(ctx, task.ID, task.RepoFullName, remoteURL, branchName, baseBranch)
		if err != nil {
			o.escalateNeedsHuman(ctx, task.ID, "创建修复 Worktree 失败："+err.Error())
			return
		}
	}

	prNum := 0
	if task.PrNumber != nil {
		prNum = *task.PrNumber
	}
	prompt := strings.Join([]string{
		fmt.Sprintf("Fix PR #%d for Issue #%d (%s).", prNum, task.IssueNumber, task.IssueTitle),
		"Mode: " + mode,
		"Feedback / Logs to address:\n" + feedback,
		"Modify code cleanly and verify tests locally without running git push.",
	}, "\n\n")

	tried := make(map[string]bool)
	_, _, ok, errMsg := o.executeAgentWithFallback(ctx, task.ID, strings.ToLower(mode), worktreePath, branchName, prompt, tried)
	if !ok {
		o.escalateNeedsHuman(ctx, task.ID, errMsg)
		return
	}

	passed, reportMD, failureOut := o.runVerificationSuite(ctx, task.ID, worktreePath, cfg)
	label := "通过"
	if !passed {
		label = "失败"
	}
	_, _ = o.deps.Repo.SaveArtifact(task.ID, domain.ArtifactTestReport, fmt.Sprintf("PR 自愈修复验证 (%s)", label), reportMD, map[string]any{"passed": passed})
	if !passed {
		o.escalateNeedsHuman(ctx, task.ID, "PR 自愈修复后本地验证未通过：\n"+truncateStr(failureOut, 500))
		return
	}

	reasonLabel := "review feedback"
	if mode == "CI_FIXING" {
		reasonLabel = "CI failure"
	}
	if _, err := o.deps.Workspace.CommitAndPush(ctx, worktreePath, fmt.Sprintf("fix(issue-%d): address %s", task.IssueNumber, reasonLabel), branchName, !o.deps.GitHub.IsMock()); err != nil {
		o.escalateNeedsHuman(ctx, task.ID, "PR 修复提交推送失败："+err.Error())
		return
	}

	updated, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusPrOpen, "dragonflow", fmt.Sprintf("Pushed %s fix to PR #%d", mode, prNum), nil)
	o.syncStatusCard(ctx, updated, nil)
}

func (o *Orchestrator) checkReleaseState(ctx context.Context, taskID string) {
	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil {
		return
	}
	owner, repo, _ := o.splitRepo(task.RepoFullName)

	if task.Status == domain.StatusMerged {
		openPRs, err := o.deps.GitHub.ListPullRequests(ctx, owner, repo, "open")
		if err == nil {
			for _, pr := range openPRs {
				if strings.HasPrefix(pr.Title, o.deps.Config.Release.ReleasePrTitlePrefix) ||
					strings.HasPrefix(pr.HeadBranch, o.deps.Config.Release.ReleaseBranchPrefix) {
					t2, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusReleasePrOpen, "release-please", fmt.Sprintf("Release PR #%d opened", pr.Number), &db.TaskPatch{
						ReleasePrNumber: &pr.Number,
						ReleasePrURL:    &pr.URL,
					})
					task = &t2
					o.syncStatusCard(ctx, *task, nil)
					break
				}
			}
		}
	}

	releases, err := o.deps.GitHub.ListReleases(ctx, owner, repo)
	if err != nil {
		return
	}
	taskCreated, _ := time.Parse(time.RFC3339Nano, task.CreatedAt)
	for _, rel := range releases {
		if rel.Draft {
			continue
		}
		pubTime, err := time.Parse(time.RFC3339Nano, rel.PublishedAt)
		if err != nil {
			pubTime, _ = time.Parse(time.RFC3339, rel.PublishedAt)
		}
		if !pubTime.Before(taskCreated) && (task.Status == domain.StatusMerged || task.Status == domain.StatusReleasePrOpen) {
			released, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusReleased, "github-release", "Published release "+rel.TagName, &db.TaskPatch{
				ReleaseTag: &rel.TagName,
				ReleaseURL: &rel.URL,
			})
			o.syncStatusCard(ctx, released, nil)
			o.emitNotification(ctx, domain.NotifyReleased, released, fmt.Sprintf("已包含在版本 %s 中正式发布！", rel.TagName))
			break
		}
	}
}

func (o *Orchestrator) escalateNeedsHuman(ctx context.Context, taskID, reason string) {
	task, err := o.deps.Repo.GetTask(taskID)
	if err != nil || task == nil {
		return
	}
	owner, repo, _ := o.splitRepo(task.RepoFullName)
	_ = o.deps.GitHub.AddLabels(ctx, owner, repo, task.IssueNumber, []string{o.deps.Config.GitHub.NeedsHumanLabel})
	updated, _ := o.deps.Repo.TransitionTask(task.ID, domain.StatusNeedsHuman, "dragonflow", reason, &db.TaskPatch{LastError: &reason})
	o.syncStatusCard(ctx, updated, nil)
	o.emitNotification(ctx, domain.NotifyNeedsHuman, updated, reason)
}

func (o *Orchestrator) syncStatusCard(ctx context.Context, task domain.TaskRecord, tr *domain.TriageResult) {
	owner, repo, _ := o.splitRepo(task.RepoFullName)
	cat := "-"
	if task.Category != nil {
		cat = string(*task.Category)
	}
	comp := "-"
	if task.ComplexityScore != nil {
		comp = fmt.Sprintf("%d", *task.ComplexityScore)
	}
	assigned := "待分配"
	if task.AssignedAgent != nil {
		assigned = *task.AssignedAgent
	}
	reviewer := "待分配"
	if task.ReviewerAgent != nil {
		reviewer = *task.ReviewerAgent
	}

	lines := []string{
		"### 🐉 DragonFlow 自动化研发状态看板",
		"| 字段 | 当前值 |",
		"| :--- | :--- |",
		fmt.Sprintf("| **状态** | `%s` |", task.Status),
		fmt.Sprintf("| **研发流** | `%s` |", task.Tier),
		fmt.Sprintf("| **分类 / 复杂度** | `%s` / %s/5 |", cat, comp),
		fmt.Sprintf("| **执行 Agent** | `%s` (降级切换: %d 次) |", assigned, task.FallbackCount),
		fmt.Sprintf("| **Review Agent** | `%s` |", reviewer),
	}
	if task.PrURL != nil && task.PrNumber != nil {
		lines = append(lines, fmt.Sprintf("| **Pull Request** | [#%d](%s) |", *task.PrNumber, *task.PrURL))
	}
	if task.ReleasePrURL != nil && task.ReleasePrNumber != nil {
		lines = append(lines, fmt.Sprintf("| **Release PR** | [#%d](%s) |", *task.ReleasePrNumber, *task.ReleasePrURL))
	}
	if task.ReleaseTag != nil && task.ReleaseURL != nil {
		lines = append(lines, fmt.Sprintf("| **正式发布** | [%s](%s) |", *task.ReleaseTag, *task.ReleaseURL))
	}
	if task.RoutingRationale != nil && *task.RoutingRationale != "" {
		lines = append(lines, "", "> **路由理由**: "+*task.RoutingRationale)
	}
	if tr != nil && len(tr.ClarifyingQuestions) > 0 && task.Status == domain.StatusAwaitingInfo {
		lines = append(lines, "", "#### ❓ 需要补充以下信息后才能继续：")
		for _, q := range tr.ClarifyingQuestions {
			lines = append(lines, "- "+q)
		}
	}
	switch task.Status {
	case domain.StatusAwaitingTrigger:
		lines = append(lines, "", fmt.Sprintf("> 维护者可添加标签 `%s` 或回复 `/auto`（也可指定 `/auto claude`）启动自动研发。", o.deps.Config.GitHub.TriggerLabel))
	case domain.StatusAwaitingPlanApproval:
		if plan, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactPlan); plan != nil {
			lines = append(lines, "", "<details><summary>📋 点击展开技术方案与测试计划</summary>", "", plan.Content, "", "</details>")
		}
		lines = append(lines, "", "> 维护者请回复 `/approve` 确认并启动编码，或回复 `/reject <修改建议>` 修订方案。")
	case domain.StatusReadyToMerge:
		lines = append(lines, "", "> PR 检查已全部通过！请点击合并或回复 `/merge` 完成合入。")
	case domain.StatusNeedsHuman:
		if task.LastError != nil && *task.LastError != "" {
			lines = append(lines, "", fmt.Sprintf("> ⚠️ **需要人工介入**: %s\n> 可回复 `/retry` 重新执行。", *task.LastError))
		}
	}

	commentID, err := o.deps.GitHub.UpsertStatusCard(ctx, owner, repo, task.IssueNumber, strings.Join(lines, "\n"), task.StatusCommentID)
	if err == nil && (task.StatusCommentID == nil || *task.StatusCommentID != commentID) {
		_, _ = o.deps.Repo.UpdateTask(task.ID, db.TaskPatch{StatusCommentID: &commentID})
	}
}

func (o *Orchestrator) buildPrBody(task domain.TaskRecord, changedFiles []string) string {
	spec := ""
	if s, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactSpec); s != nil {
		spec = s.Content
	}
	review := ""
	if r, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactReview); r != nil {
		review = r.Content
	}
	testReport := ""
	if tr, _ := o.deps.Repo.GetLatestArtifact(task.ID, domain.ArtifactTestReport); tr != nil {
		testReport = tr.Content
	}
	agent := "agent"
	if task.AssignedAgent != nil {
		agent = *task.AssignedAgent
	}
	revAgent := "reviewer"
	if task.ReviewerAgent != nil {
		revAgent = *task.ReviewerAgent
	}

	blocks := []string{
		"## Summary",
		fmt.Sprintf("Automated implementation by **DragonFlow** (`%s`, tier=`%s`).", agent, task.Tier),
		fmt.Sprintf("Closes #%d", task.IssueNumber),
	}
	if len(changedFiles) > 0 {
		var lines []string
		for _, f := range changedFiles {
			lines = append(lines, fmt.Sprintf("- `%s`", f))
		}
		blocks = append(blocks, "### Changed Files\n"+strings.Join(lines, "\n"))
	}
	if spec != "" {
		blocks = append(blocks, spec)
	}
	if testReport != "" {
		blocks = append(blocks, fmt.Sprintf("<details><summary>Test Verification Report</summary>\n\n%s\n\n</details>", testReport))
	}
	if review != "" {
		blocks = append(blocks, fmt.Sprintf("<details><summary>Independent Cross-Review (%s)</summary>\n\n%s\n\n</details>", revAgent, review))
	}
	return strings.Join(blocks, "\n\n")
}

func formatReviewMarkdown(rev domain.CrossReviewResult, reviewerAgent string) string {
	conclusion := "❌ 需修改 (Changes Requested)"
	if rev.Approved {
		conclusion = "✅ 通过 (Approved)"
	}
	yn := func(v bool) string {
		if v {
			return "✅"
		}
		return "❌"
	}
	lines := []string{
		fmt.Sprintf("## 独立交叉 Review 报告 (`%s`)", reviewerAgent),
		"- **结论**: " + conclusion,
		"- **摘要**: " + rev.Summary,
		"",
		"### 检查清单",
		"- 满足验收标准: " + yn(rev.Checklist.AcceptanceCriteriaMet),
		"- 测试覆盖充分: " + yn(rev.Checklist.TestsAdequate),
		"- 无明显安全风险: " + yn(rev.Checklist.NoObviousSecurityRisks),
		"- 改动范围聚焦: " + yn(rev.Checklist.CleanScope),
	}
	if len(rev.Findings) > 0 {
		lines = append(lines, "", "### Review 发现问题")
		for _, f := range rev.Findings {
			loc := ""
			if f.File != "" {
				if f.Line != nil {
					loc = fmt.Sprintf("`%s:%d` ", f.File, *f.Line)
				} else {
					loc = fmt.Sprintf("`%s` ", f.File)
				}
			}
			sug := ""
			if f.Suggestion != "" {
				sug = fmt.Sprintf("（建议：%s）", f.Suggestion)
			}
			lines = append(lines, fmt.Sprintf("- **[%s]** %s%s%s", strings.ToUpper(f.Severity), loc, f.Message, sug))
		}
	}
	return strings.Join(lines, "\n")
}

func formatCommitPrefix(cat *domain.IssueCategory) string {
	if cat == nil {
		return "fix"
	}
	switch *cat {
	case domain.CategoryFeature:
		return "feat"
	case domain.CategoryDocs:
		return "docs"
	case domain.CategoryRefactor:
		return "refactor"
	case domain.CategoryChore:
		return "chore"
	default:
		return "fix"
	}
}

func toStringMap(v any) map[string]any {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func mapKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k, v := range m {
		if v {
			out = append(out, k)
		}
	}
	return out
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
