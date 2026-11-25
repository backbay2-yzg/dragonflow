package adapters

import (
	"context"
	"strings"
	"testing"

	"github.com/dragonflow/desktop/internal/domain"
)

func TestProcessRunnerAndAdapters(t *testing.T) {
	goPath := ResolveExecutable("go")
	if goPath == "" {
		t.Fatal("expected go executable to resolve on PATH")
	}

	var logged []string
	stdinPayload := `hello "dragon" & $(whoami)`
	res, err := RunSubprocess(context.Background(), SubprocessOptions{
		Command:   "go",
		Args:      []string{"version"},
		TimeoutMs: 8000,
		StdinText: &stdinPayload,
		OnLog: func(stream, line string) {
			logged = append(logged, stream+":"+line)
		},
	})
	if err != nil {
		t.Fatalf("RunSubprocess failed: %v", err)
	}
	if res.ExitCode != 0 || res.TimedOut || !strings.Contains(res.Stdout, "go version") {
		t.Fatalf("unexpected RunSubprocess result: %+v", res)
	}

	if ClassifyAgentError(1, "", "Error: insufficient_quota for org", false, nil) != domain.ErrKindQuotaExceeded {
		t.Fatal("expected quota_exceeded")
	}
	if ClassifyAgentError(1, "", "HTTP 429 rate limit exceeded", false, nil) != domain.ErrKindRateLimited {
		t.Fatal("expected rate_limited")
	}
	if ClassifyAgentError(1, "", "401 Unauthorized: invalid api key", false, nil) != domain.ErrKindAuthFailed {
		t.Fatal("expected auth_failed")
	}
	if ClassifyAgentError(0, "", "", true, nil) != domain.ErrKindTimeout {
		t.Fatal("expected timeout")
	}
	if ClassifyAgentError(1, "MY_CUSTOM_QUOTA_ERR", "", false, []string{"MY_CUSTOM_QUOTA_ERR"}) != domain.ErrKindQuotaExceeded {
		t.Fatal("expected custom quota error")
	}

	adapter := NewCliCodingAgentAdapter(domain.AgentProfile{
		ID:         "custom-bot",
		Type:       domain.AgentTemplate,
		Command:    "my-cli",
		Args:       []string{"--extra"},
		Model:      "deepseek-coder",
		PromptMode: "file",
		Template: &domain.AgentTemplateConfig{
			ArgsTemplate: []string{"run", "--cwd", "{{cwd}}", "--model", "{model}", "--file", "{{promptFile}}"},
		},
	}, nil)

	args, stdinPtr := adapter.BuildCommandArgs(AgentExecContext{
		Cwd:    `D:\repo`,
		Prompt: "Fix bug",
	}, `C:\temp\prompt.md`)
	if stdinPtr != nil {
		t.Fatal("expected nil stdin for file promptMode")
	}
	expected := []string{"run", "--cwd", `D:\repo`, "--model", "deepseek-coder", "--file", `C:\temp\prompt.md`, "--extra"}
	if strings.Join(args, "|") != strings.Join(expected, "|") {
		t.Fatalf("unexpected template args: got %v want %v", args, expected)
	}
}
