import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  CliCodingAgentAdapter,
  DEFAULT_AGENT_PRESETS,
  classifyAgentError,
  resolveExecutable,
  runSubprocess,
} from '../src/index.js';

describe('ProcessRunner, Error Classification & Coding Adapters', () => {
  it('resolves node executable and streams stdin/stdout cleanly without shell injection', async () => {
    const nodePath = await resolveExecutable('node');
    expect(nodePath).toBeTruthy();

    const logs: string[] = [];
    const res = await runSubprocess({
      command: 'node',
      args: [
        '-e',
        'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log("ECHO:"+d.trim());console.error("ERR_LINE");});',
      ],
      cwd: process.cwd(),
      stdinText: 'hello "dragon" & $(whoami)',
      timeoutMs: 10_000,
      onLog: (_stream, line) => logs.push(line),
    });

    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.stdout).toContain('ECHO:hello "dragon" & $(whoami)');
    expect(logs).toContain('ERR_LINE');
  });

  it('classifies quota, rate limit, auth, and timeout errors accurately', () => {
    expect(classifyAgentError(1, '', 'Error: insufficient_quota for org', false)).toBe(
      'quota_exceeded',
    );
    expect(classifyAgentError(1, '', 'HTTP 429 rate limit exceeded', false)).toBe('rate_limited');
    expect(classifyAgentError(1, '', '401 Unauthorized: invalid api key', false)).toBe(
      'auth_failed',
    );
    expect(classifyAgentError(null, '', '', true)).toBe('timeout');
    expect(classifyAgentError(1, '', '', false, ['MY_CUSTOM_QUOTA_ERR'])).toBe('runtime_error');
    expect(classifyAgentError(1, 'MY_CUSTOM_QUOTA_ERR', '', false, ['MY_CUSTOM_QUOTA_ERR'])).toBe(
      'quota_exceeded',
    );
  });

  it('interpolates TemplateCliAdapter arguments cleanly', () => {
    const adapter = new CliCodingAgentAdapter({
      id: 'custom-bot',
      displayName: 'Custom Bot',
      type: 'template',
      enabled: true,
      command: 'my-cli',
      args: ['--extra'],
      model: 'deepseek-coder',
      strengths: ['bug-fix'],
      costTier: 'low',
      timeoutSec: 300,
      envAllowlist: [],
      promptMode: 'file',
      outputMode: 'text',
      template: {
        argsTemplate: ['run', '--cwd', '{{cwd}}', '--model', '{{model}}', '--file', '{{promptFile}}'],
        quotaErrorPatterns: ['NO_QUOTA'],
        versionArgs: ['--version'],
      },
    });

    const built = adapter.buildCommandArgs(
      {
        taskId: 't1',
        runId: 'r1',
        stage: 'implementing',
        cwd: 'D:\\repo',
        prompt: 'Fix bug',
        branchName: 'dragonflow/issue-1',
      },
      'C:\\temp\\prompt.md',
    );

    expect(built.args).toEqual([
      'run',
      '--cwd',
      'D:\\repo',
      '--model',
      'deepseek-coder',
      '--file',
      'C:\\temp\\prompt.md',
      '--extra',
    ]);
    expect(built.stdinText).toBeUndefined();
  });

  it('probes locally installed coding agent CLIs (claude, qodercli) without crashing', async () => {
    const subset = DEFAULT_AGENT_PRESETS.filter((p) =>
      ['claude', 'qodercli', 'codex'].includes(p.id),
    );
    const registry = new AgentRegistry(subset);
    const health = await registry.probeAll();

    expect(health).toHaveLength(3);
    const claude = health.find((h) => h.id === 'claude');
    const qoder = health.find((h) => h.id === 'qodercli');

    expect(claude?.available).toBe(true);
    expect(claude?.version).toMatch(/Claude/i);
    expect(qoder?.available).toBe(true);
    expect(qoder?.resolvedPath?.toLowerCase()).toContain('qodercli');
  }, 20_000);
});
