package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dragonflow/desktop/internal/paths"
	"github.com/dragonflow/desktop/internal/secrets"
)

func TestConfigManagerInitAndSanitize(t *testing.T) {
	tmp := t.TempDir()
	appPaths := paths.NewAppPathsForDir(tmp, true)

	mgr, err := NewManager(appPaths)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}
	if !mgr.IsFirstLaunch() {
		t.Fatal("expected first launch true when yaml does not exist")
	}
	if _, err := os.Stat(appPaths.ConfigPath()); err != nil {
		t.Fatalf("expected dragonflow.yaml created: %v", err)
	}

	cfg := mgr.Get()
	if cfg.Project.Mode != "demo" {
		t.Fatalf("expected default mode=demo, got %q", cfg.Project.Mode)
	}
	if len(cfg.Agents) != 8 {
		t.Fatalf("expected 8 preset agents, got %d", len(cfg.Agents))
	}

	// Reload should mark first launch false
	mgr2, err := NewManager(appPaths)
	if err != nil {
		t.Fatalf("reload NewManager failed: %v", err)
	}
	if mgr2.IsFirstLaunch() {
		t.Fatal("expected first launch false on subsequent load")
	}

	vault, err := secrets.NewSecretVault(filepath.Join(tmp, "secrets.vault"))
	if err != nil {
		t.Fatalf("NewSecretVault failed: %v", err)
	}
	_ = vault.Set("GITHUB_TOKEN", "ghp_abc")
	sanitized := SanitizeForUI(mgr2.Get(), vault)
	if !sanitized.GitHub.TokenConfigured || sanitized.Llm.ApiKeyConfigured {
		t.Fatalf("unexpected sanitized secret flags: %+v %+v", sanitized.GitHub.TokenConfigured, sanitized.Llm.ApiKeyConfigured)
	}

	yamlText, err := mgr2.ExportYAML()
	if err != nil || yamlText == "" {
		t.Fatalf("ExportYAML failed: %v", err)
	}
	if _, err := mgr2.ImportYAML(yamlText); err != nil {
		t.Fatalf("ImportYAML failed: %v", err)
	}
}
