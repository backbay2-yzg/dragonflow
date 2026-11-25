import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { AgentErrorKind } from '@dragonflow/shared';

export interface SubprocessOptions {
  command: string;
  args: string[];
  cwd: string;
  stdinText?: string;
  timeoutMs?: number;
  envAllowlist?: string[];
  extraEnv?: Record<string, string>;
  onLog?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export interface SubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  resolvedPath: string;
  durationMs: number;
}

const WINDOWS_BASELINE_ENV = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'ComSpec',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'PROGRAMDATA',
  'ProgramData',
  'PROGRAMFILES',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'LANG',
  'LC_ALL',
  'TERM',
];

const WIN_EXT_PRIORITY: Record<string, number> = {
  '.exe': 1,
  '.cmd': 2,
  '.bat': 3,
  '.com': 4,
  '.ps1': 5,
};

function spawnSimpleCapture(
  bin: string,
  args: string[],
  timeoutMs = 5000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
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

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
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

export async function resolveExecutable(command: string): Promise<string | null> {
  if (command.includes('/') || command.includes('\\')) {
    try {
      await access(command);
      return command;
    } catch {
      return null;
    }
  }

  if (process.platform === 'win32') {
    const res = await spawnSimpleCapture('where.exe', [command]);
    if (res.code !== 0 || !res.stdout.trim()) {
      return null;
    }
    const candidates = res.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (candidates.length === 0) return null;

    const sorted = [...candidates].sort((a, b) => {
      const extA = path.extname(a).toLowerCase();
      const extB = path.extname(b).toLowerCase();
      const prioA = WIN_EXT_PRIORITY[extA] ?? 99;
      const prioB = WIN_EXT_PRIORITY[extB] ?? 99;
      return prioA - prioB;
    });

    const best = sorted[0];
    // On Windows, ignore bare extensionless POSIX shims when no runnable Windows extension exists
    if (!path.extname(best)) {
      return null;
    }
    return best;
  }

  const res = await spawnSimpleCapture('which', [command]);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  return res.stdout.split(/\r?\n/)[0]?.trim() || null;
}

export function buildFilteredEnv(
  allowlist: string[] = [],
  extraEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keys = new Set([...WINDOWS_BASELINE_ENV, ...allowlist]);
  for (const key of keys) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    env[k] = v;
  }
  return env;
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

export async function runSubprocess(opts: SubprocessOptions): Promise<SubprocessResult> {
  const start = Date.now();
  const resolvedPath = await resolveExecutable(opts.command);
  if (!resolvedPath) {
    throw new Error(`Executable not found in PATH: ${opts.command}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let spawnCmd = resolvedPath;
  let spawnArgs = opts.args;

  if (process.platform === 'win32') {
    if (ext === '.ps1') {
      spawnCmd = 'powershell.exe';
      spawnArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolvedPath,
        ...opts.args,
      ];
    } else if (ext === '.cmd' || ext === '.bat') {
      spawnCmd = process.env.ComSpec || 'cmd.exe';
      spawnArgs = ['/d', '/c', resolvedPath, ...opts.args];
    }
  }

  const env = buildFilteredEnv(opts.envAllowlist, opts.extraEnv);
  const timeoutMs = opts.timeoutMs ?? 900_000;

  return new Promise((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: opts.cwd,
      env,
      shell: false,
      stdio: [opts.stdinText !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;

    const flushBuffer = (stream: 'stdout' | 'stderr', buffer: string): string => {
      const lines = buffer.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) {
          opts.onLog?.(stream, line);
        }
      }
      return tail;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      opts.onLog?.('stderr', `[DragonFlow] Process exceeded timeout (${timeoutMs}ms), terminating...`);
      killProcessTree(child.pid);
    }, timeoutMs);

    if (opts.stdinText !== undefined && child.stdin) {
      child.stdin.write(opts.stdinText, 'utf8');
      child.stdin.end();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      stdout += str;
      stdoutBuffer = flushBuffer('stdout', stdoutBuffer + str);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      stderr += str;
      stderrBuffer = flushBuffer('stderr', stderrBuffer + str);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      opts.onLog?.('stderr', `[DragonFlow] Spawn error: ${err.message}`);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr ? `${stderr}\n${err.message}` : err.message,
        timedOut,
        resolvedPath,
        durationMs: Date.now() - start,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutBuffer.trim()) {
        opts.onLog?.('stdout', stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        opts.onLog?.('stderr', stderrBuffer);
      }
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        resolvedPath,
        durationMs: Date.now() - start,
      });
    });
  });
}

const DEFAULT_QUOTA_PATTERNS = [
  /insufficient[_\s-]?quota/i,
  /quota[_\s-]?exceeded/i,
  /credit balance is too low/i,
  /billing.*limit/i,
  /exceeded your current quota/i,
  /usage limit reached/i,
  /out of credits/i,
];

const DEFAULT_RATE_LIMIT_PATTERNS = [
  /rate[_\s-]?limit/i,
  /\b429\b/,
  /too many requests/i,
  /overloaded_error/i,
];

const DEFAULT_AUTH_PATTERNS = [
  /unauthorized/i,
  /invalid[_\s-]?api[_\s-]?key/i,
  /authentication failed/i,
  /not logged in/i,
  /please run .*login/i,
  /\b401\b/,
];

export function classifyAgentError(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  timedOut: boolean,
  customQuotaPatterns: string[] = [],
): AgentErrorKind {
  if (timedOut) return 'timeout';
  if (exitCode === 0) return 'none';

  const combined = `${stderr}\n${stdout}`;
  for (const pat of customQuotaPatterns) {
    if (new RegExp(pat, 'i').test(combined)) {
      return 'quota_exceeded';
    }
  }
  for (const re of DEFAULT_QUOTA_PATTERNS) {
    if (re.test(combined)) return 'quota_exceeded';
  }
  for (const re of DEFAULT_RATE_LIMIT_PATTERNS) {
    if (re.test(combined)) return 'rate_limited';
  }
  for (const re of DEFAULT_AUTH_PATTERNS) {
    if (re.test(combined)) return 'auth_failed';
  }
  return 'runtime_error';
}
