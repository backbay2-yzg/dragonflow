package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type AgentExecContext struct {
	TaskID     string
	RunID      string
	Stage      string
	Cwd        string
	Prompt     string
	BranchName string
	ReadOnly   bool
	OnLog      func(stream, message string)
}

type AgentExecResult struct {
	Success    bool
	OutputText string
	RawStdout  string
	RawStderr  string
	ExitCode   int
	ErrorKind  domain.AgentErrorKind
	TokensUsed int
	CostUsd    float64
	DurationMs int64
}

type CodingAgentAdapter interface {
	ID() string
	Profile() domain.AgentProfile
	Probe(ctx context.Context) domain.AgentHealthInfo
	Execute(ctx context.Context, execCtx AgentExecContext) AgentExecResult
}

func parseClaudeStreamJSON(rawStdout string) (string, int, float64) {
	finalResult := ""
	var textParts []string
	tokensUsed := 0
	costUsd := 0.0

	for _, line := range strings.Split(rawStdout, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "{") {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
			continue
		}
		typ, _ := obj["type"].(string)
		switch typ {
		case "assistant":
			if msg, ok := obj["message"].(map[string]any); ok {
				if content, ok := msg["content"].([]any); ok {
					for _, rawBlock := range content {
						if block, ok := rawBlock.(map[string]any); ok {
							if bt, _ := block["type"].(string); bt == "text" {
								if txt, ok := block["text"].(string); ok && txt != "" {
									textParts = append(textParts, txt)
								}
							}
						}
					}
				}
			}
		case "result":
			if r, ok := obj["result"].(string); ok {
				finalResult = r
			}
			if c, ok := obj["total_cost_usd"].(float64); ok {
				costUsd = c
			}
			if usage, ok := obj["usage"].(map[string]any); ok {
				inp, _ := usage["input_tokens"].(float64)
				out, _ := usage["output_tokens"].(float64)
				tokensUsed = int(inp + out)
			}
		}
	}

	text := finalResult
	if text == "" {
		text = strings.Join(textParts, "\n")
	}
	if text == "" {
		text = rawStdout
	}
	return text, tokensUsed, costUsd
}

func parseGenericJSONOutput(rawStdout string) (string, int, float64) {
	trimmed := strings.TrimSpace(rawStdout)
	var obj map[string]any
	if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
		return trimmed, 0, 0
	}
	text := ""
	for _, key := range []string{"result", "response", "message", "content"} {
		if s, ok := obj[key].(string); ok && s != "" {
			text = s
			break
		}
	}
	if text == "" {
		text = trimmed
	}
	tokens := 0
	if t, ok := obj["total_tokens"].(float64); ok {
		tokens = int(t)
	} else if t, ok := obj["tokens"].(float64); ok {
		tokens = int(t)
	}
	costUsd, _ := obj["total_cost_usd"].(float64)
	return text, tokens, costUsd
}

type CliCodingAgentAdapter struct {
	profile domain.AgentProfile
	vault   *secrets.SecretVault
}

func NewCliCodingAgentAdapter(profile domain.AgentProfile, vault *secrets.SecretVault) *CliCodingAgentAdapter {
	return &CliCodingAgentAdapter{profile: profile, vault: vault}
}

func (a *CliCodingAgentAdapter) ID() string                    { return a.profile.ID }
func (a *CliCodingAgentAdapter) Profile() domain.AgentProfile  { return a.profile }

func (a *CliCodingAgentAdapter) Probe(ctx context.Context) domain.AgentHealthInfo {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	info := domain.AgentHealthInfo{
		ID:            a.profile.ID,
		DisplayName:   a.profile.DisplayName,
		Type:          string(a.profile.Type),
		Enabled:       a.profile.Enabled,
		Available:     false,
		Command:       a.profile.Command,
		Strengths:     append([]string{}, a.profile.Strengths...),
		CostTier:      a.profile.CostTier,
		LastCheckedAt: now,
	}
	if info.Strengths == nil {
		info.Strengths = []string{}
	}
	if !a.profile.Enabled {
		info.Error = "Disabled in config"
		return info
	}

	resolved := ResolveExecutable(a.profile.Command)
	if resolved == "" {
		info.Error = fmt.Sprintf("Command %q not found on PATH", a.profile.Command)
		return info
	}
	info.ResolvedPath = resolved

	versionArgs := []string{"--version"}
	if a.profile.Template != nil && len(a.profile.Template.VersionArgs) > 0 {
		versionArgs = a.profile.Template.VersionArgs
	}
	cwd, _ := os.Getwd()
	res, err := RunSubprocess(ctx, SubprocessOptions{
		Command:      resolved,
		Args:         versionArgs,
		Cwd:          cwd,
		TimeoutMs:    8000,
		EnvAllowlist: a.profile.EnvAllowlist,
		Vault:        a.vault,
	})
	if err != nil {
		info.Error = err.Error()
		return info
	}
	raw := strings.TrimSpace(res.Stdout)
	if raw == "" {
		raw = strings.TrimSpace(res.Stderr)
	}
	firstLine := strings.TrimSpace(strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")[0])
	if firstLine == "" {
		firstLine = "detected"
	}
	info.Available = true
	info.Version = firstLine
	return info
}

func (a *CliCodingAgentAdapter) BuildCommandArgs(execCtx AgentExecContext, promptFilePath string) ([]string, *string) {
	extra := append([]string{}, a.profile.Args...)

	if a.profile.Type == domain.AgentTemplate && a.profile.Template != nil {
		interpolated := make([]string, 0, len(a.profile.Template.ArgsTemplate)+len(extra))
		replacer := strings.NewReplacer(
			"{{prompt}}", execCtx.Prompt,
			"{prompt}", execCtx.Prompt,
			"{{promptFile}}", promptFilePath,
			"{promptFile}", promptFilePath,
			"{{cwd}}", execCtx.Cwd,
			"{workDir}", execCtx.Cwd,
			"{cwd}", execCtx.Cwd,
			"{{model}}", a.profile.Model,
			"{model}", a.profile.Model,
			"{{branch}}", execCtx.BranchName,
			"{branch}", execCtx.BranchName,
		)
		for _, tok := range a.profile.Template.ArgsTemplate {
			val := replacer.Replace(tok)
			if val != "" {
				interpolated = append(interpolated, val)
			}
		}
		interpolated = append(interpolated, extra...)
		var stdinPtr *string
		if a.profile.PromptMode == "stdin" {
			p := execCtx.Prompt
			stdinPtr = &p
		}
		return interpolated, stdinPtr
	}

	p := execCtx.Prompt
	switch a.profile.Type {
	case domain.AgentClaude:
		outFmt := "stream-json"
		if a.profile.OutputMode == "text" {
			outFmt = "text"
		}
		args := []string{"-p", "--output-format", outFmt}
		if a.profile.OutputMode != "text" {
			args = append(args, "--verbose")
		}
		permMode := "bypassPermissions"
		if execCtx.ReadOnly {
			permMode = "plan"
		}
		args = append(args, "--permission-mode", permMode)
		if a.profile.Model != "" {
			args = append(args, "--model", a.profile.Model)
		}
		if a.profile.MaxBudgetUsd != nil && *a.profile.MaxBudgetUsd > 0 {
			args = append(args, "--max-budget-usd", fmt.Sprintf("%.2f", *a.profile.MaxBudgetUsd))
		}
		args = append(args, extra...)
		return args, &p

	case domain.AgentQoderCLI:
		permMode := "bypass_permissions"
		if execCtx.ReadOnly {
			permMode = "default"
		}
		args := []string{"-p", "-w", execCtx.Cwd, "--permission-mode", permMode}
		if a.profile.Model != "" {
			args = append(args, "-m", a.profile.Model)
		}
		if a.profile.OutputMode == "json" || a.profile.OutputMode == "stream-json" {
			args = append(args, "-o", a.profile.OutputMode)
		}
		args = append(args, extra...)
		return args, &p

	case domain.AgentCodex:
		args := []string{"exec", "--full-auto"}
		if a.profile.OutputMode == "json" {
			args = append(args, "--json")
		}
		if a.profile.Model != "" {
			args = append(args, "-m", a.profile.Model)
		}
		args = append(args, extra...)
		args = append(args, "-")
		return args, &p

	case domain.AgentGemini:
		args := []string{"-p", "", "--yolo"}
		if a.profile.OutputMode == "json" {
			args = append(args, "--output-format", "json")
		}
		if a.profile.Model != "" {
			args = append(args, "-m", a.profile.Model)
		}
		args = append(args, extra...)
		return args, &p

	case domain.AgentOpenCode:
		args := []string{"run"}
		if a.profile.OutputMode == "json" {
			args = append(args, "--format", "json")
		}
		if a.profile.Model != "" {
			args = append(args, "-m", a.profile.Model)
		}
		args = append(args, extra...)
		return args, &p

	case domain.AgentAider:
		args := []string{"--yes-always", "--no-auto-commits", "--message-file", promptFilePath}
		if a.profile.Model != "" {
			args = append(args, "--model", a.profile.Model)
		}
		args = append(args, extra...)
		return args, nil

	case domain.AgentWorkBuddy, domain.AgentCodeBuddy:
		args := append([]string{}, extra...)
		if len(args) == 0 {
			args = []string{"-p"}
		}
		if a.profile.Model != "" {
			args = append(args, "--model", a.profile.Model)
		}
		if a.profile.PromptMode == "file" {
			args = append(args, "--file", promptFilePath)
			return args, nil
		}
		if a.profile.PromptMode == "arg" {
			args = append(args, execCtx.Prompt)
			return args, nil
		}
		return args, &p

	default:
		return extra, &p
	}
}

func extractClaudeStreamLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") {
		return line, true
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
		return line, true
	}
	typ, _ := obj["type"].(string)
	if typ == "assistant" {
		if msg, ok := obj["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				var fragments []string
				for _, rawBlock := range content {
					if block, ok := rawBlock.(map[string]any); ok {
						bt, _ := block["type"].(string)
						if bt == "text" {
							if txt, ok := block["text"].(string); ok && txt != "" {
								fragments = append(fragments, txt)
							}
						} else if bt == "tool_use" {
							if name, ok := block["name"].(string); ok && name != "" {
								fragments = append(fragments, "[tool_use] "+name)
							}
						}
					}
				}
				if len(fragments) > 0 {
					return strings.Join(fragments, " | "), true
				}
			}
		}
		return "", false
	}
	if typ == "result" {
		return fmt.Sprintf("[result] is_error=%v cost=$%v", obj["is_error"], obj["total_cost_usd"]), true
	}
	return "", false
}

func (a *CliCodingAgentAdapter) Execute(ctx context.Context, execCtx AgentExecContext) AgentExecResult {
	var tempDir string
	var promptFilePath string

	needsFile := a.profile.PromptMode == "file"
	if a.profile.Template != nil {
		for _, tok := range a.profile.Template.ArgsTemplate {
			if strings.Contains(tok, "{{promptFile}}") || strings.Contains(tok, "{promptFile}") {
				needsFile = true
				break
			}
		}
	}
	if needsFile {
		dir, err := os.MkdirTemp("", "dragonflow-prompt-*")
		if err == nil {
			tempDir = dir
			promptFilePath = filepath.Join(dir, "prompt.md")
			_ = os.WriteFile(promptFilePath, []byte(execCtx.Prompt), 0o600)
			defer os.RemoveAll(tempDir)
		}
	}

	args, stdinText := a.BuildCommandArgs(execCtx, promptFilePath)
	if execCtx.OnLog != nil {
		execCtx.OnLog("system", fmt.Sprintf("[Adapter:%s] Executing %s %s", a.profile.ID, a.profile.Command, strings.Join(args, " ")))
	}

	timeoutSec := a.profile.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 900
	}

	res, err := RunSubprocess(ctx, SubprocessOptions{
		Command:      a.profile.Command,
		Args:         args,
		Cwd:          execCtx.Cwd,
		StdinText:    stdinText,
		TimeoutMs:    timeoutSec * 1000,
		EnvAllowlist: a.profile.EnvAllowlist,
		Vault:        a.vault,
		OnLog: func(stream, line string) {
			if execCtx.OnLog == nil {
				return
			}
			if a.profile.Type == domain.AgentClaude && a.profile.OutputMode == "stream-json" {
				if readable, ok := extractClaudeStreamLine(line); ok {
					execCtx.OnLog(stream, readable)
				}
			} else {
				execCtx.OnLog(stream, line)
			}
		},
	})
	if err != nil {
		return AgentExecResult{
			Success:   false,
			RawStderr: err.Error(),
			ExitCode:  -1,
			ErrorKind: domain.ErrKindRuntimeError,
		}
	}

	var customQuota []string
	if a.profile.Template != nil {
		customQuota = a.profile.Template.QuotaErrorPatterns
	}
	errKind := ClassifyAgentError(res.ExitCode, res.Stdout, res.Stderr, res.TimedOut, customQuota)

	outputText := res.Stdout
	tokensUsed := 0
	costUsd := 0.0
	if a.profile.Type == domain.AgentClaude && a.profile.OutputMode == "stream-json" {
		outputText, tokensUsed, costUsd = parseClaudeStreamJSON(res.Stdout)
	} else if a.profile.OutputMode == "json" {
		outputText, tokensUsed, costUsd = parseGenericJSONOutput(res.Stdout)
	}

	return AgentExecResult{
		Success:    res.ExitCode == 0 && !res.TimedOut,
		OutputText: strings.TrimSpace(outputText),
		RawStdout:  res.Stdout,
		RawStderr:  res.Stderr,
		ExitCode:   res.ExitCode,
		ErrorKind:  errKind,
		TokensUsed: tokensUsed,
		CostUsd:    costUsd,
		DurationMs: res.DurationMs,
	}
}

type MockAgentBehavior func(ctx AgentExecContext) AgentExecResult

type MockCodingAgentAdapter struct {
	profile   domain.AgentProfile
	available bool
	behavior  MockAgentBehavior
}

func NewMockCodingAgentAdapter(profile domain.AgentProfile, available bool, behavior MockAgentBehavior) *MockCodingAgentAdapter {
	return &MockCodingAgentAdapter{profile: profile, available: available, behavior: behavior}
}

func (m *MockCodingAgentAdapter) ID() string                   { return m.profile.ID }
func (m *MockCodingAgentAdapter) Profile() domain.AgentProfile { return m.profile }

func (m *MockCodingAgentAdapter) Probe(ctx context.Context) domain.AgentHealthInfo {
	info := domain.AgentHealthInfo{
		ID:            m.profile.ID,
		DisplayName:   m.profile.DisplayName,
		Type:          string(m.profile.Type),
		Enabled:       m.profile.Enabled,
		Available:     m.profile.Enabled && m.available,
		Command:       m.profile.Command,
		Strengths:     append([]string{}, m.profile.Strengths...),
		CostTier:      m.profile.CostTier,
		LastCheckedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if info.Strengths == nil {
		info.Strengths = []string{}
	}
	if m.available {
		info.ResolvedPath = "mock://" + m.profile.Command
		info.Version = "mock-1.0.0"
	} else {
		info.Error = "Simulated unavailable CLI"
	}
	return info
}

func (m *MockCodingAgentAdapter) Execute(ctx context.Context, execCtx AgentExecContext) AgentExecResult {
	if execCtx.OnLog != nil {
		execCtx.OnLog("system", fmt.Sprintf("[MockAgent:%s] Starting stage %q", m.profile.ID, execCtx.Stage))
	}
	var res AgentExecResult
	if m.behavior != nil {
		res = m.behavior(execCtx)
	} else {
		res = AgentExecResult{
			Success:    true,
			OutputText: fmt.Sprintf("[%s] Completed stage %s", m.profile.ID, execCtx.Stage),
			RawStdout:  fmt.Sprintf("[%s] ok", m.profile.ID),
			ExitCode:   0,
			ErrorKind:  domain.ErrKindNone,
			TokensUsed: 850,
			CostUsd:    0.012,
			DurationMs: 25,
		}
	}
	if res.ErrorKind == "" {
		res.ErrorKind = domain.ErrKindNone
	}
	if execCtx.OnLog != nil {
		stream := "stdout"
		if !res.Success {
			stream = "stderr"
		}
		execCtx.OnLog(stream, fmt.Sprintf("[MockAgent:%s] Finished stage %q (success=%v, errorKind=%s)", m.profile.ID, execCtx.Stage, res.Success, res.ErrorKind))
	}
	return res
}
