package github

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
)

type InMemoryGitHubClient struct {
	mu              sync.RWMutex
	localCloneURL   string
	nextIssueNumber int
	nextCommentID   int64
	nextReviewID    int64
	nextReleaseID   int64

	issues         map[int]domain.GitHubIssue
	comments       map[int][]domain.GitHubComment
	prs            map[int]domain.GitHubPullRequest
	checkRuns      map[int][]domain.GitHubCheckRun
	reviews        map[int][]domain.GitHubReview
	reviewComments map[int][]domain.GitHubReviewComment
	releases       []domain.GitHubRelease
}

func NewInMemoryGitHubClient(localCloneURL string) *InMemoryGitHubClient {
	return &InMemoryGitHubClient{
		localCloneURL:   localCloneURL,
		nextIssueNumber: 100,
		nextCommentID:   1000,
		nextReviewID:    5000,
		nextReleaseID:   9000,
		issues:          make(map[int]domain.GitHubIssue),
		comments:        make(map[int][]domain.GitHubComment),
		prs:             make(map[int]domain.GitHubPullRequest),
		checkRuns:       make(map[int][]domain.GitHubCheckRun),
		reviews:         make(map[int][]domain.GitHubReview),
		reviewComments:  make(map[int][]domain.GitHubReviewComment),
		releases:        []domain.GitHubRelease{},
	}
}

func (m *InMemoryGitHubClient) IsMock() bool { return true }

type SeedIssueInput struct {
	Number            int
	Title             string
	Body              string
	Author            string
	AuthorAssociation string
	Labels            []string
}

func (m *InMemoryGitHubClient) SeedIssue(in SeedIssueInput) domain.GitHubIssue {
	m.mu.Lock()
	defer m.mu.Unlock()

	num := in.Number
	if num <= 0 {
		m.nextIssueNumber++
		num = m.nextIssueNumber
	} else if num >= m.nextIssueNumber {
		m.nextIssueNumber = num
	}
	author := in.Author
	if author == "" {
		author = "contributor"
	}
	assoc := in.AuthorAssociation
	if assoc == "" {
		assoc = "NONE"
	}
	labels := append([]string{}, in.Labels...)
	if labels == nil {
		labels = []string{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	issue := domain.GitHubIssue{
		Number:            num,
		Title:             in.Title,
		Body:              in.Body,
		Author:            author,
		AuthorAssociation: assoc,
		Labels:            labels,
		State:             "open",
		URL:               fmt.Sprintf("https://github.com/dragonflow-org/demo/issues/%d", num),
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	m.issues[num] = issue
	return issue
}

func (m *InMemoryGitHubClient) SeedComment(issueNumber int, body, author, authorAssoc string) domain.GitHubComment {
	m.mu.Lock()
	defer m.mu.Unlock()

	if author == "" {
		author = "maintainer"
	}
	if authorAssoc == "" {
		authorAssoc = "OWNER"
	}
	m.nextCommentID++
	id := m.nextCommentID
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cm := domain.GitHubComment{
		ID:                id,
		Body:              body,
		Author:            author,
		AuthorAssociation: authorAssoc,
		CreatedAt:         now,
		UpdatedAt:         now,
		URL:               fmt.Sprintf("https://github.com/dragonflow-org/demo/issues/%d#issuecomment-%d", issueNumber, id),
	}
	m.comments[issueNumber] = append(m.comments[issueNumber], cm)
	if issue, ok := m.issues[issueNumber]; ok {
		issue.UpdatedAt = now
		m.issues[issueNumber] = issue
	}
	return cm
}

func (m *InMemoryGitHubClient) SetPrCheckRuns(prNumber int, runs []domain.GitHubCheckRun) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.checkRuns[prNumber] = append([]domain.GitHubCheckRun{}, runs...)
}

func (m *InMemoryGitHubClient) SeedPrReview(prNumber int, author, authorAssoc, state, body string) domain.GitHubReview {
	m.mu.Lock()
	defer m.mu.Unlock()
	if author == "" {
		author = "maintainer"
	}
	if authorAssoc == "" {
		authorAssoc = "OWNER"
	}
	m.nextReviewID++
	rev := domain.GitHubReview{
		ID:                m.nextReviewID,
		Author:            author,
		AuthorAssociation: authorAssoc,
		State:             state,
		Body:              body,
		SubmittedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	m.reviews[prNumber] = append(m.reviews[prNumber], rev)
	return rev
}

func (m *InMemoryGitHubClient) SeedReleasePr(title, headBranch string) domain.GitHubPullRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextIssueNumber++
	num := m.nextIssueNumber
	if title == "" {
		title = "chore(main): release 0.2.0"
	}
	if headBranch == "" {
		headBranch = "release-please--branches--main"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	pr := domain.GitHubPullRequest{
		Number:     num,
		Title:      title,
		Body:       "## Changelog\n- feat: automated release by DragonFlow",
		HeadBranch: headBranch,
		BaseBranch: "main",
		State:      "open",
		Merged:     false,
		URL:        fmt.Sprintf("https://github.com/dragonflow-org/demo/pull/%d", num),
		Labels:     []string{"autorelease: pending"},
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	m.prs[num] = pr
	return pr
}

func (m *InMemoryGitHubClient) SeedRelease(tagName, body string) domain.GitHubRelease {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextReleaseID++
	if body == "" {
		body = "Automated release notes"
	}
	rel := domain.GitHubRelease{
		ID:          m.nextReleaseID,
		TagName:     tagName,
		Name:        tagName,
		Body:        body,
		URL:         fmt.Sprintf("https://github.com/dragonflow-org/demo/releases/tag/%s", tagName),
		PublishedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	m.releases = append([]domain.GitHubRelease{rel}, m.releases...)
	return rel
}

func (m *InMemoryGitHubClient) GetRepoCloneURL(_ context.Context, _, _ string) (string, error) {
	return m.localCloneURL, nil
}

func (m *InMemoryGitHubClient) GetRepoSummary(_ context.Context, owner, repo string) (string, error) {
	return fmt.Sprintf("%s/%s (mock in-memory repository)", owner, repo), nil
}

func (m *InMemoryGitHubClient) ListOpenIssues(_ context.Context, _, _, _ string) ([]domain.GitHubIssue, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.GitHubIssue, 0)
	for _, is := range m.issues {
		if is.State == "open" {
			out = append(out, is)
		}
	}
	return out, nil
}

func (m *InMemoryGitHubClient) GetIssue(_ context.Context, _, _ string, issueNumber int) (domain.GitHubIssue, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	is, ok := m.issues[issueNumber]
	if !ok {
		return domain.GitHubIssue{}, fmt.Errorf("Mock issue #%d not found", issueNumber)
	}
	is.Labels = append([]string{}, is.Labels...)
	return is, nil
}

func (m *InMemoryGitHubClient) ListIssueComments(_ context.Context, _, _ string, issueNumber int) ([]domain.GitHubComment, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]domain.GitHubComment{}, m.comments[issueNumber]...), nil
}

func (m *InMemoryGitHubClient) CreateIssueComment(_ context.Context, _, _ string, issueNumber int, body string) (domain.GitHubComment, error) {
	return m.SeedComment(issueNumber, body, "dragonflow-bot", "COLLABORATOR"), nil
}

func (m *InMemoryGitHubClient) UpsertStatusCard(_ context.Context, owner, repo string, issueNumber int, markdownBody string, knownCommentID *int64) (int64, error) {
	fullBody := StatusCardMarker + "\n" + markdownBody
	m.mu.Lock()
	list := m.comments[issueNumber]
	targetIdx := -1
	if knownCommentID != nil {
		for i, c := range list {
			if c.ID == *knownCommentID {
				targetIdx = i
				break
			}
		}
	}
	if targetIdx == -1 {
		for i, c := range list {
			if strings.Contains(c.Body, StatusCardMarker) {
				targetIdx = i
				break
			}
		}
	}
	if targetIdx != -1 {
		list[targetIdx].Body = fullBody
		list[targetIdx].UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		m.comments[issueNumber] = list
		id := list[targetIdx].ID
		m.mu.Unlock()
		return id, nil
	}
	m.mu.Unlock()

	created, err := m.CreateIssueComment(context.Background(), owner, repo, issueNumber, fullBody)
	if err != nil {
		return 0, err
	}
	return created.ID, nil
}

func (m *InMemoryGitHubClient) AddLabels(_ context.Context, _, _ string, issueNumber int, labels []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	is, ok := m.issues[issueNumber]
	if !ok {
		return nil
	}
	for _, l := range labels {
		if l != "" && !slices.Contains(is.Labels, l) {
			is.Labels = append(is.Labels, l)
		}
	}
	m.issues[issueNumber] = is
	return nil
}

func (m *InMemoryGitHubClient) RemoveLabel(_ context.Context, _, _ string, issueNumber int, label string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	is, ok := m.issues[issueNumber]
	if !ok {
		return nil
	}
	filtered := make([]string, 0, len(is.Labels))
	for _, l := range is.Labels {
		if l != label {
			filtered = append(filtered, l)
		}
	}
	is.Labels = filtered
	m.issues[issueNumber] = is
	return nil
}

func (m *InMemoryGitHubClient) CreatePullRequest(_ context.Context, owner, repo string, params CreatePrParams) (domain.GitHubPullRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextIssueNumber++
	num := m.nextIssueNumber
	now := time.Now().UTC().Format(time.RFC3339Nano)
	labels := append([]string{}, params.Labels...)
	if labels == nil {
		labels = []string{}
	}
	pr := domain.GitHubPullRequest{
		Number:     num,
		Title:      params.Title,
		Body:       params.Body,
		HeadBranch: params.HeadBranch,
		BaseBranch: params.BaseBranch,
		State:      "open",
		Merged:     false,
		URL:        fmt.Sprintf("https://github.com/%s/%s/pull/%d", owner, repo, num),
		Labels:     labels,
		Draft:      params.Draft,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	m.prs[num] = pr
	if _, hasChecks := m.checkRuns[num]; !hasChecks {
		m.checkRuns[num] = []domain.GitHubCheckRun{
			{
				ID:            int64(num*10 + 1),
				Name:          "ci / test & build",
				Status:        "completed",
				Conclusion:    "success",
				OutputTitle:   "All checks passed",
				OutputSummary: "Lint, verification, and unit tests passed.",
			},
		}
	}
	return pr, nil
}

func (m *InMemoryGitHubClient) GetPullRequest(_ context.Context, _, _ string, prNumber int) (domain.GitHubPullRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	pr, ok := m.prs[prNumber]
	if !ok {
		return domain.GitHubPullRequest{}, fmt.Errorf("Mock PR #%d not found", prNumber)
	}
	return pr, nil
}

func (m *InMemoryGitHubClient) ListPullRequests(_ context.Context, _, _, state string) ([]domain.GitHubPullRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if state == "" {
		state = "open"
	}
	out := make([]domain.GitHubPullRequest, 0)
	for _, pr := range m.prs {
		if state == "all" || pr.State == state {
			out = append(out, pr)
		}
	}
	return out, nil
}

func (m *InMemoryGitHubClient) ListPrCheckRuns(_ context.Context, _, _ string, prNumber int) ([]domain.GitHubCheckRun, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]domain.GitHubCheckRun{}, m.checkRuns[prNumber]...), nil
}

func (m *InMemoryGitHubClient) ListPrReviews(_ context.Context, _, _ string, prNumber int) ([]domain.GitHubReview, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]domain.GitHubReview{}, m.reviews[prNumber]...), nil
}

func (m *InMemoryGitHubClient) ListPrReviewComments(_ context.Context, _, _ string, prNumber int) ([]domain.GitHubReviewComment, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]domain.GitHubReviewComment{}, m.reviewComments[prNumber]...), nil
}

func (m *InMemoryGitHubClient) MergePullRequest(_ context.Context, _, _ string, prNumber int, _, _ string) (MergeResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pr, ok := m.prs[prNumber]
	if !ok {
		return MergeResult{}, fmt.Errorf("Mock PR #%d not found", prNumber)
	}
	pr.Merged = true
	pr.State = "closed"
	pr.MergeCommitSha = fmt.Sprintf("mocksha-%d", prNumber)
	pr.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	m.prs[prNumber] = pr
	return MergeResult{Merged: true, Sha: pr.MergeCommitSha}, nil
}

func (m *InMemoryGitHubClient) ListReleases(_ context.Context, _, _ string) ([]domain.GitHubRelease, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]domain.GitHubRelease{}, m.releases...), nil
}
