package workspace

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/adapters"
)

type ShellRunResult struct {
	ExitCode   int
	Stdout     string
	Stderr     string
	TimedOut   bool
	DurationMs int64
}

type CommitAndPushResult struct {
	Committed    bool
	Pushed       bool
	CommitSha    string
	ChangedFiles []string
}

type WorkspaceRunner interface {
	Kind() string
	PrepareBaseRepo(ctx context.Context, repoFullName, remoteURL, baseBranch string) (string, error)
	CreateTaskWorkspace(ctx context.Context, taskID, repoFullName, remoteURL, branchName, baseBranch string) (string, error)
	RunShellCommand(ctx context.Context, workspacePath, command string, timeoutMs int, onLog func(stream, line string)) (ShellRunResult, error)
	GetChangedFiles(ctx context.Context, workspacePath string) ([]string, error)
	GetDiff(ctx context.Context, workspacePath, baseBranch string) (string, error)
	CommitAndPush(ctx context.Context, workspacePath, message, branchName string, push bool) (CommitAndPushResult, error)
	CleanupWorkspace(ctx context.Context, repoFullName, workspacePath string) error
}

func runGit(ctx context.Context, args []string, cwd string) (int, string, string) {
	cctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cctx, "git", args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	adapters.ApplyHiddenProcAttr(cmd)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
		} else {
			code = -1
			if stderr.Len() == 0 {
				stderr.WriteString(err.Error())
			}
		}
	}
	return code, stdout.String(), stderr.String()
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func runBuiltinDemoCheck(workspacePath, command string, onLog func(stream, line string)) ShellRunResult {
	start := time.Now()
	if onLog != nil {
		onLog("stdout", fmt.Sprintf("[DragonFlow:BuiltinCheck] Running %s in %s", command, workspacePath))
	}

	sumTxt := filepath.Join(workspacePath, "src", "sum.txt")
	jsFile := filepath.Join(workspacePath, "src", "index.js")
	passed := true
	var detail string

	if data, err := os.ReadFile(sumTxt); err == nil {
		txt := string(data)
		if strings.Contains(txt, "FIXED") || strings.Contains(txt, "Number(") {
			detail = "src/sum.txt check passed: numeric coercion verified"
		} else {
			passed = false
			detail = "src/sum.txt check failed: missing FIXED / Number() coercion"
		}
	} else if data, err := os.ReadFile(jsFile); err == nil {
		txt := string(data)
		if strings.Contains(txt, "Number(") {
			detail = "src/index.js check passed"
		} else {
			passed = false
			detail = "src/index.js check failed: expected Number() coercion"
		}
	} else {
		detail = fmt.Sprintf("Builtin verification (%s) completed cleanly", command)
	}

	if onLog != nil {
		if passed {
			onLog("stdout", "[DragonFlow:BuiltinCheck] PASS: "+detail)
		} else {
			onLog("stderr", "[DragonFlow:BuiltinCheck] FAIL: "+detail)
		}
	}
	exitCode := 0
	stdout := detail
	stderr := ""
	if !passed {
		exitCode = 1
		stdout = ""
		stderr = detail
	}
	return ShellRunResult{
		ExitCode:   exitCode,
		Stdout:     stdout,
		Stderr:     stderr,
		DurationMs: time.Since(start).Milliseconds(),
	}
}

func RunCommandInShell(ctx context.Context, cwd, command string, timeoutMs int, onLog func(stream, line string)) (ShellRunResult, error) {
	if strings.HasPrefix(command, "builtin:demo-") {
		return runBuiltinDemoCheck(cwd, command, onLog), nil
	}

	start := time.Now()
	if timeoutMs <= 0 {
		timeoutMs = 300_000
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	var shellBin string
	var shellArgs []string
	if runtime.GOOS == "windows" {
		shellBin = os.Getenv("ComSpec")
		if shellBin == "" {
			shellBin = "cmd.exe"
		}
		shellArgs = []string{"/d", "/c", command}
	} else {
		shellBin = "/bin/sh"
		shellArgs = []string{"-c", command}
	}

	cmd := exec.CommandContext(runCtx, shellBin, shellArgs...)
	cmd.Dir = cwd
	cmd.Env = adapters.BuildFilteredEnv(nil, nil, nil)
	adapters.ApplyHiddenProcAttr(cmd)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return ShellRunResult{}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return ShellRunResult{}, err
	}

	if err := cmd.Start(); err != nil {
		return ShellRunResult{
			ExitCode:   -1,
			Stderr:     err.Error(),
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	var mu sync.Mutex
	var wg sync.WaitGroup
	readPipe := func(r io.Reader, stream string, buf *bytes.Buffer) {
		defer wg.Done()
		reader := bufio.NewReaderSize(r, 64*1024)
		for {
			line, rerr := reader.ReadString('\n')
			if len(line) > 0 {
				mu.Lock()
				buf.WriteString(line)
				mu.Unlock()
				trimmed := strings.TrimRight(line, "\r\n")
				if trimmed != "" && onLog != nil {
					onLog(stream, trimmed)
				}
			}
			if rerr != nil {
				break
			}
		}
	}
	wg.Add(2)
	go readPipe(stdoutPipe, "stdout", &stdoutBuf)
	go readPipe(stderrPipe, "stderr", &stderrBuf)

	wg.Wait()
	waitErr := cmd.Wait()
	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	return ShellRunResult{
		ExitCode:   exitCode,
		Stdout:     stdoutBuf.String(),
		Stderr:     stderrBuf.String(),
		TimedOut:   timedOut,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

type GitWorktreeRunner struct {
	reposRoot    string
	worktreeRoot string
}

func NewGitWorktreeRunner(reposRoot, worktreeRoot string) *GitWorktreeRunner {
	absRepos, _ := filepath.Abs(reposRoot)
	absWorktree, _ := filepath.Abs(worktreeRoot)
	return &GitWorktreeRunner{
		reposRoot:    absRepos,
		worktreeRoot: absWorktree,
	}
}

func (g *GitWorktreeRunner) Kind() string { return "worktree" }

func (g *GitWorktreeRunner) getBaseRepoPath(repoFullName string) string {
	return filepath.Join(g.reposRoot, strings.ReplaceAll(repoFullName, "/", "__"))
}

func (g *GitWorktreeRunner) PrepareBaseRepo(ctx context.Context, repoFullName, remoteURL, baseBranch string) (string, error) {
	baseDir := g.getBaseRepoPath(repoFullName)
	if err := os.MkdirAll(filepath.Dir(baseDir), 0o755); err != nil {
		return "", err
	}
	gitDir := filepath.Join(baseDir, ".git")
	if !pathExists(gitDir) {
		code, _, stderr := runGit(ctx, []string{"clone", remoteURL, baseDir}, filepath.Dir(baseDir))
		if code != 0 {
			return "", fmt.Errorf("git clone failed for %s: %s", remoteURL, stderr)
		}
	} else {
		_, _, _ = runGit(ctx, []string{"remote", "set-url", "origin", remoteURL}, baseDir)
		code, _, stderr := runGit(ctx, []string{"fetch", "--all", "--prune"}, baseDir)
		if code != 0 {
			return "", fmt.Errorf("git fetch failed in %s: %s", baseDir, stderr)
		}
	}

	code, _, _ := runGit(ctx, []string{"rev-parse", "--verify", "origin/" + baseBranch}, baseDir)
	if code == 0 {
		_, _, _ = runGit(ctx, []string{"branch", "-f", baseBranch, "origin/" + baseBranch}, baseDir)
	}
	return baseDir, nil
}

func (g *GitWorktreeRunner) CreateTaskWorkspace(ctx context.Context, taskID, repoFullName, remoteURL, branchName, baseBranch string) (string, error) {
	baseDir, err := g.PrepareBaseRepo(ctx, repoFullName, remoteURL, baseBranch)
	if err != nil {
		return "", err
	}
	worktreePath := filepath.Join(g.worktreeRoot, strings.ReplaceAll(repoFullName, "/", "__"), taskID)
	if err := os.MkdirAll(filepath.Dir(worktreePath), 0o755); err != nil {
		return "", err
	}
	_, _, _ = runGit(ctx, []string{"worktree", "prune"}, baseDir)

	if pathExists(worktreePath) {
		code, stdout, _ := runGit(ctx, []string{"rev-parse", "--is-inside-work-tree"}, worktreePath)
		if code == 0 && strings.TrimSpace(stdout) == "true" {
			return worktreePath, nil
		}
		_ = os.RemoveAll(worktreePath)
		_, _, _ = runGit(ctx, []string{"worktree", "prune"}, baseDir)
	}

	startPoint := "origin/" + baseBranch
	if code, _, _ := runGit(ctx, []string{"rev-parse", "--verify", startPoint}, baseDir); code != 0 {
		if code2, _, _ := runGit(ctx, []string{"rev-parse", "--verify", baseBranch}, baseDir); code2 == 0 {
			startPoint = baseBranch
		} else {
			startPoint = "HEAD"
		}
	}

	code, _, stderr := runGit(ctx, []string{"worktree", "add", "-B", branchName, worktreePath, startPoint}, baseDir)
	if code != 0 {
		return "", fmt.Errorf("git worktree add failed: %s", stderr)
	}

	_, nameOut, _ := runGit(ctx, []string{"config", "user.name"}, worktreePath)
	if strings.TrimSpace(nameOut) == "" {
		_, _, _ = runGit(ctx, []string{"config", "user.name", "DragonFlow Bot"}, worktreePath)
	}
	_, emailOut, _ := runGit(ctx, []string{"config", "user.email"}, worktreePath)
	if strings.TrimSpace(emailOut) == "" {
		_, _, _ = runGit(ctx, []string{"config", "user.email", "dragonflow-bot@users.noreply.github.com"}, worktreePath)
	}
	return worktreePath, nil
}

func (g *GitWorktreeRunner) RunShellCommand(ctx context.Context, workspacePath, command string, timeoutMs int, onLog func(stream, line string)) (ShellRunResult, error) {
	return RunCommandInShell(ctx, workspacePath, command, timeoutMs, onLog)
}

func (g *GitWorktreeRunner) GetChangedFiles(ctx context.Context, workspacePath string) ([]string, error) {
	code, stdout, _ := runGit(ctx, []string{"status", "--porcelain"}, workspacePath)
	if code != 0 {
		return []string{}, nil
	}
	out := make([]string, 0)
	for _, line := range strings.Split(strings.ReplaceAll(stdout, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" || len(line) < 4 {
			continue
		}
		file := strings.TrimSpace(line[3:])
		if !strings.HasPrefix(file, ".dragonflow-") {
			out = append(out, file)
		}
	}
	return out, nil
}

func (g *GitWorktreeRunner) GetDiff(ctx context.Context, workspacePath, baseBranch string) (string, error) {
	_, statusOut, _ := runGit(ctx, []string{"status", "--short"}, workspacePath)
	diffTarget := "HEAD"
	if code, _, _ := runGit(ctx, []string{"rev-parse", "--verify", "origin/"+baseBranch}, workspacePath); code == 0 {
		diffTarget = "origin/" + baseBranch
	} else if code2, _, _ := runGit(ctx, []string{"rev-parse", "--verify", baseBranch}, workspacePath); code2 == 0 {
		diffTarget = baseBranch
	}

	_, diffOut, _ := runGit(ctx, []string{"diff", diffTarget}, workspacePath)
	var parts []string
	if trimmed := strings.TrimSpace(statusOut); trimmed != "" {
		parts = append(parts, "### Git Status\n"+trimmed)
	}
	if trimmed := strings.TrimSpace(diffOut); trimmed != "" {
		parts = append(parts, fmt.Sprintf("### Diff vs %s\n%s", diffTarget, trimmed))
	}
	if len(parts) == 0 {
		return "(no changes detected)", nil
	}
	return strings.Join(parts, "\n\n"), nil
}

func (g *GitWorktreeRunner) CommitAndPush(ctx context.Context, workspacePath, message, branchName string, push bool) (CommitAndPushResult, error) {
	changed, err := g.GetChangedFiles(ctx, workspacePath)
	if err != nil {
		return CommitAndPushResult{}, err
	}
	if len(changed) == 0 {
		_, headOut, _ := runGit(ctx, []string{"rev-parse", "HEAD"}, workspacePath)
		return CommitAndPushResult{
			Committed:    false,
			Pushed:       false,
			CommitSha:    strings.TrimSpace(headOut),
			ChangedFiles: []string{},
		}, nil
	}

	if code, stdout, stderr := runGit(ctx, []string{"add", "-A"}, workspacePath); code != 0 {
		return CommitAndPushResult{}, fmt.Errorf("git add failed: %s %s", stderr, stdout)
	}
	_, stagedOut, _ := runGit(ctx, []string{"diff", "--cached", "--name-only"}, workspacePath)
	var staged []string
	for _, f := range strings.Split(strings.ReplaceAll(stagedOut, "\r\n", "\n"), "\n") {
		if trimmed := strings.TrimSpace(f); trimmed != "" {
			staged = append(staged, trimmed)
		}
	}
	if len(staged) == 0 {
		_, headOut, _ := runGit(ctx, []string{"rev-parse", "HEAD"}, workspacePath)
		return CommitAndPushResult{
			Committed:    false,
			Pushed:       false,
			CommitSha:    strings.TrimSpace(headOut),
			ChangedFiles: []string{},
		}, nil
	}

	if code, stdout, stderr := runGit(ctx, []string{"commit", "-m", message}, workspacePath); code != 0 {
		return CommitAndPushResult{}, fmt.Errorf("git commit failed: %s %s", stderr, stdout)
	}
	_, shaOut, _ := runGit(ctx, []string{"rev-parse", "HEAD"}, workspacePath)
	sha := strings.TrimSpace(shaOut)

	pushed := false
	if push {
		if code, stdout, stderr := runGit(ctx, []string{"push", "-u", "origin", branchName, "--force-with-lease"}, workspacePath); code != 0 {
			return CommitAndPushResult{}, fmt.Errorf("git push failed: %s %s", stderr, stdout)
		}
		pushed = true
	}

	return CommitAndPushResult{
		Committed:    true,
		Pushed:       pushed,
		CommitSha:    sha,
		ChangedFiles: staged,
	}, nil
}

func (g *GitWorktreeRunner) CleanupWorkspace(ctx context.Context, repoFullName, workspacePath string) error {
	baseDir := g.getBaseRepoPath(repoFullName)
	if pathExists(baseDir) {
		_, _, _ = runGit(ctx, []string{"worktree", "remove", "--force", workspacePath}, baseDir)
		_, _, _ = runGit(ctx, []string{"worktree", "prune"}, baseDir)
	}
	if pathExists(workspacePath) {
		_ = os.RemoveAll(workspacePath)
	}
	return nil
}
