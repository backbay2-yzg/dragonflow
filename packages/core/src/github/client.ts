import { Octokit } from '@octokit/rest';
import type {
  GitHubCheckRun,
  GitHubComment,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRelease,
  GitHubReview,
  GitHubReviewComment,
} from '@dragonflow/shared';

export const STATUS_CARD_MARKER = '<!-- dragonflow:status-card -->';

export interface CreatePrParams {
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  draft?: boolean;
  labels?: string[];
}

export interface GitHubClient {
  readonly isMock: boolean;
  getRepoCloneUrl(owner: string, repo: string): Promise<string>;
  getRepoSummary(owner: string, repo: string): Promise<string>;
  listOpenIssues(owner: string, repo: string, since?: string): Promise<GitHubIssue[]>;
  getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue>;
  listIssueComments(owner: string, repo: string, issueNumber: number): Promise<GitHubComment[]>;
  createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubComment>;
  upsertStatusCard(
    owner: string,
    repo: string,
    issueNumber: number,
    markdownBody: string,
    knownCommentId?: number,
  ): Promise<number>;
  addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void>;
  createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams,
  ): Promise<GitHubPullRequest>;
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest>;
  listPullRequests(
    owner: string,
    repo: string,
    state?: 'open' | 'closed' | 'all',
  ): Promise<GitHubPullRequest[]>;
  listPrCheckRuns(owner: string, repo: string, prNumber: number): Promise<GitHubCheckRun[]>;
  listPrReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]>;
  listPrReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GitHubReviewComment[]>;
  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    method?: 'squash' | 'merge' | 'rebase',
    commitTitle?: string,
  ): Promise<{ merged: boolean; sha?: string }>;
  listReleases(owner: string, repo: string): Promise<GitHubRelease[]>;
}

export class OctokitGitHubClient implements GitHubClient {
  public readonly isMock = false;
  private readonly octokit: Octokit;

  constructor(private readonly token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getRepoCloneUrl(owner: string, repo: string): Promise<string> {
    if (this.token) {
      return `https://x-access-token:${this.token}@github.com/${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }

  async getRepoSummary(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return `${data.full_name} (lang=${data.language ?? 'unknown'}, stars=${data.stargazers_count}): ${data.description ?? ''}`;
  }

  async listOpenIssues(owner: string, repo: string, since?: string): Promise<GitHubIssue[]> {
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
      ...(since ? { since } : {}),
    });

    return data
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body ?? '',
        author: item.user?.login ?? 'unknown',
        authorAssociation: item.author_association ?? 'NONE',
        labels: item.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
        state: item.state === 'closed' ? 'closed' : 'open',
        url: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    const { data } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      author: data.user?.login ?? 'unknown',
      authorAssociation: data.author_association ?? 'NONE',
      labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
      state: data.state === 'closed' ? 'closed' : 'open',
      url: data.html_url,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      isPullRequest: Boolean(data.pull_request),
    };
  }

  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubComment[]> {
    const { data } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    return data.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      author: c.user?.login ?? 'unknown',
      authorAssociation: c.author_association ?? 'NONE',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      url: c.html_url,
    }));
  }

  async createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubComment> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return {
      id: data.id,
      body: data.body ?? '',
      author: data.user?.login ?? 'dragonflow-bot',
      authorAssociation: data.author_association ?? 'COLLABORATOR',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.html_url,
    };
  }

  async upsertStatusCard(
    owner: string,
    repo: string,
    issueNumber: number,
    markdownBody: string,
    knownCommentId?: number,
  ): Promise<number> {
    const fullBody = `${STATUS_CARD_MARKER}\n${markdownBody}`;

    if (knownCommentId) {
      try {
        await this.octokit.issues.updateComment({
          owner,
          repo,
          comment_id: knownCommentId,
          body: fullBody,
        });
        return knownCommentId;
      } catch {
        // fall through to search/create
      }
    }

    const comments = await this.listIssueComments(owner, repo, issueNumber);
    const existing = comments.find((c) => c.body.includes(STATUS_CARD_MARKER));
    if (existing) {
      await this.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: fullBody,
      });
      return existing.id;
    }

    const created = await this.createIssueComment(owner, repo, issueNumber, fullBody);
    return created.id;
  }

  async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels });
  }

  async removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label });
    } catch {
      // ignore if label not present
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams,
  ): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: params.title,
      body: params.body,
      head: params.headBranch,
      base: params.baseBranch,
      draft: params.draft ?? false,
    });
    if (params.labels && params.labels.length > 0) {
      await this.addLabels(owner, repo, data.number, params.labels);
    }
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      state: data.state === 'closed' ? 'closed' : 'open',
      merged: data.merged ?? false,
      mergeCommitSha: data.merge_commit_sha ?? undefined,
      url: data.html_url,
      labels: params.labels ?? [],
      draft: data.draft,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      state: data.state === 'closed' ? 'closed' : 'open',
      merged: data.merged,
      mergeCommitSha: data.merge_commit_sha ?? undefined,
      url: data.html_url,
      labels: data.labels.map((l) => l.name ?? '').filter(Boolean),
      draft: data.draft,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async listPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
  ): Promise<GitHubPullRequest[]> {
    const { data } = await this.octokit.pulls.list({ owner, repo, state, per_page: 50 });
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      state: pr.state === 'closed' ? 'closed' : 'open',
      merged: Boolean(pr.merged_at),
      mergeCommitSha: pr.merge_commit_sha ?? undefined,
      url: pr.html_url,
      labels: pr.labels.map((l) => l.name ?? '').filter(Boolean),
      draft: pr.draft,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    }));
  }

  async listPrCheckRuns(owner: string, repo: string, prNumber: number): Promise<GitHubCheckRun[]> {
    const pr = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    const { data } = await this.octokit.checks.listForRef({
      owner,
      repo,
      ref: pr.data.head.sha,
      per_page: 50,
    });
    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status as GitHubCheckRun['status'],
      conclusion: (cr.conclusion as GitHubCheckRun['conclusion']) ?? null,
      detailsUrl: cr.details_url ?? undefined,
      outputTitle: cr.output.title ?? undefined,
      outputSummary: cr.output.summary ?? undefined,
    }));
  }

  async listPrReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
    const { data } = await this.octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 50,
    });
    return data.map((r) => ({
      id: r.id,
      author: r.user?.login ?? 'unknown',
      authorAssociation: r.author_association ?? 'NONE',
      state: r.state as GitHubReview['state'],
      body: r.body ?? '',
      submittedAt: r.submitted_at ?? new Date().toISOString(),
    }));
  }

  async listPrReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GitHubReviewComment[]> {
    const { data } = await this.octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return data.map((c) => ({
      id: c.id,
      author: c.user?.login ?? 'unknown',
      path: c.path,
      line: c.line ?? undefined,
      body: c.body,
      createdAt: c.created_at,
    }));
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    method: 'squash' | 'merge' | 'rebase' = 'squash',
    commitTitle?: string,
  ): Promise<{ merged: boolean; sha?: string }> {
    const { data } = await this.octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: method,
      ...(commitTitle ? { commit_title: commitTitle } : {}),
    });
    return { merged: data.merged, sha: data.sha };
  }

  async listReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    const { data } = await this.octokit.repos.listReleases({ owner, repo, per_page: 20 });
    return data.map((r) => ({
      id: r.id,
      tagName: r.tag_name,
      name: r.name ?? r.tag_name,
      body: r.body ?? '',
      url: r.html_url,
      publishedAt: r.published_at ?? r.created_at,
      draft: r.draft,
      prerelease: r.prerelease,
    }));
  }
}

export class InMemoryGitHubClient implements GitHubClient {
  public readonly isMock = true;
  private nextIssueNumber = 100;
  private nextCommentId = 1000;
  private nextReviewId = 5000;
  private nextReleaseId = 9000;

  private readonly issues = new Map<number, GitHubIssue>();
  private readonly comments = new Map<number, GitHubComment[]>();
  private readonly prs = new Map<number, GitHubPullRequest>();
  private readonly checkRuns = new Map<number, GitHubCheckRun[]>();
  private readonly reviews = new Map<number, GitHubReview[]>();
  private readonly reviewComments = new Map<number, GitHubReviewComment[]>();
  private readonly releases: GitHubRelease[] = [];

  constructor(private readonly localCloneUrl = '') {}

  seedIssue(input: {
    number?: number;
    title: string;
    body: string;
    author?: string;
    authorAssociation?: string;
    labels?: string[];
  }): GitHubIssue {
    const num = input.number ?? ++this.nextIssueNumber;
    if (num >= this.nextIssueNumber) this.nextIssueNumber = num;
    const now = new Date().toISOString();
    const issue: GitHubIssue = {
      number: num,
      title: input.title,
      body: input.body,
      author: input.author ?? 'contributor',
      authorAssociation: input.authorAssociation ?? 'NONE',
      labels: [...(input.labels ?? [])],
      state: 'open',
      url: `https://github.com/dragonflow-org/demo/issues/${num}`,
      createdAt: now,
      updatedAt: now,
    };
    this.issues.set(num, issue);
    return issue;
  }

  seedComment(
    issueNumber: number,
    body: string,
    author = 'maintainer',
    authorAssociation = 'OWNER',
  ): GitHubComment {
    const id = ++this.nextCommentId;
    const now = new Date().toISOString();
    const comment: GitHubComment = {
      id,
      body,
      author,
      authorAssociation,
      createdAt: now,
      updatedAt: now,
      url: `https://github.com/dragonflow-org/demo/issues/${issueNumber}#issuecomment-${id}`,
    };
    const list = this.comments.get(issueNumber) ?? [];
    list.push(comment);
    this.comments.set(issueNumber, list);
    const issue = this.issues.get(issueNumber);
    if (issue) issue.updatedAt = now;
    return comment;
  }

  setPrCheckRuns(prNumber: number, runs: GitHubCheckRun[]): void {
    this.checkRuns.set(prNumber, runs);
  }

  seedPrReview(
    prNumber: number,
    input: {
      author?: string;
      authorAssociation?: string;
      state: GitHubReview['state'];
      body: string;
    },
  ): GitHubReview {
    const review: GitHubReview = {
      id: ++this.nextReviewId,
      author: input.author ?? 'maintainer',
      authorAssociation: input.authorAssociation ?? 'OWNER',
      state: input.state,
      body: input.body,
      submittedAt: new Date().toISOString(),
    };
    const list = this.reviews.get(prNumber) ?? [];
    list.push(review);
    this.reviews.set(prNumber, list);
    return review;
  }

  seedReleasePr(input: { title?: string; headBranch?: string }): GitHubPullRequest {
    const num = ++this.nextIssueNumber;
    const now = new Date().toISOString();
    const pr: GitHubPullRequest = {
      number: num,
      title: input.title ?? 'chore(main): release 0.2.0',
      body: '## Changelog\n- feat: automated release by DragonFlow',
      headBranch: input.headBranch ?? 'release-please--branches--main',
      baseBranch: 'main',
      state: 'open',
      merged: false,
      url: `https://github.com/dragonflow-org/demo/pull/${num}`,
      labels: ['autorelease: pending'],
      createdAt: now,
      updatedAt: now,
    };
    this.prs.set(num, pr);
    return pr;
  }

  seedRelease(tagName: string, body = 'Automated release notes'): GitHubRelease {
    const release: GitHubRelease = {
      id: ++this.nextReleaseId,
      tagName,
      name: tagName,
      body,
      url: `https://github.com/dragonflow-org/demo/releases/tag/${tagName}`,
      publishedAt: new Date().toISOString(),
      draft: false,
      prerelease: false,
    };
    this.releases.unshift(release);
    return release;
  }

  async getRepoCloneUrl(_owner: string, _repo: string): Promise<string> {
    return this.localCloneUrl;
  }

  async getRepoSummary(owner: string, repo: string): Promise<string> {
    return `${owner}/${repo} (mock in-memory repository)`;
  }

  async listOpenIssues(): Promise<GitHubIssue[]> {
    return Array.from(this.issues.values()).filter((i) => i.state === 'open');
  }

  async getIssue(_owner: string, _repo: string, issueNumber: number): Promise<GitHubIssue> {
    const issue = this.issues.get(issueNumber);
    if (!issue) throw new Error(`Mock issue #${issueNumber} not found`);
    return { ...issue, labels: [...issue.labels] };
  }

  async listIssueComments(
    _owner: string,
    _repo: string,
    issueNumber: number,
  ): Promise<GitHubComment[]> {
    return [...(this.comments.get(issueNumber) ?? [])];
  }

  async createIssueComment(
    _owner: string,
    _repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubComment> {
    return this.seedComment(issueNumber, body, 'dragonflow-bot', 'COLLABORATOR');
  }

  async upsertStatusCard(
    owner: string,
    repo: string,
    issueNumber: number,
    markdownBody: string,
    knownCommentId?: number,
  ): Promise<number> {
    const fullBody = `${STATUS_CARD_MARKER}\n${markdownBody}`;
    const list = this.comments.get(issueNumber) ?? [];
    const target =
      (knownCommentId && list.find((c) => c.id === knownCommentId)) ||
      list.find((c) => c.body.includes(STATUS_CARD_MARKER));

    if (target) {
      target.body = fullBody;
      target.updatedAt = new Date().toISOString();
      return target.id;
    }

    const created = await this.createIssueComment(owner, repo, issueNumber, fullBody);
    return created.id;
  }

  async addLabels(_owner: string, _repo: string, issueNumber: number, labels: string[]): Promise<void> {
    const issue = this.issues.get(issueNumber);
    if (!issue) return;
    const set = new Set([...issue.labels, ...labels]);
    issue.labels = Array.from(set);
  }

  async removeLabel(_owner: string, _repo: string, issueNumber: number, label: string): Promise<void> {
    const issue = this.issues.get(issueNumber);
    if (!issue) return;
    issue.labels = issue.labels.filter((l) => l !== label);
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams,
  ): Promise<GitHubPullRequest> {
    const num = ++this.nextIssueNumber;
    const now = new Date().toISOString();
    const pr: GitHubPullRequest = {
      number: num,
      title: params.title,
      body: params.body,
      headBranch: params.headBranch,
      baseBranch: params.baseBranch,
      state: 'open',
      merged: false,
      url: `https://github.com/${owner}/${repo}/pull/${num}`,
      labels: params.labels ?? [],
      draft: params.draft,
      createdAt: now,
      updatedAt: now,
    };
    this.prs.set(num, pr);
    if (!this.checkRuns.has(num)) {
      this.checkRuns.set(num, [
        {
          id: num * 10 + 1,
          name: 'ci / test & build',
          status: 'completed',
          conclusion: 'success',
          outputTitle: 'All checks passed',
          outputSummary: 'Lint, typecheck, and unit tests passed.',
        },
      ]);
    }
    return pr;
  }

  async getPullRequest(_owner: string, _repo: string, prNumber: number): Promise<GitHubPullRequest> {
    const pr = this.prs.get(prNumber);
    if (!pr) throw new Error(`Mock PR #${prNumber} not found`);
    return { ...pr };
  }

  async listPullRequests(
    _owner: string,
    _repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
  ): Promise<GitHubPullRequest[]> {
    return Array.from(this.prs.values()).filter((pr) =>
      state === 'all' ? true : pr.state === state,
    );
  }

  async listPrCheckRuns(_owner: string, _repo: string, prNumber: number): Promise<GitHubCheckRun[]> {
    return [...(this.checkRuns.get(prNumber) ?? [])];
  }

  async listPrReviews(_owner: string, _repo: string, prNumber: number): Promise<GitHubReview[]> {
    return [...(this.reviews.get(prNumber) ?? [])];
  }

  async listPrReviewComments(
    _owner: string,
    _repo: string,
    prNumber: number,
  ): Promise<GitHubReviewComment[]> {
    return [...(this.reviewComments.get(prNumber) ?? [])];
  }

  async mergePullRequest(
    _owner: string,
    _repo: string,
    prNumber: number,
  ): Promise<{ merged: boolean; sha?: string }> {
    const pr = this.prs.get(prNumber);
    if (!pr) throw new Error(`Mock PR #${prNumber} not found`);
    pr.merged = true;
    pr.state = 'closed';
    pr.mergeCommitSha = `mocksha-${prNumber}`;
    pr.updatedAt = new Date().toISOString();
    return { merged: true, sha: pr.mergeCommitSha };
  }

  async listReleases(): Promise<GitHubRelease[]> {
    return [...this.releases];
  }
}
