import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GitHubComment, GitHubIssue } from '@dragonflow/shared';

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const digest = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  const expectedBuf = Buffer.from(digest, 'utf8');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actualBuf, expectedBuf);
}

export interface WebhookOrchestratorTarget {
  ingestIssue(repoFullName: string, issue: GitHubIssue): Promise<unknown>;
  handleComment(repoFullName: string, issueNumber: number, comment: GitHubComment): Promise<unknown>;
  pollOpenPrs(repoFullName?: string): Promise<number>;
}

export class GitHubWebhookHandler {
  constructor(
    private readonly orchestrator: WebhookOrchestratorTarget,
    private readonly secret?: string,
  ) {}

  async handleEvent(input: {
    eventName: string;
    signatureHeader?: string;
    rawBody: string;
  }): Promise<{ accepted: boolean; action?: string; reason?: string }> {
    if (this.secret) {
      const ok = verifyWebhookSignature(input.rawBody, input.signatureHeader, this.secret);
      if (!ok) {
        return { accepted: false, reason: 'Invalid webhook signature' };
      }
    }

    const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    const repoObj = payload.repository as { full_name?: string } | undefined;
    const repoFullName = repoObj?.full_name;
    if (!repoFullName) {
      return { accepted: false, reason: 'Missing repository.full_name in payload' };
    }

    if (input.eventName === 'issues') {
      const action = String(payload.action ?? '');
      if (['opened', 'edited', 'labeled', 'reopened'].includes(action)) {
        const raw = payload.issue as Record<string, unknown>;
        const labels = Array.isArray(raw.labels)
          ? raw.labels.map((l) => (typeof l === 'string' ? l : (l as { name?: string }).name ?? '')).filter(Boolean)
          : [];
        const user = raw.user as { login?: string } | undefined;
        await this.orchestrator.ingestIssue(repoFullName, {
          number: Number(raw.number),
          title: String(raw.title ?? ''),
          body: String(raw.body ?? ''),
          author: user?.login ?? 'unknown',
          authorAssociation: String(raw.author_association ?? 'NONE'),
          labels,
          state: raw.state === 'closed' ? 'closed' : 'open',
          url: String(raw.html_url ?? ''),
          createdAt: String(raw.created_at ?? new Date().toISOString()),
          updatedAt: String(raw.updated_at ?? new Date().toISOString()),
        });
        return { accepted: true, action: `issues:${action}` };
      }
    }

    if (input.eventName === 'issue_comment' && payload.action === 'created') {
      const rawIssue = payload.issue as { number: number };
      const rawComment = payload.comment as Record<string, unknown>;
      const user = rawComment.user as { login?: string } | undefined;
      await this.orchestrator.handleComment(repoFullName, Number(rawIssue.number), {
        id: Number(rawComment.id),
        body: String(rawComment.body ?? ''),
        author: user?.login ?? 'unknown',
        authorAssociation: String(rawComment.author_association ?? 'NONE'),
        createdAt: String(rawComment.created_at ?? new Date().toISOString()),
        updatedAt: String(rawComment.updated_at ?? new Date().toISOString()),
        url: rawComment.html_url ? String(rawComment.html_url) : undefined,
      });
      return { accepted: true, action: 'issue_comment:created' };
    }

    if (
      input.eventName === 'pull_request' ||
      input.eventName === 'pull_request_review' ||
      input.eventName === 'check_suite' ||
      input.eventName === 'check_run' ||
      input.eventName === 'release'
    ) {
      await this.orchestrator.pollOpenPrs(repoFullName);
      return { accepted: true, action: input.eventName };
    }

    return { accepted: true, action: `ignored:${input.eventName}` };
  }
}
