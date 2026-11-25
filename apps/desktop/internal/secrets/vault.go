package secrets

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/dragonflow/desktop/internal/domain"
)

type SecretVault struct {
	mu       sync.RWMutex
	filePath string
	items    map[string]string
}

func NewSecretVault(filePath string) (*SecretVault, error) {
	v := &SecretVault{
		filePath: filePath,
		items:    make(map[string]string),
	}
	if filePath != "" {
		if err := v.load(); err != nil {
			return nil, err
		}
	}
	return v, nil
}

func (v *SecretVault) load() error {
	raw, err := os.ReadFile(v.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	plain, err := decryptDPAPI(raw)
	if err != nil {
		return err
	}
	var parsed map[string]string
	if err := json.Unmarshal(plain, &parsed); err != nil {
		return err
	}
	if parsed != nil {
		v.items = parsed
	}
	return nil
}

func (v *SecretVault) persistLocked() error {
	if v.filePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(v.filePath), 0o755); err != nil {
		return err
	}
	plain, err := json.Marshal(v.items)
	if err != nil {
		return err
	}
	cipher, err := encryptDPAPI(plain)
	if err != nil {
		return err
	}
	tmp := v.filePath + ".tmp"
	if err := os.WriteFile(tmp, cipher, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, v.filePath)
}

func (v *SecretVault) Get(key string) (string, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", false
	}
	v.mu.RLock()
	val, ok := v.items[key]
	v.mu.RUnlock()
	if ok && val != "" {
		return val, true
	}
	if envVal := os.Getenv(key); envVal != "" {
		return envVal, true
	}
	return "", false
}

func (v *SecretVault) Set(key, value string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("secret key cannot be empty")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if value == "" {
		delete(v.items, key)
	} else {
		v.items[key] = value
	}
	return v.persistLocked()
}

func (v *SecretVault) Delete(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.items, key)
	return v.persistLocked()
}

func (v *SecretVault) Status(key string) domain.SecretStatus {
	key = strings.TrimSpace(key)
	v.mu.RLock()
	val, inVault := v.items[key]
	v.mu.RUnlock()
	if inVault && val != "" {
		return domain.SecretStatus{Key: key, Configured: true, Source: "vault"}
	}
	if os.Getenv(key) != "" {
		return domain.SecretStatus{Key: key, Configured: true, Source: "env"}
	}
	return domain.SecretStatus{Key: key, Configured: false, Source: "none"}
}

func (v *SecretVault) StatusesForKeys(keys []string) []domain.SecretStatus {
	seen := make(map[string]bool)
	unique := make([]string, 0, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(k)
		if k != "" && !seen[k] {
			seen[k] = true
			unique = append(unique, k)
		}
	}
	sort.Strings(unique)
	res := make([]domain.SecretStatus, 0, len(unique))
	for _, k := range unique {
		res = append(res, v.Status(k))
	}
	return res
}

func CollectKnownSecretKeys(cfg domain.DragonFlowConfig) []string {
	keys := []string{
		cfg.GitHub.TokenEnv,
		cfg.GitHub.WebhookSecretEnv,
		cfg.Llm.ApiKeyEnv,
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"GEMINI_API_KEY",
	}
	for _, ch := range cfg.Notifications.Channels {
		if ch.URLEnv != "" {
			keys = append(keys, ch.URLEnv)
		}
		if ch.SecretEnv != "" {
			keys = append(keys, ch.SecretEnv)
		}
		if ch.ChatIDEnv != "" {
			keys = append(keys, ch.ChatIDEnv)
		}
	}
	for _, a := range cfg.Agents {
		for _, k := range a.EnvAllowlist {
			if strings.Contains(strings.ToUpper(k), "KEY") ||
				strings.Contains(strings.ToUpper(k), "TOKEN") ||
				strings.Contains(strings.ToUpper(k), "SECRET") {
				keys = append(keys, k)
			}
		}
	}
	seen := make(map[string]bool)
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(k)
		if k != "" && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out
}
