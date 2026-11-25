import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorktreeRunner } from '../src/index.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

describe('GitWorktreeRunner', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const dir of tempRoots) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    tempRoots.length = 0;
  });

  it('creates isolated worktrees, extracts diff, creates Conventional Commit, and cleans up', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dragonflow-wt-test-'));
    tempRoots.push(tmp);

    const bareRepo = path.join(tmp, 'origin.git');
    const seedRepo = path.join(tmp, 'seed');
    const reposRoot = path.join(tmp, 'repos');
    const worktreeRoot = path.join(tmp, 'worktrees');

    await git(['init', '--bare', bareRepo], tmp);
    await git(['clone', bareRepo, seedRepo], tmp);
    await git(['config', 'user.name', 'Test'], seedRepo);
    await git(['config', 'user.email', 'test@example.com'], seedRepo);
    await git(['checkout', '-B', 'main'], seedRepo);
    await writeFile(path.join(seedRepo, 'README.md'), '# Demo\n', 'utf8');
    await git(['add', '-A'], seedRepo);
    await git(['commit', '-m', 'chore: init'], seedRepo);
    await git(['push', '-u', 'origin', 'main'], seedRepo);

    const runner = new GitWorktreeRunner(reposRoot, worktreeRoot);
    const wt1 = await runner.createTaskWorkspace(
      'task-1',
      'acme/demo',
      bareRepo,
      'dragonflow/issue-1',
      'main',
    );
    const wt2 = await runner.createTaskWorkspace(
      'task-2',
      'acme/demo',
      bareRepo,
      'dragonflow/issue-2',
      'main',
    );

    expect(wt1).not.toBe(wt2);
    await writeFile(path.join(wt1, 'README.md'), '# Demo Updated\n', 'utf8');
    await writeFile(path.join(wt1, 'new-file.txt'), 'hello\n', 'utf8');

    // wt2 stays completely clean & isolated
    expect((await readFile(path.join(wt2, 'README.md'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
      '# Demo\n',
    );

    const diff = await runner.getDiff(wt1, 'main');
    expect(diff).toContain('Demo Updated');
    expect(diff).toContain('new-file.txt');

    const commitRes = await runner.commitAndPush(
      wt1,
      'docs(issue-1): update readme',
      'dragonflow/issue-1',
      true,
    );
    expect(commitRes.committed).toBe(true);
    expect(commitRes.pushed).toBe(true);
    expect(commitRes.changedFiles).toContain('README.md');

    await runner.cleanupWorkspace('acme/demo', wt1);
    await runner.cleanupWorkspace('acme/demo', wt2);
  });
});
