package desktop

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/config"
	"github.com/dragonflow/desktop/internal/db"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/events"
	"github.com/dragonflow/desktop/internal/github"
	"github.com/dragonflow/desktop/internal/llm"
	"github.com/dragonflow/desktop/internal/notify"
	"github.com/dragonflow/desktop/internal/paths"
	"github.com/dragonflow/desktop/internal/router"
	"github.com/dragonflow/desktop/internal/secrets"
	"github.com/dragonflow/desktop/internal/triage"
	"github.com/dragonflow/desktop/internal/workflow"
	"github.com/dragonflow/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type Runtime struct {
	mu             sync.RWMutex
	Paths          paths.AppPaths
	ConfigMgr      *config.Manager
	Vault          *secrets.SecretVault
	EventBus       *events.EventBus
	ToastBridge    *notify.DesktopToastBridge
	WebhookServer  *github.WebhookServer

	Mode           string
	DBPath         string
	Database       *db.Database
	Repo           *db.Repository
	Registry       *adapters.Registry
	GitHub         github.GitHubClient
	LLM            llm.Client
	TriageService  *triage.IssueTriageService
	Router         *router.AgentRouter
	Workspace      workspace.WorkspaceRunner
	Notifier       *notify.Dispatcher
	Orchestrator   *workflow.Orchestrator
	Poller         *github.Poller
	WebhookHandler *github.WebhookHandler
	GitAvailable   bool

	ctx    context.Context
	cancel context.CancelFunc
}

func NewRuntime(appPaths paths.AppPaths, notifSvc *notifications.NotificationService, onFocusTask func(taskID string)) (*Runtime, error) {
	if err := appPaths.Ensure(); err != nil {
		return nil, err
	}
	cfgMgr, err := config.NewManager(appPaths)
	if err != nil {
		return nil, err
	}
	vault, err := secrets.NewSecretVault(appPaths.VaultPath())
	if err != nil {
		return nil, err
	}
	bus := events.NewEventBus()
	cfg := cfgMgr.Get()
	toast := notify.NewDesktopToastBridge(notifSvc, cfg.Desktop.NotificationsEnabled, cfg.Desktop.NotifyEvents, onFocusTask)

	rt := &Runtime{
		Paths:         appPaths,
		ConfigMgr:     cfgMgr,
		Vault:         vault,
		EventBus:      bus,
		ToastBridge:   toast,
		WebhookServer: github.NewWebhookServer(),
		GitAvailable:  workspace.IsGitAvailable(),
	}

	if err := rt.assembleLocked(cfg); err != nil {
		return nil, err
	}
	return rt, nil
}

func (r *Runtime) assembleLocked(cfg domain.DragonFlowConfig) error {
	mode := "live"
	if cfg.Project.Mode == "demo" {
		mode = "demo"
	}

	r.ctx, r.cancel = context.WithCancel(context.Background())

	dbPath := r.Paths.DBPath(mode)
	database, err := db.OpenDatabase(dbPath)
	if err != nil {
		return err
	}
	repo := db.NewRepository(database.SQL, r.EventBus)

	effectiveCfg := cfg
	var gh github.GitHubClient
	var ws workspace.WorkspaceRunner

	if mode == "demo" {
		demoDir := r.Paths.DemoDataDir()
		bareRepo, _ := workspace.EnsureDemoBareGitRepo(r.ctx, demoDir)
		effectiveCfg.Workspace.ReposRoot = r.Paths.ReposRoot("demo")
		effectiveCfg.Workspace.WorktreeRoot = r.Paths.WorktreeRoot("demo")
		effectiveCfg.Workspace.LocalRepoUrlOverride = bareRepo
		if len(effectiveCfg.GitHub.Repositories) == 0 {
			effectiveCfg.GitHub.Repositories = []domain.RepoConfig{
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
		}
		gh = github.NewInMemoryGitHubClient(bareRepo)
		if bareRepo != "" {
			ws = workspace.NewGitWorktreeRunner(effectiveCfg.Workspace.ReposRoot, effectiveCfg.Workspace.WorktreeRoot)
		} else {
			ws = workspace.NewLocalDemoWorkspaceRunner(effectiveCfg.Workspace.WorktreeRoot)
		}
	} else {
		token, _ := r.Vault.Get(effectiveCfg.GitHub.TokenEnv)
		gh = github.NewRESTGitHubClient(token)
		if effectiveCfg.Workspace.ReposRoot == "" {
			effectiveCfg.Workspace.ReposRoot = r.Paths.ReposRoot("live")
		}
		if effectiveCfg.Workspace.WorktreeRoot == "" {
			effectiveCfg.Workspace.WorktreeRoot = r.Paths.WorktreeRoot("live")
		}
		if effectiveCfg.Workspace.Runner == "docker" {
			ws = workspace.NewDockerSandboxRunner(
				effectiveCfg.Workspace.ReposRoot,
				effectiveCfg.Workspace.WorktreeRoot,
				effectiveCfg.Workspace.DockerImage,
				effectiveCfg.Workspace.DockerNetwork,
			)
		} else {
			ws = workspace.NewGitWorktreeRunner(effectiveCfg.Workspace.ReposRoot, effectiveCfg.Workspace.WorktreeRoot)
		}
	}

	reg := adapters.NewRegistry(effectiveCfg.Agents, r.EventBus, func(p domain.AgentProfile) adapters.CodingAgentAdapter {
		if mode == "demo" {
			force := p.ID == "claude" || p.ID == "codex" || p.ID == "qodercli" || p.ID == "gemini"
			return adapters.NewDemoOverlayAgentAdapter(p, r.Vault, force)
		}
		return adapters.NewCliCodingAgentAdapter(p, r.Vault)
	})

	var llmClient llm.Client
	if mode == "demo" {
		llmClient = llm.NewMockStructuredClient(nil)
	} else {
		llmClient = llm.NewDualChannelClient(effectiveCfg.Llm, reg, r.Vault)
	}

	triSvc := triage.NewIssueTriageService(llmClient, effectiveCfg.Workflow.QuickFixMaxComplexity)
	rtr := router.NewAgentRouter(effectiveCfg, reg, llmClient)

	r.ToastBridge.UpdateSettings(effectiveCfg.Desktop.NotificationsEnabled, effectiveCfg.Desktop.NotifyEvents)
	notifier := notify.NewDispatcher(effectiveCfg.Notifications.Channels, r.Vault, r.ToastBridge)

	orch := workflow.NewOrchestrator(workflow.OrchestratorDeps{
		Config:        effectiveCfg,
		Repo:          repo,
		GitHub:        gh,
		TriageService: triSvc,
		Router:        rtr,
		LLM:           llmClient,
		Registry:      reg,
		Workspace:     ws,
		Notifier:      notifier,
		EventBus:      r.EventBus,
	})

	webhookSecret, _ := r.Vault.Get(effectiveCfg.GitHub.WebhookSecretEnv)
	if webhookSecret == "" {
		webhookSecret = os.Getenv(effectiveCfg.GitHub.WebhookSecretEnv)
	}
	whHandler := github.NewWebhookHandler(orch, webhookSecret)
	poller := github.NewPoller(effectiveCfg, gh, repo, orch)

	if mode == "live" {
		hasEnabled := false
		for _, rep := range effectiveCfg.GitHub.Repositories {
			if rep.Enabled {
				hasEnabled = true
				break
			}
		}
		if hasEnabled {
			poller.Start(r.ctx)
		}
	}

	if effectiveCfg.Server.WebhookEnabled {
		_ = r.WebhookServer.Start(effectiveCfg.Server.Host, effectiveCfg.Server.Port, whHandler)
	}

	r.Mode = mode
	r.DBPath = dbPath
	r.Database = database
	r.Repo = repo
	r.Registry = reg
	r.GitHub = gh
	r.LLM = llmClient
	r.TriageService = triSvc
	r.Router = rtr
	r.Workspace = ws
	r.Notifier = notifier
	r.Orchestrator = orch
	r.Poller = poller
	r.WebhookHandler = whHandler

	go func() {
		ctx, cancel := context.WithTimeout(r.ctx, 15*time.Second)
		defer cancel()
		reg.ProbeAll(ctx)
	}()

	return nil
}

func (r *Runtime) teardownLocked() {
	if r.Poller != nil {
		r.Poller.Stop()
	}
	if r.WebhookServer != nil {
		r.WebhookServer.Stop()
	}
	if r.cancel != nil {
		r.cancel()
	}
	if r.Orchestrator != nil {
		r.Orchestrator.WaitForIdle()
	}
	if r.Database != nil {
		_ = r.Database.Close()
	}
}

func (r *Runtime) Reload(newCfg domain.DragonFlowConfig) (domain.DragonFlowConfig, error) {
	saved, err := r.ConfigMgr.Save(newCfg)
	if err != nil {
		return domain.DragonFlowConfig{}, err
	}

	r.mu.Lock()
	r.teardownLocked()
	r.GitAvailable = workspace.IsGitAvailable()
	err = r.assembleLocked(saved)
	r.mu.Unlock()
	if err != nil {
		return domain.DragonFlowConfig{}, err
	}

	r.EventBus.Emit(domain.AppEvent{
		Type:      "runtime:reloaded",
		Mode:      r.Mode,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return saved, nil
}

func (r *Runtime) ReloadSecrets() {
	cfg := r.ConfigMgr.Get()
	_, _ = r.Reload(cfg)
}

func (r *Runtime) Shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.teardownLocked()
}

func (r *Runtime) CurrentRepoFullName() string {
	cfg := r.ConfigMgr.Get()
	if len(cfg.GitHub.Repositories) > 0 {
		rep := cfg.GitHub.Repositories[0]
		return rep.Owner + "/" + rep.Repo
	}
	return "dragonflow-org/awesome-oss"
}

func (r *Runtime) GetTraySnapshot() (domain.TraySnapshot, error) {
	r.mu.RLock()
	repo := r.Repo
	reg := r.Registry
	mode := r.Mode
	r.mu.RUnlock()

	tasks, err := repo.ListTasks("", "")
	if err != nil {
		return domain.TraySnapshot{}, err
	}
	health := reg.ListHealth()
	avail := 0
	for _, h := range health {
		if h.Enabled && h.Available {
			avail++
		}
	}

	overview, err := repo.GetDashboardOverview(db.OverviewMeta{
		Mode:                 mode,
		RepoFullName:         r.CurrentRepoFullName(),
		AvailableAgentsCount: avail,
		TotalAgentsCount:     len(health),
	})
	if err != nil {
		return domain.TraySnapshot{}, err
	}

	pending := make([]domain.TaskRecord, 0)
	recent := make([]domain.TaskRecord, 0, 4)
	for _, t := range tasks {
		switch t.Status {
		case domain.StatusAwaitingPlanApproval, domain.StatusReadyToMerge, domain.StatusNeedsHuman, domain.StatusAwaitingTrigger:
			if len(pending) < 5 {
				pending = append(pending, t)
			}
		}
		if len(recent) < 4 {
			recent = append(recent, t)
		}
	}

	return domain.TraySnapshot{
		Mode:            mode,
		RepoFullName:    r.CurrentRepoFullName(),
		ActiveTasks:     overview.ActiveTasks,
		TotalTasks:      overview.TotalTasks,
		AvailableAgents: avail,
		TotalAgents:     len(health),
		PendingTasks:    pending,
		RecentTasks:     recent,
	}, nil
}
