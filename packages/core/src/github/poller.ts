import type { DragonFlowConfig } from '@dragonflow/shared';
import type { DragonFlowRepository } from '../db/repository.js';
import type { GitHubClient } from './client.js';
import type { DragonFlowOrchestrator } from '../workflow/orchestrator.js';

export class GitHubPoller {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(
    private readonly config: DragonFlowConfig,
    private readonly github: GitHubClient,
    private readonly repo: DragonFlowRepository,
    private readonly orchestrator: DragonFlowOrchestrator,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(5, this.config.github.pollIntervalSec) * 1000;
    this.timer = setInterval(() => {
      void this.syncOnce().catch(() => undefined);
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncOnce(): Promise<{ issuesProcessed: number; prsChecked: number }> {
    if (this.syncing) {
      return { issuesProcessed: 0, prsChecked: 0 };
    }
    this.syncing = true;
    let issuesProcessed = 0;
    let prsChecked = 0;

    try {
      for (const r of this.config.github.repositories) {
        if (!r.enabled) continue;
        const fullName = `${r.owner}/${r.repo}`;
        const issues = await this.github.listOpenIssues(r.owner, r.repo);

        for (const issue of issues) {
          await this.orchestrator.ingestIssue(fullName, issue);
          const comments = await this.github.listIssueComments(r.owner, r.repo, issue.number);
          for (const comment of comments) {
            await this.orchestrator.handleComment(fullName, issue.number, comment);
          }
          issuesProcessed += 1;
        }

        prsChecked += await this.orchestrator.pollOpenPrs(fullName);
        this.repo.savePollerState(fullName, {
          lastIssuePollAt: new Date().toISOString(),
          lastPrPollAt: new Date().toISOString(),
        });
      }
      return { issuesProcessed, prsChecked };
    } finally {
      this.syncing = false;
    }
  }
}
