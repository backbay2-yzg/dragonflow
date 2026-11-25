package db

import (
	"testing"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/events"
)

func TestRepositoryAndStateMachine(t *testing.T) {
	database, err := OpenDatabase(":memory:")
	if err != nil {
		t.Fatalf("OpenDatabase failed: %v", err)
	}
	defer database.Close()

	bus := events.NewEventBus()
	var emitted []string
	unsub := bus.Subscribe(func(ev domain.AppEvent) {
		emitted = append(emitted, ev.Type)
	})
	defer unsub()

	repo := NewRepository(database.SQL, bus)
	now := time.Now().UTC().Format(time.RFC3339)

	task, created, err := repo.UpsertTaskFromIssue("acme/oss", domain.GitHubIssue{
		Number:            42,
		Title:             "Fix memory leak in parser",
		Body:              "Steps to reproduce...",
		Author:            "alice",
		AuthorAssociation: "NONE",
		Labels:            []string{"bug"},
		State:             "open",
		URL:               "https://github.com/acme/oss/issues/42",
		CreatedAt:         now,
		UpdatedAt:         now,
	})
	if err != nil || !created || task.Status != domain.StatusNew {
		t.Fatalf("unexpected UpsertTaskFromIssue: task=%+v created=%v err=%v", task, created, err)
	}

	t1, err := repo.TransitionTask(task.ID, domain.StatusTriaging, "dragonflow", "Start triage", nil)
	if err != nil || t1.Status != domain.StatusTriaging {
		t.Fatalf("TransitionTask to TRIAGING failed: %v", err)
	}

	if _, err := repo.TransitionTask(task.ID, domain.StatusReleased, "dragonflow", "Invalid jump", nil); err == nil {
		t.Fatal("expected invalid state transition error")
	}

	if _, err := repo.TransitionTask(task.ID, domain.StatusRouting, "dragonflow", "Owner fast-track", nil); err != nil {
		t.Fatalf("TransitionTask ROUTING failed: %v", err)
	}
	claude := "claude"
	qoder := "qodercli"
	if _, err := repo.TransitionTask(task.ID, domain.StatusImplementing, "router", "Quick fix", &TaskPatch{
		AssignedAgent: &claude,
		ReviewerAgent: &qoder,
	}); err != nil {
		t.Fatalf("TransitionTask IMPLEMENTING failed: %v", err)
	}

	run, err := repo.CreateRun(task.ID, "implementing", "claude", 1)
	if err != nil {
		t.Fatalf("CreateRun failed: %v", err)
	}
	if _, err := repo.AppendLog(task.ID, run.ID, "stdout", "Editing src/parser.ts"); err != nil {
		t.Fatalf("AppendLog failed: %v", err)
	}
	summary := "Fixed buffer cleanup"
	if _, err := repo.FinishRun(run.ID, FinishRunResult{
		Status:     "succeeded",
		ErrorKind:  domain.ErrKindNone,
		TokensUsed: 1200,
		CostUsd:    0.02,
		Summary:    &summary,
	}); err != nil {
		t.Fatalf("FinishRun failed: %v", err)
	}

	if _, err := repo.SaveArtifact(task.ID, domain.ArtifactSpec, "Quick Spec", "# Spec", nil); err != nil {
		t.Fatalf("SaveArtifact failed: %v", err)
	}

	audits, err := repo.ListAuditEvents(task.ID)
	if err != nil || len(audits) != 4 {
		t.Fatalf("expected 4 audit events, got %d err=%v", len(audits), err)
	}
	logs, err := repo.ListLogs(task.ID, 100, 0)
	if err != nil || len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d err=%v", len(logs), err)
	}
	artifacts, err := repo.ListArtifacts(task.ID)
	if err != nil || len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got %d err=%v", len(artifacts), err)
	}
	loadedTask, err := repo.GetTask(task.ID)
	if err != nil || loadedTask.TotalTokens != 1200 {
		t.Fatalf("expected TotalTokens=1200, got %+v err=%v", loadedTask, err)
	}

	overview, err := repo.GetDashboardOverview(OverviewMeta{
		Mode:                 "demo",
		RepoFullName:         "acme/oss",
		AvailableAgentsCount: 2,
		TotalAgentsCount:     8,
	})
	if err != nil {
		t.Fatalf("GetDashboardOverview failed: %v", err)
	}
	if overview.TotalTasks != 1 || overview.ActiveTasks != 1 || overview.ByAgent["claude"] != 1 {
		t.Fatalf("unexpected overview: %+v", overview)
	}

	hasTransition, hasLog := false, false
	for _, ev := range emitted {
		if ev == "task:transitioned" {
			hasTransition = true
		}
		if ev == "log:chunk" {
			hasLog = true
		}
	}
	if !hasTransition || !hasLog {
		t.Fatalf("expected task:transitioned and log:chunk events, got %v", emitted)
	}
}
