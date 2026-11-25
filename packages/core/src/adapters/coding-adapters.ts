import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentErrorKind,
  AgentHealthInfo,
  AgentProfile,
} from '@dragonflow/shared';
import {
  classifyAgentError,
  resolveExecutable,
  runSubprocess,
} from './process-runner.js';

export interface AgentExecContext {
  taskId: string;
  runId: string;
  stage: string;
  cwd: string;
  prompt: string;
  branchName?: string;
  readOnly?: boolean;
  onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
}

export interface AgentExecResult {
  success: boolean;
  outputText: string;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  errorKind: AgentErrorKind;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
}

export interface CodingAgentAdapter {
  readonly id: string;
  readonly profile: AgentProfile;
  probe(): Promise<AgentHealthInfo>;
  execute(ctx: AgentExecContext): Promise<AgentExecResult>;
}

function parseClaudeStreamJson(rawStdout: string): {
  text: string;
  tokensUsed: number;
  costUsd: number;
} {
  let finalResult = '';
  const textParts: string[] = [];
  let tokensUsed = 0;
  let costUsd = 0;

  for (const line of rawStdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as { content?: Array<{ type?: string; text?: string }> };
        for (const block of msg.content ?? []) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
      } else if (obj.type === 'result') {
        if (typeof obj.result === 'string') {
          finalResult = obj.result;
        }
        if (typeof obj.total_cost_usd === 'number') {
          costUsd = obj.total_cost_usd;
        }
        if (obj.usage && typeof obj.usage === 'object') {
          const u = obj.usage as Record<string, unknown>;
          const inp = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
          const out = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
          tokensUsed = inp + out;
        }
      }
    } catch {
      // ignore non-json lines
    }
  }

  return {
    text: finalResult || textParts.join('\n') || rawStdout,
    tokensUsed,
    costUsd,
  };
}

function parseGenericJsonOutput(rawStdout: string): {
  text: string;
  tokensUsed: number;
  costUsd: number;
} {
  const trimmed = rawStdout.trim();
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const text =
      (typeof obj.result === 'string' && obj.result) ||
      (typeof obj.response === 'string' && obj.response) ||
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.content === 'string' && obj.content) ||
      trimmed;
    const tokensUsed =
      typeof obj.total_tokens === 'number'
        ? obj.total_tokens
        : typeof obj.tokens === 'number'
          ? obj.tokens
          : 0;
    const costUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0;
    return { text, tokensUsed, costUsd };
  } catch {
    return { text: trimmed, tokensUsed: 0, costUsd: 0 };
  }
}

export class CliCodingAgentAdapter implements CodingAgentAdapter {
  public readonly id: string;

  constructor(public readonly profile: AgentProfile) {
    this.id = profile.id;
  }

  async probe(): Promise<AgentHealthInfo> {
    const now = new Date().toISOString();
    if (!this.profile.enabled) {
      return {
        id: this.profile.id,
        displayName: this.profile.displayName,
        type: this.profile.type,
        enabled: false,
        available: false,
        command: this.profile.command,
        strengths: this.profile.strengths,
        costTier: this.profile.costTier,
        lastCheckedAt: now,
        error: 'Disabled in config',
      };
    }

    const resolvedPath = await resolveExecutable(this.profile.command);
    if (!resolvedPath) {
      return {
        id: this.profile.id,
        displayName: this.profile.displayName,
        type: this.profile.type,
        enabled: true,
        available: false,
        command: this.profile.command,
        strengths: this.profile.strengths,
        costTier: this.profile.costTier,
        lastCheckedAt: now,
        error: `Command "${this.profile.command}" not found on PATH`,
      };
    }

    try {
      const versionArgs = this.profile.template?.versionArgs ?? ['--version'];
      const res = await runSubprocess({
        command: resolvedPath,
        args: versionArgs,
        cwd: process.cwd(),
        timeoutMs: 8000,
        envAllowlist: this.profile.envAllowlist,
      });
      const rawVersion = (res.stdout || res.stderr).trim().split(/\r?\n/)[0]?.trim();
      return {
        id: this.profile.id,
        displayName: this.profile.displayName,
        type: this.profile.type,
        enabled: true,
        available: true,
        command: this.profile.command,
        resolvedPath,
        version: rawVersion || 'detected',
        strengths: this.profile.strengths,
        costTier: this.profile.costTier,
        lastCheckedAt: now,
      };
    } catch (err) {
      return {
        id: this.profile.id,
        displayName: this.profile.displayName,
        type: this.profile.type,
        enabled: true,
        available: false,
        command: this.profile.command,
        resolvedPath,
        strengths: this.profile.strengths,
        costTier: this.profile.costTier,
        lastCheckedAt: now,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(ctx: AgentExecContext): Promise<AgentExecResult> {
    let tempDir: string | null = null;
    let promptFilePath = '';

    try {
      const needsFile =
        this.profile.promptMode === 'file' ||
        this.profile.template?.argsTemplate.some((a) => a.includes('{{promptFile}}'));

      if (needsFile) {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'dragonflow-prompt-'));
        promptFilePath = path.join(tempDir, 'prompt.md');
        await writeFile(promptFilePath, ctx.prompt, 'utf8');
      }

      const { args, stdinText } = this.buildCommandArgs(ctx, promptFilePath);
      ctx.onLog?.(
        'system',
        `[Adapter:${this.id}] Executing ${this.profile.command} ${args.join(' ')}`,
      );

      const res = await runSubprocess({
        command: this.profile.command,
        args,
        cwd: ctx.cwd,
        stdinText,
        timeoutMs: this.profile.timeoutSec * 1000,
        envAllowlist: this.profile.envAllowlist,
        onLog: (stream, line) => {
          if (this.profile.type === 'claude' && this.profile.outputMode === 'stream-json') {
            const readable = this.extractClaudeStreamLine(line);
            if (readable) {
              ctx.onLog?.(stream, readable);
            }
          } else {
            ctx.onLog?.(stream, line);
          }
        },
      });

      const errorKind = classifyAgentError(
        res.exitCode,
        res.stdout,
        res.stderr,
        res.timedOut,
        this.profile.template?.quotaErrorPatterns,
      );

      let outputText = res.stdout;
      let tokensUsed = 0;
      let costUsd = 0;

      if (this.profile.type === 'claude' && this.profile.outputMode === 'stream-json') {
        const parsed = parseClaudeStreamJson(res.stdout);
        outputText = parsed.text;
        tokensUsed = parsed.tokensUsed;
        costUsd = parsed.costUsd;
      } else if (this.profile.outputMode === 'json') {
        const parsed = parseGenericJsonOutput(res.stdout);
        outputText = parsed.text;
        tokensUsed = parsed.tokensUsed;
        costUsd = parsed.costUsd;
      }

      return {
        success: res.exitCode === 0 && !res.timedOut,
        outputText: outputText.trim(),
        rawStdout: res.stdout,
        rawStderr: res.stderr,
        exitCode: res.exitCode,
        errorKind,
        tokensUsed,
        costUsd,
        durationMs: res.durationMs,
      };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private extractClaudeStreamLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return line;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as { content?: Array<{ type?: string; text?: string; name?: string }> };
        const fragments: string[] = [];
        for (const block of msg.content ?? []) {
          if (block.type === 'text' && block.text) {
            fragments.push(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            fragments.push(`[tool_use] ${block.name}`);
          }
        }
        return fragments.length > 0 ? fragments.join(' | ') : null;
      }
      if (obj.type === 'result') {
        return `[result] is_error=${String(obj.is_error ?? false)} cost=$${String(obj.total_cost_usd ?? 0)}`;
      }
      return null;
    } catch {
      return line;
    }
  }

  public buildCommandArgs(
    ctx: AgentExecContext,
    promptFilePath: string,
  ): { args: string[]; stdinText?: string } {
    const extra = [...this.profile.args];

    if (this.profile.type === 'template' && this.profile.template) {
      const interpolated = this.profile.template.argsTemplate
        .map((token) =>
          token
            .replaceAll('{{prompt}}', ctx.prompt)
            .replaceAll('{{promptFile}}', promptFilePath)
            .replaceAll('{{cwd}}', ctx.cwd)
            .replaceAll('{{model}}', this.profile.model ?? '')
            .replaceAll('{{branch}}', ctx.branchName ?? ''),
        )
        .filter((t) => t.length > 0);
      return {
        args: [...interpolated, ...extra],
        stdinText: this.profile.promptMode === 'stdin' ? ctx.prompt : undefined,
      };
    }

    switch (this.profile.type) {
      case 'claude': {
        const args = ['-p', '--output-format', this.profile.outputMode === 'text' ? 'text' : 'stream-json'];
        if (this.profile.outputMode !== 'text') {
          args.push('--verbose');
        }
        args.push('--permission-mode', ctx.readOnly ? 'plan' : 'bypassPermissions');
        if (this.profile.model) args.push('--model', this.profile.model);
        if (this.profile.maxBudgetUsd) args.push('--max-budget-usd', String(this.profile.maxBudgetUsd));
        args.push(...extra);
        return { args, stdinText: ctx.prompt };
      }

      case 'qodercli': {
        const args = [
          '-p',
          '-w',
          ctx.cwd,
          '--permission-mode',
          ctx.readOnly ? 'default' : 'bypass_permissions',
        ];
        if (this.profile.model) args.push('-m', this.profile.model);
        if (this.profile.outputMode === 'json' || this.profile.outputMode === 'stream-json') {
          args.push('-o', this.profile.outputMode);
        }
        args.push(...extra);
        return { args, stdinText: ctx.prompt };
      }

      case 'codex': {
        const args = ['exec', '--full-auto'];
        if (this.profile.outputMode === 'json') args.push('--json');
        if (this.profile.model) args.push('-m', this.profile.model);
        args.push(...extra, '-');
        return { args, stdinText: ctx.prompt };
      }

      case 'gemini': {
        const args = ['-p', '', '--yolo'];
        if (this.profile.outputMode === 'json') args.push('--output-format', 'json');
        if (this.profile.model) args.push('-m', this.profile.model);
        args.push(...extra);
        return { args, stdinText: ctx.prompt };
      }

      case 'opencode': {
        const args = ['run'];
        if (this.profile.outputMode === 'json') args.push('--format', 'json');
        if (this.profile.model) args.push('-m', this.profile.model);
        args.push(...extra);
        return { args, stdinText: ctx.prompt };
      }

      case 'aider': {
        const args = ['--yes-always', '--no-auto-commits', '--message-file', promptFilePath];
        if (this.profile.model) args.push('--model', this.profile.model);
        args.push(...extra);
        return { args };
      }

      case 'workbuddy':
      case 'codebuddy': {
        const args = extra.length > 0 ? extra : ['-p'];
        if (this.profile.model) args.push('--model', this.profile.model);
        if (this.profile.promptMode === 'file') {
          args.push('--file', promptFilePath);
          return { args };
        }
        if (this.profile.promptMode === 'arg') {
          args.push(ctx.prompt);
          return { args };
        }
        return { args, stdinText: ctx.prompt };
      }

      default:
        return { args: extra, stdinText: ctx.prompt };
    }
  }
}

export type MockAgentBehavior = (ctx: AgentExecContext) => Promise<Partial<AgentExecResult>>;

export class MockCodingAgentAdapter implements CodingAgentAdapter {
  public readonly id: string;

  constructor(
    public readonly profile: AgentProfile,
    private readonly available = true,
    private readonly behavior?: MockAgentBehavior,
  ) {
    this.id = profile.id;
  }

  async probe(): Promise<AgentHealthInfo> {
    return {
      id: this.profile.id,
      displayName: this.profile.displayName,
      type: this.profile.type,
      enabled: this.profile.enabled,
      available: this.profile.enabled && this.available,
      command: this.profile.command,
      resolvedPath: this.available ? `mock://${this.profile.command}` : undefined,
      version: this.available ? 'mock-1.0.0' : undefined,
      strengths: this.profile.strengths,
      costTier: this.profile.costTier,
      lastCheckedAt: new Date().toISOString(),
      error: this.available ? undefined : 'Simulated unavailable CLI',
    };
  }

  async execute(ctx: AgentExecContext): Promise<AgentExecResult> {
    ctx.onLog?.('system', `[MockAgent:${this.id}] Starting stage "${ctx.stage}"`);
    const custom = this.behavior ? await this.behavior(ctx) : {};
    const result: AgentExecResult = {
      success: custom.success ?? true,
      outputText: custom.outputText ?? `[${this.id}] Completed stage ${ctx.stage}`,
      rawStdout: custom.rawStdout ?? `[${this.id}] ok`,
      rawStderr: custom.rawStderr ?? '',
      exitCode: custom.exitCode ?? (custom.success === false ? 1 : 0),
      errorKind: custom.errorKind ?? 'none',
      tokensUsed: custom.tokensUsed ?? 850,
      costUsd: custom.costUsd ?? 0.012,
      durationMs: custom.durationMs ?? 25,
    };
    ctx.onLog?.(
      result.success ? 'stdout' : 'stderr',
      `[MockAgent:${this.id}] Finished stage "${ctx.stage}" (success=${String(result.success)}, errorKind=${result.errorKind})`,
    );
    return result;
  }
}
