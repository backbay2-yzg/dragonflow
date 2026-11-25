package secrets

import (
	"path/filepath"
	"testing"
)

func TestSecretVaultRoundTripAndEnvFallback(t *testing.T) {
	tmp := t.TempDir()
	vaultPath := filepath.Join(tmp, "secrets.vault")

	v1, err := NewSecretVault(vaultPath)
	if err != nil {
		t.Fatalf("NewSecretVault failed: %v", err)
	}

	t.Setenv("DRAGONFLOW_TEST_ENV_KEY", "from-env")
	if got, ok := v1.Get("DRAGONFLOW_TEST_ENV_KEY"); !ok || got != "from-env" {
		t.Fatalf("expected env fallback, got %q ok=%v", got, ok)
	}
	if st := v1.Status("DRAGONFLOW_TEST_ENV_KEY"); !st.Configured || st.Source != "env" {
		t.Fatalf("expected env status, got %+v", st)
	}

	// Vault overrides env
	if err := v1.Set("DRAGONFLOW_TEST_ENV_KEY", "from-dpapi-vault"); err != nil {
		t.Fatalf("Set failed: %v", err)
	}
	if err := v1.Set("GITHUB_TOKEN", "ghp_secret_12345"); err != nil {
		t.Fatalf("Set GITHUB_TOKEN failed: %v", err)
	}

	// Reload from encrypted file on disk
	v2, err := NewSecretVault(vaultPath)
	if err != nil {
		t.Fatalf("reload NewSecretVault failed: %v", err)
	}
	if got, ok := v2.Get("DRAGONFLOW_TEST_ENV_KEY"); !ok || got != "from-dpapi-vault" {
		t.Fatalf("expected vault override after reload, got %q ok=%v", got, ok)
	}
	if st := v2.Status("DRAGONFLOW_TEST_ENV_KEY"); !st.Configured || st.Source != "vault" {
		t.Fatalf("expected vault source, got %+v", st)
	}
	if got, ok := v2.Get("GITHUB_TOKEN"); !ok || got != "ghp_secret_12345" {
		t.Fatalf("expected GITHUB_TOKEN after reload, got %q ok=%v", got, ok)
	}

	if err := v2.Delete("GITHUB_TOKEN"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if _, ok := v2.Get("GITHUB_TOKEN"); ok {
		t.Fatal("expected GITHUB_TOKEN deleted")
	}
}
