package adapters

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type DemoOverlayAgentAdapter struct {
	profile                domain.AgentProfile
	realProbe              *CliCodingAgentAdapter
	forceAvailableInDemo   bool
	mu                     sync.Mutex
	quotaFallbacksByTaskID map[string]bool
}

func NewDemoOverlayAgentAdapter(profile domain.AgentProfile, vault *secrets.SecretVault, forceAvailable bool) *DemoOverlayAgentAdapter {
	return &DemoOverlayAgentAdapter{
		profile:                profile,
		realProbe:              NewCliCodingAgentAdapter(profile, vault),
		forceAvailableInDemo:   forceAvailable,
		quotaFallbacksByTaskID: make(map[string]bool),
	}
}

func (d *DemoOverlayAgentAdapter) ID() string                   { return d.profile.ID }
func (d *DemoOverlayAgentAdapter) Profile() domain.AgentProfile { return d.profile }

func (d *DemoOverlayAgentAdapter) Probe(ctx context.Context) domain.AgentHealthInfo {
	real := d.realProbe.Probe(ctx)
	if real.Available || !d.forceAvailableInDemo || !d.profile.Enabled {
		return real
	}
	real.Available = true
	real.ResolvedPath = "demo-virtual://" + d.profile.Command
	real.Version = "demo-simulated"
	real.Error = ""
	return real
}

func (d *DemoOverlayAgentAdapter) Execute(ctx context.Context, execCtx AgentExecContext) AgentExecResult {
	if execCtx.OnLog != nil {
		execCtx.OnLog("system", fmt.Sprintf("[Demo:%s] Executing stage %q in worktree %s", d.profile.ID, execCtx.Stage, execCtx.Cwd))
	}

	select {
	case <-time.After(120 * time.Millisecond):
	case <-ctx.Done():
		return AgentExecResult{Success: false, ErrorKind: domain.ErrKindTimeout, ExitCode: -1}
	}

	if strings.Contains(execCtx.Prompt, "[QuotaFallback]") && d.profile.ID != "claude" {
		d.mu.Lock()
		alreadyTriggered := d.quotaFallbacksByTaskID[execCtx.TaskID]
		if !alreadyTriggered {
			d.quotaFallbacksByTaskID[execCtx.TaskID] = true
		}
		d.mu.Unlock()

		if !alreadyTriggered {
			if execCtx.OnLog != nil {
				execCtx.OnLog("stderr", fmt.Sprintf("[Demo:%s] Error: insufficient_quota (simulated)", d.profile.ID))
			}
			return AgentExecResult{
				Success:    false,
				RawStderr:  "Error: insufficient_quota for demo account",
				ExitCode:   1,
				ErrorKind:  domain.ErrKindQuotaExceeded,
				TokensUsed: 150,
				DurationMs: 120,
			}
		}
	}

	// Update demo fixture file inside the isolated worktree (works cleanly with zero Node.js!)
	if execCtx.Cwd != "" {
		demoFile := filepath.Join(execCtx.Cwd, "src", "sum.txt")
		if _, err := os.Stat(demoFile); err == nil {
			content := fmt.Sprintf("// Automated edit by DragonFlow (%s) at %s\n// Status: FIXED\nsum(a, b) => Number(a) + Number(b)\n", d.profile.ID, time.Now().UTC().Format(time.RFC3339))
			_ = os.WriteFile(demoFile, []byte(content), 0o644)
		}
		jsFile := filepath.Join(execCtx.Cwd, "src", "index.js")
		if _, err := os.Stat(jsFile); err == nil {
			content := fmt.Sprintf("// Automated edit by DragonFlow (%s) at %s\nexport function sum(a, b) {\n  return Number(a) + Number(b);\n}\n", d.profile.ID, time.Now().UTC().Format(time.RFC3339))
			_ = os.WriteFile(jsFile, []byte(content), 0o644)
		}
	}

	if execCtx.OnLog != nil {
		execCtx.OnLog("stdout", fmt.Sprintf("[Demo:%s] Updated repository implementation cleanly", d.profile.ID))
	}
	return AgentExecResult{
		Success:    true,
		OutputText: fmt.Sprintf("Completed %s cleanly with %s", execCtx.Stage, d.profile.ID),
		RawStdout:  fmt.Sprintf("Completed %s", execCtx.Stage),
		ExitCode:   0,
		ErrorKind:  domain.ErrKindNone,
		TokensUsed: 1120,
		CostUsd:    0.015,
		DurationMs: 120,
	}
}
