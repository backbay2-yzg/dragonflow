package config

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/paths"
	"github.com/dragonflow/desktop/internal/secrets"
	"gopkg.in/yaml.v3"
)

func MergeAgentProfiles(configured []domain.AgentProfile) []domain.AgentProfile {
	presets := DefaultAgentPresets()
	byID := make(map[string]domain.AgentProfile, len(presets)+len(configured))
	order := make([]string, 0, len(presets)+len(configured))

	for _, p := range presets {
		byID[p.ID] = p
		order = append(order, p.ID)
	}

	for _, agent := range configured {
		existing, ok := byID[agent.ID]
		if !ok {
			if agent.Args == nil {
				agent.Args = []string{}
			}
			if agent.Strengths == nil {
				agent.Strengths = []string{}
			}
			if agent.EnvAllowlist == nil {
				agent.EnvAllowlist = []string{}
			}
			if agent.TimeoutSec <= 0 {
				agent.TimeoutSec = 900
			}
			if agent.PromptMode == "" {
				agent.PromptMode = "stdin"
			}
			if agent.OutputMode == "" {
				agent.OutputMode = "text"
			}
			if agent.CostTier == "" {
				agent.CostTier = "medium"
			}
			byID[agent.ID] = agent
			order = append(order, agent.ID)
			continue
		}
		merged := agent
		if len(merged.Args) == 0 {
			merged.Args = existing.Args
		}
		if len(merged.Strengths) == 0 {
			merged.Strengths = existing.Strengths
		}
		if len(merged.EnvAllowlist) == 0 {
			merged.EnvAllowlist = existing.EnvAllowlist
		}
		if merged.TimeoutSec <= 0 {
			merged.TimeoutSec = existing.TimeoutSec
		}
		if merged.PromptMode == "" {
			merged.PromptMode = existing.PromptMode
		}
		if merged.OutputMode == "" {
			merged.OutputMode = existing.OutputMode
		}
		if merged.CostTier == "" {
			merged.CostTier = existing.CostTier
		}
		if merged.MaxBudgetUsd == nil {
			merged.MaxBudgetUsd = existing.MaxBudgetUsd
		}
		byID[agent.ID] = merged
	}

	result := make([]domain.AgentProfile, 0, len(order))
	for _, id := range order {
		result = append(result, byID[id])
	}
	return result
}

func ParseYAML(yamlContent string) (domain.DragonFlowConfig, error) {
	cfg := domain.DefaultConfig()
	if err := yaml.Unmarshal([]byte(yamlContent), &cfg); err != nil {
		return domain.DragonFlowConfig{}, err
	}
	cfg.ApplyDefaults()
	cfg.Agents = MergeAgentProfiles(cfg.Agents)
	if err := cfg.Validate(); err != nil {
		return domain.DragonFlowConfig{}, err
	}
	return cfg, nil
}

func SanitizeForUI(cfg domain.DragonFlowConfig, vault *secrets.SecretVault) domain.SanitizedConfig {
	tokenConfigured := false
	webhookConfigured := false
	apiKeyConfigured := false
	if vault != nil {
		_, tokenConfigured = vault.Get(cfg.GitHub.TokenEnv)
		_, webhookConfigured = vault.Get(cfg.GitHub.WebhookSecretEnv)
		_, apiKeyConfigured = vault.Get(cfg.Llm.ApiKeyEnv)
	}
	return domain.SanitizedConfig{
		Project: cfg.Project,
		GitHub: domain.SanitizedGitHubConfig{
			GitHubConfig:            cfg.GitHub,
			TokenConfigured:         tokenConfigured,
			WebhookSecretConfigured: webhookConfigured,
		},
		Llm: domain.SanitizedLlmConfig{
			LlmConfig:        cfg.Llm,
			ApiKeyConfigured: apiKeyConfigured,
		},
		Agents:        cfg.Agents,
		Routing:       cfg.Routing,
		Workflow:      cfg.Workflow,
		Release:       cfg.Release,
		Workspace:     cfg.Workspace,
		Notifications: cfg.Notifications,
		Server:        cfg.Server,
		Desktop:       cfg.Desktop,
	}
}

type Manager struct {
	mu            sync.RWMutex
	paths         paths.AppPaths
	cfg           domain.DragonFlowConfig
	isFirstLaunch bool
}

func NewManager(appPaths paths.AppPaths) (*Manager, error) {
	if err := appPaths.Ensure(); err != nil {
		return nil, err
	}
	m := &Manager{paths: appPaths}
	if err := m.LoadOrInit(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) LoadOrInit() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfgPath := m.paths.ConfigPath()
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		def := DefaultDesktopConfig(m.paths.DataDir)
		if err := m.writeLocked(def); err != nil {
			return err
		}
		m.cfg = def
		m.isFirstLaunch = true
		return nil
	}

	parsed, err := ParseYAML(string(raw))
	if err != nil {
		return err
	}
	if parsed.Project.DataDir == "" {
		parsed.Project.DataDir = m.paths.DataDir
	}
	if parsed.Workspace.ReposRoot == "" {
		parsed.Workspace.ReposRoot = m.paths.ReposRoot(parsed.Project.Mode)
	}
	if parsed.Workspace.WorktreeRoot == "" {
		parsed.Workspace.WorktreeRoot = m.paths.WorktreeRoot(parsed.Project.Mode)
	}
	m.cfg = parsed
	m.isFirstLaunch = false
	return nil
}

func (m *Manager) writeLocked(cfg domain.DragonFlowConfig) error {
	if err := os.MkdirAll(filepath.Dir(m.paths.ConfigPath()), 0o755); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	tmp := m.paths.ConfigPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, m.paths.ConfigPath())
}

func (m *Manager) Get() domain.DragonFlowConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) IsFirstLaunch() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.isFirstLaunch
}

func (m *Manager) Save(cfg domain.DragonFlowConfig) (domain.DragonFlowConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cfg.ApplyDefaults()
	cfg.Agents = MergeAgentProfiles(cfg.Agents)
	if cfg.Project.DataDir == "" {
		cfg.Project.DataDir = m.paths.DataDir
	}
	if cfg.Workspace.ReposRoot == "" {
		cfg.Workspace.ReposRoot = m.paths.ReposRoot(cfg.Project.Mode)
	}
	if cfg.Workspace.WorktreeRoot == "" {
		cfg.Workspace.WorktreeRoot = m.paths.WorktreeRoot(cfg.Project.Mode)
	}
	if err := cfg.Validate(); err != nil {
		return domain.DragonFlowConfig{}, err
	}
	if err := m.writeLocked(cfg); err != nil {
		return domain.DragonFlowConfig{}, err
	}
	m.cfg = cfg
	return cfg, nil
}

func (m *Manager) ExportYAML() (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	b, err := yaml.Marshal(m.cfg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (m *Manager) ImportYAML(yamlText string) (domain.DragonFlowConfig, error) {
	parsed, err := ParseYAML(yamlText)
	if err != nil {
		return domain.DragonFlowConfig{}, err
	}
	return m.Save(parsed)
}
