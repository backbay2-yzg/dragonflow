package github

import (
	"context"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/db"
	"github.com/dragonflow/desktop/internal/domain"
)

type PollerOrchestratorTarget interface {
	IngestIssue(ctx context.Context, repoFullName string, issue domain.GitHubIssue) (domain.TaskRecord, error)
	HandleComment(ctx context.Context, repoFullName string, issueNumber int, comment domain.GitHubComment) (*domain.TaskRecord, error)
	PollOpenPrs(ctx context.Context, repoFullNameFilter string) (int, error)
}

type Poller struct {
	mu           sync.Mutex
	cfg          domain.DragonFlowConfig
	gh           GitHubClient
	repo         *db.Repository
	orchestrator PollerOrchestratorTarget
	stopCh       chan struct{}
	doneCh       chan struct{}
	syncing      bool
}

func NewPoller(cfg domain.DragonFlowConfig, gh GitHubClient, repo *db.Repository, orch PollerOrchestratorTarget) *Poller {
	return &Poller{
		cfg:          cfg,
		gh:           gh,
		repo:         repo,
		orchestrator: orch,
	}
}

func (p *Poller) Start(ctx context.Context) {
	p.mu.Lock()
	if p.stopCh != nil {
		p.mu.Unlock()
		return
	}
	intervalSec := p.cfg.GitHub.PollIntervalSec
	if intervalSec < 5 {
		intervalSec = 5
	}
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	p.stopCh = stopCh
	p.doneCh = doneCh
	p.mu.Unlock()

	go func() {
		defer close(doneCh)
		ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = p.SyncOnce(ctx)
			}
		}
	}()
}

func (p *Poller) Stop() {
	p.mu.Lock()
	stopCh := p.stopCh
	doneCh := p.doneCh
	p.stopCh = nil
	p.doneCh = nil
	p.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if doneCh != nil {
		<-doneCh
	}
}

func (p *Poller) SyncOnce(ctx context.Context) (domain.SyncResult, error) {
	p.mu.Lock()
	if p.syncing {
		p.mu.Unlock()
		return domain.SyncResult{Synced: true}, nil
	}
	p.syncing = true
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		p.syncing = false
		p.mu.Unlock()
	}()

	issuesProcessed := 0
	prsChecked := 0

	for _, r := range p.cfg.GitHub.Repositories {
		if !r.Enabled {
			continue
		}
		fullName := r.Owner + "/" + r.Repo
		issues, err := p.gh.ListOpenIssues(ctx, r.Owner, r.Repo, "")
		if err != nil {
			return domain.SyncResult{Synced: false, IssuesProcessed: issuesProcessed, PrsChecked: prsChecked}, err
		}

		for _, issue := range issues {
			if _, err := p.orchestrator.IngestIssue(ctx, fullName, issue); err != nil {
				continue
			}
			comments, err := p.gh.ListIssueComments(ctx, r.Owner, r.Repo, issue.Number)
			if err == nil {
				for _, cm := range comments {
					_, _ = p.orchestrator.HandleComment(ctx, fullName, issue.Number, cm)
				}
			}
			issuesProcessed++
		}

		n, _ := p.orchestrator.PollOpenPrs(ctx, fullName)
		prsChecked += n
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_ = p.repo.SavePollerState(fullName, db.PollerState{
			LastIssuePollAt: now,
			LastPrPollAt:    now,
		})
	}

	return domain.SyncResult{
		Synced:          true,
		IssuesProcessed: issuesProcessed,
		PrsChecked:      prsChecked,
	}, nil
}
