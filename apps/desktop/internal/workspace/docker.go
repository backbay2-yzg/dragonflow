package workspace

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/dragonflow/desktop/internal/adapters"
)

type DockerSandboxRunner struct {
	gitHelper     *GitWorktreeRunner
	dockerImage   string
	dockerNetwork string
}

func NewDockerSandboxRunner(reposRoot, worktreeRoot, dockerImage, dockerNetwork string) *DockerSandboxRunner {
	if dockerImage == "" {
		dockerImage = "node:22-bookworm"
	}
	if dockerNetwork == "" {
		dockerNetwork = "bridge"
	}
	return &DockerSandboxRunner{
		gitHelper:     NewGitWorktreeRunner(reposRoot, worktreeRoot),
		dockerImage:   dockerImage,
		dockerNetwork: dockerNetwork,
	}
}

func (d *DockerSandboxRunner) Kind() string { return "docker" }

func (d *DockerSandboxRunner) PrepareBaseRepo(ctx context.Context, repoFullName, remoteURL, baseBranch string) (string, error) {
	return d.gitHelper.PrepareBaseRepo(ctx, repoFullName, remoteURL, baseBranch)
}

func (d *DockerSandboxRunner) CreateTaskWorkspace(ctx context.Context, taskID, repoFullName, remoteURL, branchName, baseBranch string) (string, error) {
	return d.gitHelper.CreateTaskWorkspace(ctx, taskID, repoFullName, remoteURL, branchName, baseBranch)
}

func (d *DockerSandboxRunner) BuildDockerArgs(workspacePath, command string) []string {
	absPath, _ := filepath.Abs(workspacePath)
	return []string{
		"run",
		"--rm",
		"--network", d.dockerNetwork,
		"-v", absPath + ":/workspace",
		"-w", "/workspace",
		d.dockerImage,
		"sh", "-c", command,
	}
}

func (d *DockerSandboxRunner) RunShellCommand(ctx context.Context, workspacePath, command string, timeoutMs int, onLog func(stream, line string)) (ShellRunResult, error) {
	dockerBin := adapters.ResolveExecutable("docker")
	if dockerBin == "" {
		return ShellRunResult{}, fmt.Errorf("Docker sandbox runner is selected, but \"docker\" executable is not installed on this host")
	}
	if timeoutMs <= 0 {
		timeoutMs = 300_000
	}
	res, err := adapters.RunSubprocess(ctx, adapters.SubprocessOptions{
		Command:   dockerBin,
		Args:      d.BuildDockerArgs(workspacePath, command),
		Cwd:       workspacePath,
		TimeoutMs: timeoutMs,
		OnLog:     onLog,
	})
	if err != nil {
		return ShellRunResult{}, err
	}
	return ShellRunResult{
		ExitCode:   res.ExitCode,
		Stdout:     res.Stdout,
		Stderr:     res.Stderr,
		TimedOut:   res.TimedOut,
		DurationMs: res.DurationMs,
	}, nil
}

func (d *DockerSandboxRunner) GetChangedFiles(ctx context.Context, workspacePath string) ([]string, error) {
	return d.gitHelper.GetChangedFiles(ctx, workspacePath)
}

func (d *DockerSandboxRunner) GetDiff(ctx context.Context, workspacePath, baseBranch string) (string, error) {
	return d.gitHelper.GetDiff(ctx, workspacePath, baseBranch)
}

func (d *DockerSandboxRunner) CommitAndPush(ctx context.Context, workspacePath, message, branchName string, push bool) (CommitAndPushResult, error) {
	return d.gitHelper.CommitAndPush(ctx, workspacePath, message, branchName, push)
}

func (d *DockerSandboxRunner) CleanupWorkspace(ctx context.Context, repoFullName, workspacePath string) error {
	return d.gitHelper.CleanupWorkspace(ctx, repoFullName, workspacePath)
}
