package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dragonflow/desktop/internal/adapters"
)

func IsGitAvailable() bool {
	return adapters.ResolveExecutable("git") != ""
}

// EnsureDemoBareGitRepo initializes a zero-Node local bare Git repository for Demo mode.
// If Git is not installed on the user's host, it returns "" cleanly so fallback workspace can be used.
func EnsureDemoBareGitRepo(ctx context.Context, demoDataDir string) (string, error) {
	if !IsGitAvailable() {
		return "", nil
	}
	absDir, err := filepath.Abs(demoDataDir)
	if err != nil {
		return "", err
	}
	bareRepo := filepath.Join(absDir, "demo-origin.git")
	seedRepo := filepath.Join(absDir, "demo-seed")
	if pathExists(filepath.Join(bareRepo, "HEAD")) {
		return bareRepo, nil
	}

	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return "", err
	}
	_ = os.RemoveAll(bareRepo)
	_ = os.RemoveAll(seedRepo)

	if code, _, stderr := runGit(ctx, []string{"init", "--bare", bareRepo}, absDir); code != 0 {
		return "", fmt.Errorf("git init --bare failed: %s", stderr)
	}
	if code, _, stderr := runGit(ctx, []string{"clone", bareRepo, seedRepo}, absDir); code != 0 {
		return "", fmt.Errorf("git clone demo seed failed: %s", stderr)
	}

	_, _, _ = runGit(ctx, []string{"config", "user.name", "DragonFlow Demo"}, seedRepo)
	_, _, _ = runGit(ctx, []string{"config", "user.email", "demo@dragonflow.dev"}, seedRepo)
	_, _, _ = runGit(ctx, []string{"checkout", "-B", "main"}, seedRepo)

	if err := os.MkdirAll(filepath.Join(seedRepo, "src"), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(seedRepo, "README.md"), []byte("# Awesome OSS (DragonFlow Demo Repo)\n"), 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(seedRepo, "src", "sum.txt"), []byte("// Initial buggy implementation\nsum(a, b) => a + b\n"), 0o644); err != nil {
		return "", err
	}

	_, _, _ = runGit(ctx, []string{"add", "-A"}, seedRepo)
	if code, _, stderr := runGit(ctx, []string{"commit", "-m", "chore: initial demo repository"}, seedRepo); code != 0 {
		return "", fmt.Errorf("git commit demo seed failed: %s", stderr)
	}
	if code, _, stderr := runGit(ctx, []string{"push", "-u", "origin", "main"}, seedRepo); code != 0 {
		return "", fmt.Errorf("git push demo seed failed: %s", stderr)
	}
	return bareRepo, nil
}

// LocalDemoWorkspaceRunner provides a real filesystem workspace without requiring git.exe when git isn't installed.
type LocalDemoWorkspaceRunner struct {
	worktreeRoot string
}

func NewLocalDemoWorkspaceRunner(worktreeRoot string) *LocalDemoWorkspaceRunner {
	abs, _ := filepath.Abs(worktreeRoot)
	return &LocalDemoWorkspaceRunner{worktreeRoot: abs}
}

func (l *LocalDemoWorkspaceRunner) Kind() string { return "worktree" }

func (l *LocalDemoWorkspaceRunner) PrepareBaseRepo(_ context.Context, _ string, _ string, _ string) (string, error) {
	return l.worktreeRoot, nil
}

func (l *LocalDemoWorkspaceRunner) CreateTaskWorkspace(_ context.Context, taskID, repoFullName, _, _, _ string) (string, error) {
	dir := filepath.Join(l.worktreeRoot, strings.ReplaceAll(repoFullName, "/", "__"), taskID)
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		return "", err
	}
	sumTxt := filepath.Join(dir, "src", "sum.txt")
	if !pathExists(sumTxt) {
		_ = os.WriteFile(sumTxt, []byte("// Initial demo workspace\nsum(a, b) => a + b\n"), 0o644)
	}
	return dir, nil
}

func (l *LocalDemoWorkspaceRunner) RunShellCommand(ctx context.Context, workspacePath, command string, timeoutMs int, onLog func(stream, line string)) (ShellRunResult, error) {
	if strings.HasPrefix(command, "builtin:demo-") || strings.Contains(command, "node ") {
		return runBuiltinDemoCheck(workspacePath, command, onLog), nil
	}
	return RunCommandInShell(ctx, workspacePath, command, timeoutMs, onLog)
}

func (l *LocalDemoWorkspaceRunner) GetChangedFiles(_ context.Context, _ string) ([]string, error) {
	return []string{"src/sum.txt"}, nil
}

func (l *LocalDemoWorkspaceRunner) GetDiff(_ context.Context, workspacePath, _ string) (string, error) {
	data, err := os.ReadFile(filepath.Join(workspacePath, "src", "sum.txt"))
	if err != nil {
		return "M src/sum.txt", nil
	}
	return "### Simulated Workspace Diff (Git not installed)\n```diff\n- sum(a, b) => a + b\n+ " + strings.TrimSpace(string(data)) + "\n```", nil
}

func (l *LocalDemoWorkspaceRunner) CommitAndPush(_ context.Context, _ string, _ string, _ string, _ bool) (CommitAndPushResult, error) {
	return CommitAndPushResult{
		Committed:    true,
		Pushed:       false,
		CommitSha:    "demo-local-sha",
		ChangedFiles: []string{"src/sum.txt"},
	}, nil
}

func (l *LocalDemoWorkspaceRunner) CleanupWorkspace(_ context.Context, _ string, workspacePath string) error {
	return os.RemoveAll(workspacePath)
}
