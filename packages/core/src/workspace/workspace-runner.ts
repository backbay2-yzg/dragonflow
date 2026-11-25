import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildFilteredEnv, resolveExecutable } from '../adapters/process-runner.js';

export interface ShellRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CommitAndPushResult {
  committed: boolean;
  pushed: boolean;
  commitSha?: string;
  changedFiles: string[];
}

export interface WorkspaceRunner {
  readonly kind: 'worktree' | 'docker';
  prepareBaseRepo(repoFullName: string, remoteUrl: string, baseBranch: string): Promise<string>;
  createTaskWorkspace(
    taskId: string,
    repoFullName: string,
    remoteUrl: string,
    branchName: string,
    baseBranch: string,
  ): Promise<string>;
  runShellCommand(
    workspacePath: string,
    command: string,
    opts?: {
      timeoutMs?: number;
      onLog?: (stream: 'stdout' | 'stderr', line: string) => void;
    },
  ): Promise<ShellRunResult>;
  getChangedFiles(workspacePath: string): Promise<string[]>;
  getDiff(workspacePath: string, baseBranch: string): Promise<string>;
  commitAndPush(
    workspacePath: string,
    message: string,
    branchName: string,
    push: boolean,
  ): Promise<CommitAndPushResult>;
  cleanupWorkspace(repoFullName: string, workspacePath: string): Promise<void>;
}

function runGit(
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function runCommandInShell(
  cwd: string,
  command: string,
  opts?: {
    timeoutMs?: number;
    onLog?: (stream: 'stdout' | 'stderr', line: string) => void;
  },
): Promise<ShellRunResult> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 300_000;
  const isWin = process.platform === 'win32';
  const shellBin = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const shellArgs = isWin ? ['/d', '/c', command] : ['-c', command];
  const env = buildFilteredEnv();

  return new Promise((resolve) => {
    const child = spawn(shellBin, shellArgs, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;

    const flush = (stream: 'stdout' | 'stderr', text: string) => {
      const lines = text.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) opts?.onLog?.(stream, line);
      }
      return tail;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      if (isWin && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      stdout += str;
      stdoutBuf = flush('stdout', stdoutBuf + str);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      stderr += str;
      stderrBuf = flush('stderr', stderrBuf + str);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr ? `${stderr}\n${err.message}` : err.message,
        timedOut,
        durationMs: Date.now() - start,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) opts?.onLog?.('stdout', stdoutBuf);
      if (stderrBuf.trim()) opts?.onLog?.('stderr', stderrBuf);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}

export class GitWorktreeRunner implements WorkspaceRunner {
  public readonly kind = 'worktree' as const;
  private readonly reposRoot: string;
  private readonly worktreeRoot: string;

  constructor(reposRoot: string, worktreeRoot: string) {
    this.reposRoot = path.resolve(reposRoot);
    this.worktreeRoot = path.resolve(worktreeRoot);
  }

  private getBaseRepoPath(repoFullName: string): string {
    return path.resolve(this.reposRoot, repoFullName.replaceAll('/', '__'));
  }

  async prepareBaseRepo(
    repoFullName: string,
    remoteUrl: string,
    baseBranch: string,
  ): Promise<string> {
    const baseDir = this.getBaseRepoPath(repoFullName);
    await mkdir(path.dirname(baseDir), { recursive: true });

    const gitDir = path.join(baseDir, '.git');
    if (!(await pathExists(gitDir))) {
      const cloneRes = await runGit(['clone', remoteUrl, baseDir], path.dirname(baseDir));
      if (cloneRes.code !== 0) {
        throw new Error(`git clone failed for ${remoteUrl}: ${cloneRes.stderr}`);
      }
    } else {
      await runGit(['remote', 'set-url', 'origin', remoteUrl], baseDir);
      const fetchRes = await runGit(['fetch', '--all', '--prune'], baseDir);
      if (fetchRes.code !== 0) {
        throw new Error(`git fetch failed in ${baseDir}: ${fetchRes.stderr}`);
      }
    }

    // Ensure local baseBranch stays synced if possible
    const hasOriginBase = await runGit(
      ['rev-parse', '--verify', `origin/${baseBranch}`],
      baseDir,
    );
    if (hasOriginBase.code === 0) {
      await runGit(['branch', '-f', baseBranch, `origin/${baseBranch}`], baseDir);
    }

    return baseDir;
  }

  async createTaskWorkspace(
    taskId: string,
    repoFullName: string,
    remoteUrl: string,
    branchName: string,
    baseBranch: string,
  ): Promise<string> {
    const baseDir = await this.prepareBaseRepo(repoFullName, remoteUrl, baseBranch);
    const worktreePath = path.resolve(
      this.worktreeRoot,
      repoFullName.replaceAll('/', '__'),
      taskId,
    );
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await runGit(['worktree', 'prune'], baseDir);

    if (await pathExists(worktreePath)) {
      const check = await runGit(['rev-parse', '--is-inside-work-tree'], worktreePath);
      if (check.code === 0 && check.stdout.trim() === 'true') {
        return worktreePath;
      }
      await rm(worktreePath, { recursive: true, force: true });
      await runGit(['worktree', 'prune'], baseDir);
    }

    let startPoint = `origin/${baseBranch}`;
    const verifyOrigin = await runGit(['rev-parse', '--verify', startPoint], baseDir);
    if (verifyOrigin.code !== 0) {
      const verifyLocal = await runGit(['rev-parse', '--verify', baseBranch], baseDir);
      startPoint = verifyLocal.code === 0 ? baseBranch : 'HEAD';
    }

    const addRes = await runGit(
      ['worktree', 'add', '-B', branchName, worktreePath, startPoint],
      baseDir,
    );
    if (addRes.code !== 0) {
      throw new Error(`git worktree add failed: ${addRes.stderr}`);
    }

    // Ensure bot committer identity in local worktree config
    const nameCheck = await runGit(['config', 'user.name'], worktreePath);
    if (!nameCheck.stdout.trim()) {
      await runGit(['config', 'user.name', 'DragonFlow Bot'], worktreePath);
    }
    const emailCheck = await runGit(['config', 'user.email'], worktreePath);
    if (!emailCheck.stdout.trim()) {
      await runGit(['config', 'user.email', 'dragonflow-bot@users.noreply.github.com'], worktreePath);
    }

    return worktreePath;
  }

  async runShellCommand(
    workspacePath: string,
    command: string,
    opts?: {
      timeoutMs?: number;
      onLog?: (stream: 'stdout' | 'stderr', line: string) => void;
    },
  ): Promise<ShellRunResult> {
    return runCommandInShell(workspacePath, command, opts);
  }

  async getChangedFiles(workspacePath: string): Promise<string[]> {
    const res = await runGit(['status', '--porcelain'], workspacePath);
    if (res.code !== 0) return [];
    return res.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
      .filter((file) => !file.startsWith('.dragonflow-'));
  }

  async getDiff(workspacePath: string, baseBranch: string): Promise<string> {
    const statusRes = await runGit(['status', '--short'], workspacePath);
    let diffTarget = 'HEAD';
    const hasOriginBase = await runGit(
      ['rev-parse', '--verify', `origin/${baseBranch}`],
      workspacePath,
    );
    if (hasOriginBase.code === 0) {
      diffTarget = `origin/${baseBranch}`;
    } else {
      const hasLocalBase = await runGit(['rev-parse', '--verify', baseBranch], workspacePath);
      if (hasLocalBase.code === 0) {
        diffTarget = baseBranch;
      }
    }

    const diffRes = await runGit(['diff', diffTarget], workspacePath);
    const parts = [
      statusRes.stdout.trim() ? `### Git Status\n${statusRes.stdout.trim()}` : '',
      diffRes.stdout.trim() ? `### Diff vs ${diffTarget}\n${diffRes.stdout.trim()}` : '',
    ].filter(Boolean);

    return parts.join('\n\n') || '(no changes detected)';
  }

  async commitAndPush(
    workspacePath: string,
    message: string,
    branchName: string,
    push: boolean,
  ): Promise<CommitAndPushResult> {
    const changedFiles = await this.getChangedFiles(workspacePath);
    if (changedFiles.length === 0) {
      const headRes = await runGit(['rev-parse', 'HEAD'], workspacePath);
      return {
        committed: false,
        pushed: false,
        commitSha: headRes.stdout.trim() || undefined,
        changedFiles: [],
      };
    }

    const addRes = await runGit(['add', '-A'], workspacePath);
    if (addRes.code !== 0) {
      throw new Error(`git add failed: ${addRes.stderr || addRes.stdout}`);
    }

    const stagedRes = await runGit(['diff', '--cached', '--name-only'], workspacePath);
    const stagedFiles = stagedRes.stdout
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    if (stagedFiles.length === 0) {
      const headRes = await runGit(['rev-parse', 'HEAD'], workspacePath);
      return {
        committed: false,
        pushed: false,
        commitSha: headRes.stdout.trim() || undefined,
        changedFiles: [],
      };
    }

    const commitRes = await runGit(['commit', '-m', message], workspacePath);
    if (commitRes.code !== 0) {
      throw new Error(`git commit failed: ${commitRes.stderr || commitRes.stdout}`);
    }

    const shaRes = await runGit(['rev-parse', 'HEAD'], workspacePath);
    const commitSha = shaRes.stdout.trim();

    let pushed = false;
    if (push) {
      const pushRes = await runGit(
        ['push', '-u', 'origin', branchName, '--force-with-lease'],
        workspacePath,
      );
      if (pushRes.code !== 0) {
        throw new Error(`git push failed: ${pushRes.stderr || pushRes.stdout}`);
      }
      pushed = true;
    }

    return {
      committed: true,
      pushed,
      commitSha,
      changedFiles: stagedFiles,
    };
  }

  async cleanupWorkspace(repoFullName: string, workspacePath: string): Promise<void> {
    const baseDir = this.getBaseRepoPath(repoFullName);
    if (await pathExists(baseDir)) {
      await runGit(['worktree', 'remove', '--force', workspacePath], baseDir);
      await runGit(['worktree', 'prune'], baseDir);
    }
    if (await pathExists(workspacePath)) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export class DockerSandboxRunner implements WorkspaceRunner {
  public readonly kind = 'docker' as const;
  private readonly gitHelper: GitWorktreeRunner;

  constructor(
    reposRoot: string,
    worktreeRoot: string,
    private readonly dockerImage = 'node:22-bookworm',
    private readonly dockerNetwork = 'bridge',
  ) {
    this.gitHelper = new GitWorktreeRunner(reposRoot, worktreeRoot);
  }

  prepareBaseRepo(repoFullName: string, remoteUrl: string, baseBranch: string): Promise<string> {
    return this.gitHelper.prepareBaseRepo(repoFullName, remoteUrl, baseBranch);
  }

  createTaskWorkspace(
    taskId: string,
    repoFullName: string,
    remoteUrl: string,
    branchName: string,
    baseBranch: string,
  ): Promise<string> {
    return this.gitHelper.createTaskWorkspace(taskId, repoFullName, remoteUrl, branchName, baseBranch);
  }

  buildDockerArgs(workspacePath: string, command: string): string[] {
    const absPath = path.resolve(workspacePath);
    return [
      'run',
      '--rm',
      '--network',
      this.dockerNetwork,
      '-v',
      `${absPath}:/workspace`,
      '-w',
      '/workspace',
      this.dockerImage,
      'sh',
      '-c',
      command,
    ];
  }

  async runShellCommand(
    workspacePath: string,
    command: string,
    opts?: {
      timeoutMs?: number;
      onLog?: (stream: 'stdout' | 'stderr', line: string) => void;
    },
  ): Promise<ShellRunResult> {
    const dockerBin = await resolveExecutable('docker');
    if (!dockerBin) {
      throw new Error(
        'Docker sandbox runner is selected, but "docker" executable is not installed on this host.',
      );
    }
    const start = Date.now();
    const args = this.buildDockerArgs(workspacePath, command);

    return new Promise((resolve) => {
      const child = spawn(dockerBin, args, {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts?.timeoutMs ?? 300_000);

      child.stdout.on('data', (d: Buffer) => {
        const str = d.toString('utf8');
        stdout += str;
        for (const line of str.split(/\r?\n/).filter(Boolean)) {
          opts?.onLog?.('stdout', line);
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        const str = d.toString('utf8');
        stderr += str;
        for (const line of str.split(/\r?\n/).filter(Boolean)) {
          opts?.onLog?.('stderr', line);
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout,
          stderr: err.message,
          timedOut,
          durationMs: Date.now() - start,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  getChangedFiles(workspacePath: string): Promise<string[]> {
    return this.gitHelper.getChangedFiles(workspacePath);
  }

  getDiff(workspacePath: string, baseBranch: string): Promise<string> {
    return this.gitHelper.getDiff(workspacePath, baseBranch);
  }

  commitAndPush(
    workspacePath: string,
    message: string,
    branchName: string,
    push: boolean,
  ): Promise<CommitAndPushResult> {
    return this.gitHelper.commitAndPush(workspacePath, message, branchName, push);
  }

  cleanupWorkspace(repoFullName: string, workspacePath: string): Promise<void> {
    return this.gitHelper.cleanupWorkspace(repoFullName, workspacePath);
  }
}
