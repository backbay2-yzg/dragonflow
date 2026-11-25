package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/db"
	"github.com/dragonflow/desktop/internal/desktop"
	"github.com/dragonflow/desktop/internal/domain"
)

type DashboardService struct {
	rt *desktop.Runtime
}

func NewDashboardService(rt *desktop.Runtime) *DashboardService {
	return &DashboardService{rt: rt}
}

func (s *DashboardService) GetOverview() (domain.DashboardOverview, error) {
	health := s.rt.Registry.ListHealth()
	avail := 0
	for _, h := range health {
		if h.Enabled && h.Available {
			avail++
		}
	}
	return s.rt.Repo.GetDashboardOverview(db.OverviewMeta{
		Mode:                 s.rt.Mode,
		RepoFullName:         s.rt.CurrentRepoFullName(),
		AvailableAgentsCount: avail,
		TotalAgentsCount:     len(health),
	})
}

func (s *DashboardService) ListTasks(status string, search string) ([]domain.TaskRecord, error) {
	return s.rt.Repo.ListTasks(status, search)
}

func (s *DashboardService) GetTaskDetail(taskID string) (domain.TaskDetailResponse, error) {
	task, err := s.rt.Repo.GetTask(taskID)
	if err != nil {
		return domain.TaskDetailResponse{}, err
	}
	if task == nil {
		return domain.TaskDetailResponse{}, fmt.Errorf("Task not found: %s", taskID)
	}
	runs, err := s.rt.Repo.ListRuns(taskID)
	if err != nil {
		return domain.TaskDetailResponse{}, err
	}
	artifacts, err := s.rt.Repo.ListArtifacts(taskID)
	if err != nil {
		return domain.TaskDetailResponse{}, err
	}
	audits, err := s.rt.Repo.ListAuditEvents(taskID)
	if err != nil {
		return domain.TaskDetailResponse{}, err
	}
	return domain.TaskDetailResponse{
		Task:        *task,
		Runs:        runs,
		Artifacts:   artifacts,
		AuditEvents: audits,
	}, nil
}

func (s *DashboardService) GetTaskLogs(taskID string, limit int, afterID int64) ([]domain.TaskLogEntry, error) {
	task, err := s.rt.Repo.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("Task not found: %s", taskID)
	}
	return s.rt.Repo.ListLogs(taskID, limit, afterID)
}

func (s *DashboardService) TriggerTask(taskID string, agentID string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.TriggerTask(context.Background(), taskID, agentID, "dashboard", false)
}

func (s *DashboardService) ApprovePlan(taskID string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.ApprovePlan(context.Background(), taskID, "dashboard", false)
}

func (s *DashboardService) RejectPlan(taskID string, feedback string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.RejectPlan(context.Background(), taskID, feedback, "dashboard")
}

func (s *DashboardService) RetryTask(taskID string, agentID string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.RetryTask(context.Background(), taskID, agentID, "dashboard", false)
}

func (s *DashboardService) MergeTask(taskID string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.MergeTaskPr(context.Background(), taskID, "dashboard")
}

func (s *DashboardService) CancelTask(taskID string) (domain.TaskRecord, error) {
	return s.rt.Orchestrator.CancelTask(context.Background(), taskID, "dashboard")
}

func (s *DashboardService) SyncNow() (domain.SyncResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if s.rt.Poller != nil && s.rt.Mode == "live" {
		return s.rt.Poller.SyncOnce(ctx)
	}
	prsChecked, err := s.rt.Orchestrator.PollOpenPrs(ctx, "")
	return domain.SyncResult{
		Synced:          err == nil,
		IssuesProcessed: 0,
		PrsChecked:      prsChecked,
	}, err
}

func (s *DashboardService) SimulateIssue(input domain.SimulateIssueInput) (domain.SimulateIssueResult, error) {
	return s.rt.Orchestrator.SimulateDemoIssue(context.Background(), input)
}

func (s *DashboardService) GetTraySnapshot() (domain.TraySnapshot, error) {
	return s.rt.GetTraySnapshot()
}

var _ sync.Locker
