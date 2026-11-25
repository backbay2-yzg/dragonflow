package services

import (
	"github.com/dragonflow/desktop/internal/config"
	"github.com/dragonflow/desktop/internal/desktop"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type ConfigService struct {
	rt *desktop.Runtime
}

func NewConfigService(rt *desktop.Runtime) *ConfigService {
	return &ConfigService{rt: rt}
}

func (s *ConfigService) GetConfig() domain.SanitizedConfig {
	return config.SanitizeForUI(s.rt.ConfigMgr.Get(), s.rt.Vault)
}

func (s *ConfigService) SaveConfig(cfg domain.DragonFlowConfig) (domain.SanitizedConfig, error) {
	saved, err := s.rt.Reload(cfg)
	if err != nil {
		return domain.SanitizedConfig{}, err
	}
	return config.SanitizeForUI(saved, s.rt.Vault), nil
}

func (s *ConfigService) SwitchMode(mode string) (domain.SanitizedConfig, error) {
	cfg := s.rt.ConfigMgr.Get()
	if mode == "live" {
		cfg.Project.Mode = "live"
	} else {
		cfg.Project.Mode = "demo"
	}
	return s.SaveConfig(cfg)
}

func (s *ConfigService) ExportYAML() (string, error) {
	return s.rt.ConfigMgr.ExportYAML()
}

func (s *ConfigService) ImportYAML(yamlText string) (domain.SanitizedConfig, error) {
	parsed, err := config.ParseYAML(yamlText)
	if err != nil {
		return domain.SanitizedConfig{}, err
	}
	return s.SaveConfig(parsed)
}

func (s *ConfigService) GetSecretsStatus() []domain.SecretStatus {
	keys := secrets.CollectKnownSecretKeys(s.rt.ConfigMgr.Get())
	return s.rt.Vault.StatusesForKeys(keys)
}

func (s *ConfigService) SetSecret(key string, value string) ([]domain.SecretStatus, error) {
	if err := s.rt.Vault.Set(key, value); err != nil {
		return nil, err
	}
	s.rt.ReloadSecrets()
	return s.GetSecretsStatus(), nil
}

func (s *ConfigService) DeleteSecret(key string) ([]domain.SecretStatus, error) {
	if err := s.rt.Vault.Delete(key); err != nil {
		return nil, err
	}
	s.rt.ReloadSecrets()
	return s.GetSecretsStatus(), nil
}
