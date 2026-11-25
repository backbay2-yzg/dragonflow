package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
)

const StatusCardMarker = "<!-- dragonflow:status-card -->"

type CreatePrParams struct {
	Title      string
	Body       string
	HeadBranch string
	BaseBranch string
	Draft      bool
	Labels     []string
}

type MergeResult struct {
	Merged bool
	Sha    string
}

type GitHubClient interface {
	IsMock() bool
	GetRepoCloneURL(ctx context.Context, owner, repo string) (string, error)
	GetRepoSummary(ctx context.Context, owner, repo string) (string, error)
	ListOpenIssues(ctx context.Context, owner, repo, since string) ([]domain.GitHubIssue, error)
	GetIssue(ctx context.Context, owner, repo string, issueNumber int) (domain.GitHubIssue, error)
	ListIssueComments(ctx context.Context, owner, repo string, issueNumber int) ([]domain.GitHubComment, error)
	CreateIssueComment(ctx context.Context, owner, repo string, issueNumber int, body string) (domain.GitHubComment, error)
	UpsertStatusCard(ctx context.Context, owner, repo string, issueNumber int, markdownBody string, knownCommentID *int64) (int64, error)
	AddLabels(ctx context.Context, owner, repo string, issueNumber int, labels []string) error
	RemoveLabel(ctx context.Context, owner, repo string, issueNumber int, label string) error
	CreatePullRequest(ctx context.Context, owner, repo string, params CreatePrParams) (domain.GitHubPullRequest, error)
	GetPullRequest(ctx context.Context, owner, repo string, prNumber int) (domain.GitHubPullRequest, error)
	ListPullRequests(ctx context.Context, owner, repo, state string) ([]domain.GitHubPullRequest, error)
	ListPrCheckRuns(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubCheckRun, error)
	ListPrReviews(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubReview, error)
	ListPrReviewComments(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubReviewComment, error)
	MergePullRequest(ctx context.Context, owner, repo string, prNumber int, method, commitTitle string) (MergeResult, error)
	ListReleases(ctx context.Context, owner, repo string) ([]domain.GitHubRelease, error)
}

type RESTGitHubClient struct {
	token      string
	baseURL    string
	httpClient *http.Client
}

func NewRESTGitHubClient(token string) *RESTGitHubClient {
	return &RESTGitHubClient{
		token:   strings.TrimSpace(token),
		baseURL: "https://api.github.com",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *RESTGitHubClient) IsMock() bool { return false }

func (c *RESTGitHubClient) doJSON(ctx context.Context, method, path string, body any, out any) (int, error) {
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "DragonFlow-Desktop/0.1.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	rawResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("GitHub API %s %s failed (%d): %s", method, path, resp.StatusCode, strings.TrimSpace(string(rawResp)))
	}
	if out != nil && len(rawResp) > 0 {
		if err := json.Unmarshal(rawResp, out); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

func (c *RESTGitHubClient) GetRepoCloneURL(_ context.Context, owner, repo string) (string, error) {
	if c.token != "" {
		return fmt.Sprintf("https://x-access-token:%s@github.com/%s/%s.git", c.token, owner, repo), nil
	}
	return fmt.Sprintf("https://github.com/%s/%s.git", owner, repo), nil
}

func (c *RESTGitHubClient) GetRepoSummary(ctx context.Context, owner, repo string) (string, error) {
	var data struct {
		FullName    string `json:"full_name"`
		Language    string `json:"language"`
		Stars       int    `json:"stargazers_count"`
		Description string `json:"description"`
	}
	if _, err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s", owner, repo), nil, &data); err != nil {
		return "", err
	}
	lang := data.Language
	if lang == "" {
		lang = "unknown"
	}
	return fmt.Sprintf("%s (lang=%s, stars=%d): %s", data.FullName, lang, data.Stars, data.Description), nil
}

type apiLabel struct {
	Name string `json:"name"`
}

func extractLabels(raw []any) []string {
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		switch v := item.(type) {
		case string:
			if v != "" {
				out = append(out, v)
			}
		case map[string]any:
			if n, ok := v["name"].(string); ok && n != "" {
				out = append(out, n)
			}
		}
	}
	return out
}

func (c *RESTGitHubClient) ListOpenIssues(ctx context.Context, owner, repo, since string) ([]domain.GitHubIssue, error) {
	q := url.Values{}
	q.Set("state", "open")
	q.Set("sort", "updated")
	q.Set("direction", "desc")
	q.Set("per_page", "50")
	if since != "" {
		q.Set("since", since)
	}

	var raw []struct {
		Number            int            `json:"number"`
		Title             string         `json:"title"`
		Body              string         `json:"body"`
		User              *struct{ Login string `json:"login"` } `json:"user"`
		AuthorAssociation string         `json:"author_association"`
		Labels            []any          `json:"labels"`
		State             string         `json:"state"`
		HtmlURL           string         `json:"html_url"`
		CreatedAt         string         `json:"created_at"`
		UpdatedAt         string         `json:"updated_at"`
		PullRequest       map[string]any `json:"pull_request"`
	}
	path := fmt.Sprintf("/repos/%s/%s/issues?%s", owner, repo, q.Encode())
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}

	out := make([]domain.GitHubIssue, 0, len(raw))
	for _, item := range raw {
		if item.PullRequest != nil {
			continue
		}
		author := "unknown"
		if item.User != nil && item.User.Login != "" {
			author = item.User.Login
		}
		assoc := item.AuthorAssociation
		if assoc == "" {
			assoc = "NONE"
		}
		state := "open"
		if item.State == "closed" {
			state = "closed"
		}
		out = append(out, domain.GitHubIssue{
			Number:            item.Number,
			Title:             item.Title,
			Body:              item.Body,
			Author:            author,
			AuthorAssociation: assoc,
			Labels:            extractLabels(item.Labels),
			State:             state,
			URL:               item.HtmlURL,
			CreatedAt:         item.CreatedAt,
			UpdatedAt:         item.UpdatedAt,
		})
	}
	return out, nil
}

func (c *RESTGitHubClient) GetIssue(ctx context.Context, owner, repo string, issueNumber int) (domain.GitHubIssue, error) {
	var data struct {
		Number            int            `json:"number"`
		Title             string         `json:"title"`
		Body              string         `json:"body"`
		User              *struct{ Login string `json:"login"` } `json:"user"`
		AuthorAssociation string         `json:"author_association"`
		Labels            []any          `json:"labels"`
		State             string         `json:"state"`
		HtmlURL           string         `json:"html_url"`
		CreatedAt         string         `json:"created_at"`
		UpdatedAt         string         `json:"updated_at"`
		PullRequest       map[string]any `json:"pull_request"`
	}
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, issueNumber)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &data); err != nil {
		return domain.GitHubIssue{}, err
	}
	author := "unknown"
	if data.User != nil && data.User.Login != "" {
		author = data.User.Login
	}
	assoc := data.AuthorAssociation
	if assoc == "" {
		assoc = "NONE"
	}
	state := "open"
	if data.State == "closed" {
		state = "closed"
	}
	return domain.GitHubIssue{
		Number:            data.Number,
		Title:             data.Title,
		Body:              data.Body,
		Author:            author,
		AuthorAssociation: assoc,
		Labels:            extractLabels(data.Labels),
		State:             state,
		URL:               data.HtmlURL,
		CreatedAt:         data.CreatedAt,
		UpdatedAt:         data.UpdatedAt,
		IsPullRequest:     data.PullRequest != nil,
	}, nil
}

func (c *RESTGitHubClient) ListIssueComments(ctx context.Context, owner, repo string, issueNumber int) ([]domain.GitHubComment, error) {
	var raw []struct {
		ID                int64  `json:"id"`
		Body              string `json:"body"`
		User              *struct{ Login string `json:"login"` } `json:"user"`
		AuthorAssociation string `json:"author_association"`
		CreatedAt         string `json:"created_at"`
		UpdatedAt         string `json:"updated_at"`
		HtmlURL           string `json:"html_url"`
	}
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/comments?per_page=100", owner, repo, issueNumber)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubComment, 0, len(raw))
	for _, item := range raw {
		author := "unknown"
		if item.User != nil && item.User.Login != "" {
			author = item.User.Login
		}
		assoc := item.AuthorAssociation
		if assoc == "" {
			assoc = "NONE"
		}
		out = append(out, domain.GitHubComment{
			ID:                item.ID,
			Body:              item.Body,
			Author:            author,
			AuthorAssociation: assoc,
			CreatedAt:         item.CreatedAt,
			UpdatedAt:         item.UpdatedAt,
			URL:               item.HtmlURL,
		})
	}
	return out, nil
}

func (c *RESTGitHubClient) CreateIssueComment(ctx context.Context, owner, repo string, issueNumber int, body string) (domain.GitHubComment, error) {
	var data struct {
		ID                int64  `json:"id"`
		Body              string `json:"body"`
		User              *struct{ Login string `json:"login"` } `json:"user"`
		AuthorAssociation string `json:"author_association"`
		CreatedAt         string `json:"created_at"`
		UpdatedAt         string `json:"updated_at"`
		HtmlURL           string `json:"html_url"`
	}
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, issueNumber)
	if _, err := c.doJSON(ctx, http.MethodPost, path, map[string]string{"body": body}, &data); err != nil {
		return domain.GitHubComment{}, err
	}
	author := "dragonflow-bot"
	if data.User != nil && data.User.Login != "" {
		author = data.User.Login
	}
	assoc := data.AuthorAssociation
	if assoc == "" {
		assoc = "COLLABORATOR"
	}
	return domain.GitHubComment{
		ID:                data.ID,
		Body:              data.Body,
		Author:            author,
		AuthorAssociation: assoc,
		CreatedAt:         data.CreatedAt,
		UpdatedAt:         data.UpdatedAt,
		URL:               data.HtmlURL,
	}, nil
}

func (c *RESTGitHubClient) UpsertStatusCard(ctx context.Context, owner, repo string, issueNumber int, markdownBody string, knownCommentID *int64) (int64, error) {
	fullBody := StatusCardMarker + "\n" + markdownBody
	if knownCommentID != nil && *knownCommentID > 0 {
		path := fmt.Sprintf("/repos/%s/%s/issues/comments/%d", owner, repo, *knownCommentID)
		if _, err := c.doJSON(ctx, http.MethodPatch, path, map[string]string{"body": fullBody}, nil); err == nil {
			return *knownCommentID, nil
		}
	}
	comments, err := c.ListIssueComments(ctx, owner, repo, issueNumber)
	if err == nil {
		for _, cm := range comments {
			if strings.Contains(cm.Body, StatusCardMarker) {
				path := fmt.Sprintf("/repos/%s/%s/issues/comments/%d", owner, repo, cm.ID)
				if _, err := c.doJSON(ctx, http.MethodPatch, path, map[string]string{"body": fullBody}, nil); err != nil {
					return 0, err
				}
				return cm.ID, nil
			}
		}
	}
	created, err := c.CreateIssueComment(ctx, owner, repo, issueNumber, fullBody)
	if err != nil {
		return 0, err
	}
	return created.ID, nil
}

func (c *RESTGitHubClient) AddLabels(ctx context.Context, owner, repo string, issueNumber int, labels []string) error {
	if len(labels) == 0 {
		return nil
	}
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/labels", owner, repo, issueNumber)
	_, err := c.doJSON(ctx, http.MethodPost, path, map[string]any{"labels": labels}, nil)
	return err
}

func (c *RESTGitHubClient) RemoveLabel(ctx context.Context, owner, repo string, issueNumber int, label string) error {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/labels/%s", owner, repo, issueNumber, url.PathEscape(label))
	_, _ = c.doJSON(ctx, http.MethodDelete, path, nil, nil)
	return nil
}

type apiPR struct {
	Number         int       `json:"number"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	Head           struct {
		Ref string `json:"ref"`
		Sha string `json:"sha"`
	} `json:"head"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
	State          string     `json:"state"`
	Merged         bool       `json:"merged"`
	MergedAt       *string    `json:"merged_at"`
	MergeCommitSha string     `json:"merge_commit_sha"`
	HtmlURL        string     `json:"html_url"`
	Labels         []apiLabel `json:"labels"`
	Draft          bool       `json:"draft"`
	CreatedAt      string     `json:"created_at"`
	UpdatedAt      string     `json:"updated_at"`
}

func toDomainPR(p apiPR) domain.GitHubPullRequest {
	labels := make([]string, 0, len(p.Labels))
	for _, l := range p.Labels {
		if l.Name != "" {
			labels = append(labels, l.Name)
		}
	}
	state := "open"
	if p.State == "closed" {
		state = "closed"
	}
	merged := p.Merged || p.MergedAt != nil
	return domain.GitHubPullRequest{
		Number:         p.Number,
		Title:          p.Title,
		Body:           p.Body,
		HeadBranch:     p.Head.Ref,
		BaseBranch:     p.Base.Ref,
		State:          state,
		Merged:         merged,
		MergeCommitSha: p.MergeCommitSha,
		URL:            p.HtmlURL,
		Labels:         labels,
		Draft:          p.Draft,
		CreatedAt:      p.CreatedAt,
		UpdatedAt:      p.UpdatedAt,
	}
}

func (c *RESTGitHubClient) CreatePullRequest(ctx context.Context, owner, repo string, params CreatePrParams) (domain.GitHubPullRequest, error) {
	var data apiPR
	path := fmt.Sprintf("/repos/%s/%s/pulls", owner, repo)
	payload := map[string]any{
		"title": params.Title,
		"body":  params.Body,
		"head":  params.HeadBranch,
		"base":  params.BaseBranch,
		"draft": params.Draft,
	}
	if _, err := c.doJSON(ctx, http.MethodPost, path, payload, &data); err != nil {
		return domain.GitHubPullRequest{}, err
	}
	if len(params.Labels) > 0 {
		_ = c.AddLabels(ctx, owner, repo, data.Number, params.Labels)
	}
	pr := toDomainPR(data)
	if len(params.Labels) > 0 {
		pr.Labels = append([]string{}, params.Labels...)
	}
	return pr, nil
}

func (c *RESTGitHubClient) GetPullRequest(ctx context.Context, owner, repo string, prNumber int) (domain.GitHubPullRequest, error) {
	var data apiPR
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d", owner, repo, prNumber)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &data); err != nil {
		return domain.GitHubPullRequest{}, err
	}
	return toDomainPR(data), nil
}

func (c *RESTGitHubClient) ListPullRequests(ctx context.Context, owner, repo, state string) ([]domain.GitHubPullRequest, error) {
	if state == "" {
		state = "open"
	}
	var raw []apiPR
	path := fmt.Sprintf("/repos/%s/%s/pulls?state=%s&per_page=50", owner, repo, url.QueryEscape(state))
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubPullRequest, 0, len(raw))
	for _, p := range raw {
		out = append(out, toDomainPR(p))
	}
	return out, nil
}

func (c *RESTGitHubClient) ListPrCheckRuns(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubCheckRun, error) {
	var pr apiPR
	if _, err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/repos/%s/%s/pulls/%d", owner, repo, prNumber), nil, &pr); err != nil {
		return nil, err
	}
	var data struct {
		CheckRuns []struct {
			ID         int64  `json:"id"`
			Name       string `json:"name"`
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
			DetailsURL string `json:"details_url"`
			Output     struct {
				Title   string `json:"title"`
				Summary string `json:"summary"`
			} `json:"output"`
		} `json:"check_runs"`
	}
	path := fmt.Sprintf("/repos/%s/%s/commits/%s/check-runs?per_page=50", owner, repo, pr.Head.Sha)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &data); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubCheckRun, 0, len(data.CheckRuns))
	for _, cr := range data.CheckRuns {
		out = append(out, domain.GitHubCheckRun{
			ID:            cr.ID,
			Name:          cr.Name,
			Status:        cr.Status,
			Conclusion:    cr.Conclusion,
			DetailsURL:    cr.DetailsURL,
			OutputTitle:   cr.Output.Title,
			OutputSummary: cr.Output.Summary,
		})
	}
	return out, nil
}

func (c *RESTGitHubClient) ListPrReviews(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubReview, error) {
	var raw []struct {
		ID                int64  `json:"id"`
		User              *struct{ Login string `json:"login"` } `json:"user"`
		AuthorAssociation string `json:"author_association"`
		State             string `json:"state"`
		Body              string `json:"body"`
		SubmittedAt       string `json:"submitted_at"`
	}
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews?per_page=50", owner, repo, prNumber)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubReview, 0, len(raw))
	for _, r := range raw {
		author := "unknown"
		if r.User != nil && r.User.Login != "" {
			author = r.User.Login
		}
		assoc := r.AuthorAssociation
		if assoc == "" {
			assoc = "NONE"
		}
		sub := r.SubmittedAt
		if sub == "" {
			sub = time.Now().UTC().Format(time.RFC3339)
		}
		out = append(out, domain.GitHubReview{
			ID:                r.ID,
			Author:            author,
			AuthorAssociation: assoc,
			State:             r.State,
			Body:              r.Body,
			SubmittedAt:       sub,
		})
	}
	return out, nil
}

func (c *RESTGitHubClient) ListPrReviewComments(ctx context.Context, owner, repo string, prNumber int) ([]domain.GitHubReviewComment, error) {
	var raw []struct {
		ID        int64  `json:"id"`
		User      *struct{ Login string `json:"login"` } `json:"user"`
		Path      string `json:"path"`
		Line      *int   `json:"line"`
		Body      string `json:"body"`
		CreatedAt string `json:"created_at"`
	}
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/comments?per_page=100", owner, repo, prNumber)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubReviewComment, 0, len(raw))
	for _, rc := range raw {
		author := "unknown"
		if rc.User != nil && rc.User.Login != "" {
			author = rc.User.Login
		}
		out = append(out, domain.GitHubReviewComment{
			ID:        rc.ID,
			Author:    author,
			Path:      rc.Path,
			Line:      rc.Line,
			Body:      rc.Body,
			CreatedAt: rc.CreatedAt,
		})
	}
	return out, nil
}

func (c *RESTGitHubClient) MergePullRequest(ctx context.Context, owner, repo string, prNumber int, method, commitTitle string) (MergeResult, error) {
	if method == "" {
		method = "squash"
	}
	payload := map[string]any{
		"merge_method": method,
	}
	if commitTitle != "" {
		payload["commit_title"] = commitTitle
	}
	var data struct {
		Merged bool   `json:"merged"`
		Sha    string `json:"sha"`
	}
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/merge", owner, repo, prNumber)
	if _, err := c.doJSON(ctx, http.MethodPut, path, payload, &data); err != nil {
		return MergeResult{}, err
	}
	return MergeResult{Merged: data.Merged, Sha: data.Sha}, nil
}

func (c *RESTGitHubClient) ListReleases(ctx context.Context, owner, repo string) ([]domain.GitHubRelease, error) {
	var raw []struct {
		ID          int64  `json:"id"`
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		HtmlURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		CreatedAt   string `json:"created_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
	}
	path := fmt.Sprintf("/repos/%s/%s/releases?per_page=20", owner, repo)
	if _, err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.GitHubRelease, 0, len(raw))
	for _, r := range raw {
		name := r.Name
		if name == "" {
			name = r.TagName
		}
		pub := r.PublishedAt
		if pub == "" {
			pub = r.CreatedAt
		}
		out = append(out, domain.GitHubRelease{
			ID:          r.ID,
			TagName:     r.TagName,
			Name:        name,
			Body:        r.Body,
			URL:         r.HtmlURL,
			PublishedAt: pub,
			Draft:       r.Draft,
			Prerelease:  r.Prerelease,
		})
	}
	return out, nil
}

var _ = strconv.Itoa
