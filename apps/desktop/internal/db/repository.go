package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/events"
)

type TaskPatch struct {
	IssueTitle             *string
	IssueBody              *string
	Labels                 *[]string
	Tier                   *domain.WorkflowTier
	Category               *domain.IssueCategory
	ComplexityScore        *int
	AssignedAgent          *string
	ReviewerAgent          *string
	FallbackCount          *int
	FallbackHistory        *[]domain.FallbackAttemptRecord
	RoutingRationale       *string
	BranchName             *string
	WorktreePath           *string
	PrNumber               *int
	PrURL                  *string
	ReleasePrNumber        *int
	ReleasePrURL           *string
	ReleaseTag             *string
	ReleaseURL             *string
	StatusCommentID        *int64
	LocalFixRetries        *int
	CrossReviewRetries     *int
	CiFixRetries           *int
	ReviewFixRetries       *int
	LastProcessedCommentID *int64
	LastProcessedReviewID  *int64
	TotalTokens            *int
	EstimatedCostUsd       *float64
	LastError              *string
	ClearLastError         bool
}

type Repository struct {
	mu       sync.Mutex
	db       *sql.DB
	eventBus *events.EventBus
}

func NewRepository(sqlDB *sql.DB, eventBus *events.EventBus) *Repository {
	return &Repository{
		db:       sqlDB,
		eventBus: eventBus,
	}
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func shortID(prefix string) string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return prefix + "-" + hex.EncodeToString(b)
}

func (r *Repository) emit(ev domain.AppEvent) {
	if r.eventBus != nil {
		r.eventBus.Emit(ev)
	}
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanTask(scanner rowScanner) (domain.TaskRecord, error) {
	var (
		t                      domain.TaskRecord
		labelsJSON             string
		fallbackJSON           string
		category               sql.NullString
		complexity             sql.NullInt64
		assignedAgent          sql.NullString
		reviewerAgent          sql.NullString
		routingRationale       sql.NullString
		branchName             sql.NullString
		worktreePath           sql.NullString
		prNumber               sql.NullInt64
		prURL                  sql.NullString
		releasePrNumber        sql.NullInt64
		releasePrURL           sql.NullString
		releaseTag             sql.NullString
		releaseURL             sql.NullString
		statusCommentID        sql.NullInt64
		lastError              sql.NullString
		statusStr, tierStr     string
	)
	err := scanner.Scan(
		&t.ID,
		&t.RepoFullName,
		&t.IssueNumber,
		&t.IssueTitle,
		&t.IssueBody,
		&t.IssueURL,
		&t.IssueAuthor,
		&labelsJSON,
		&statusStr,
		&tierStr,
		&category,
		&complexity,
		&assignedAgent,
		&reviewerAgent,
		&t.FallbackCount,
		&fallbackJSON,
		&routingRationale,
		&branchName,
		&worktreePath,
		&prNumber,
		&prURL,
		&releasePrNumber,
		&releasePrURL,
		&releaseTag,
		&releaseURL,
		&statusCommentID,
		&t.LocalFixRetries,
		&t.CrossReviewRetries,
		&t.CiFixRetries,
		&t.ReviewFixRetries,
		&t.LastProcessedCommentID,
		&t.LastProcessedReviewID,
		&t.TotalTokens,
		&t.EstimatedCostUsd,
		&lastError,
		&t.CreatedAt,
		&t.UpdatedAt,
	)
	if err != nil {
		return domain.TaskRecord{}, err
	}

	t.Status = domain.TaskStatus(statusStr)
	t.Tier = domain.WorkflowTier(tierStr)
	t.Labels = []string{}
	_ = json.Unmarshal([]byte(labelsJSON), &t.Labels)
	if t.Labels == nil {
		t.Labels = []string{}
	}
	t.FallbackHistory = []domain.FallbackAttemptRecord{}
	_ = json.Unmarshal([]byte(fallbackJSON), &t.FallbackHistory)
	if t.FallbackHistory == nil {
		t.FallbackHistory = []domain.FallbackAttemptRecord{}
	}

	if category.Valid {
		c := domain.IssueCategory(category.String)
		t.Category = &c
	}
	if complexity.Valid {
		v := int(complexity.Int64)
		t.ComplexityScore = &v
	}
	if assignedAgent.Valid {
		v := assignedAgent.String
		t.AssignedAgent = &v
	}
	if reviewerAgent.Valid {
		v := reviewerAgent.String
		t.ReviewerAgent = &v
	}
	if routingRationale.Valid {
		v := routingRationale.String
		t.RoutingRationale = &v
	}
	if branchName.Valid {
		v := branchName.String
		t.BranchName = &v
	}
	if worktreePath.Valid {
		v := worktreePath.String
		t.WorktreePath = &v
	}
	if prNumber.Valid {
		v := int(prNumber.Int64)
		t.PrNumber = &v
	}
	if prURL.Valid {
		v := prURL.String
		t.PrURL = &v
	}
	if releasePrNumber.Valid {
		v := int(releasePrNumber.Int64)
		t.ReleasePrNumber = &v
	}
	if releasePrURL.Valid {
		v := releasePrURL.String
		t.ReleasePrURL = &v
	}
	if releaseTag.Valid {
		v := releaseTag.String
		t.ReleaseTag = &v
	}
	if releaseURL.Valid {
		v := releaseURL.String
		t.ReleaseURL = &v
	}
	if statusCommentID.Valid {
		v := statusCommentID.Int64
		t.StatusCommentID = &v
	}
	if lastError.Valid {
		v := lastError.String
		t.LastError = &v
	}
	return t, nil
}

const selectTaskCols = `
	id, repo_full_name, issue_number, issue_title, issue_body, issue_url, issue_author,
	labels_json, status, tier, category, complexity_score, assigned_agent, reviewer_agent,
	fallback_count, fallback_history_json, routing_rationale, branch_name, worktree_path,
	pr_number, pr_url, release_pr_number, release_pr_url, release_tag, release_url,
	status_comment_id, local_fix_retries, cross_review_retries, ci_fix_retries,
	review_fix_retries, last_processed_comment_id, last_processed_review_id,
	total_tokens, estimated_cost_usd, last_error, created_at, updated_at
`

func (r *Repository) getTaskLocked(id string) (*domain.TaskRecord, error) {
	row := r.db.QueryRow(`SELECT `+selectTaskCols+` FROM tasks WHERE id = ?`, id)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) getTaskByRepoIssueLocked(repoFullName string, issueNumber int) (*domain.TaskRecord, error) {
	row := r.db.QueryRow(`SELECT `+selectTaskCols+` FROM tasks WHERE repo_full_name = ? AND issue_number = ?`, repoFullName, issueNumber)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) UpsertTaskFromIssue(repoFullName string, issue domain.GitHubIssue) (domain.TaskRecord, bool, error) {
	r.mu.Lock()
	existing, err := r.getTaskByRepoIssueLocked(repoFullName, issue.Number)
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, false, err
	}

	labels := issue.Labels
	if labels == nil {
		labels = []string{}
	}
	labelsBytes, _ := json.Marshal(labels)
	now := nowISO()

	if existing != nil {
		_, err := r.db.Exec(
			`UPDATE tasks SET issue_title = ?, issue_body = ?, issue_url = ?, labels_json = ?, updated_at = ? WHERE id = ?`,
			issue.Title, issue.Body, issue.URL, string(labelsBytes), now, existing.ID,
		)
		if err != nil {
			r.mu.Unlock()
			return domain.TaskRecord{}, false, err
		}
		updated, err := r.getTaskLocked(existing.ID)
		r.mu.Unlock()
		if err != nil || updated == nil {
			return domain.TaskRecord{}, false, err
		}
		r.emit(domain.AppEvent{Type: "task:updated", Task: updated})
		return *updated, false, nil
	}

	id := shortID("task")
	tx, err := r.db.Begin()
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, false, err
	}
	if _, err := tx.Exec(
		`INSERT INTO tasks (
			id, repo_full_name, issue_number, issue_title, issue_body, issue_url,
			issue_author, labels_json, status, tier, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW', 'quick_fix', ?, ?)`,
		id, repoFullName, issue.Number, issue.Title, issue.Body, issue.URL,
		issue.Author, string(labelsBytes), now, now,
	); err != nil {
		_ = tx.Rollback()
		r.mu.Unlock()
		return domain.TaskRecord{}, false, err
	}
	if _, err := tx.Exec(
		`INSERT INTO events_audit (task_id, from_status, to_status, actor, reason, created_at)
		 VALUES (?, NULL, 'NEW', 'system', 'Issue ingested', ?)`,
		id, now,
	); err != nil {
		_ = tx.Rollback()
		r.mu.Unlock()
		return domain.TaskRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, false, err
	}

	created, err := r.getTaskLocked(id)
	r.mu.Unlock()
	if err != nil || created == nil {
		return domain.TaskRecord{}, false, err
	}

	to := domain.StatusNew
	r.emit(domain.AppEvent{Type: "task:updated", Task: created})
	r.emit(domain.AppEvent{
		Type:      "task:transitioned",
		TaskID:    id,
		ToStatus:  &to,
		Actor:     "system",
		Reason:    "Issue ingested",
		Timestamp: now,
	})
	return *created, true, nil
}

func (r *Repository) GetTask(id string) (*domain.TaskRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getTaskLocked(id)
}

func (r *Repository) GetTaskByRepoIssue(repoFullName string, issueNumber int) (*domain.TaskRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getTaskByRepoIssueLocked(repoFullName, issueNumber)
}

func (r *Repository) ListTasks(status string, search string) ([]domain.TaskRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	query := `SELECT ` + selectTaskCols + ` FROM tasks`
	var clauses []string
	var params []any

	if status != "" && domain.IsValidTaskStatus(status) {
		clauses = append(clauses, "status = ?")
		params = append(params, status)
	}
	if trimmed := strings.TrimSpace(search); trimmed != "" {
		clauses = append(clauses, "(issue_title LIKE ? OR CAST(issue_number AS TEXT) LIKE ?)")
		term := "%" + trimmed + "%"
		params = append(params, term, term)
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	query += " ORDER BY updated_at DESC"

	rows, err := r.db.Query(query, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.TaskRecord, 0)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repository) updateTaskLocked(id string, patch TaskPatch) (*domain.TaskRecord, error) {
	current, err := r.getTaskLocked(id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, fmt.Errorf("Task not found: %s", id)
	}

	var assignments []string
	var values []any
	setCol := func(col string, val any) {
		assignments = append(assignments, col+" = ?")
		values = append(values, val)
	}

	if patch.IssueTitle != nil {
		setCol("issue_title", *patch.IssueTitle)
	}
	if patch.IssueBody != nil {
		setCol("issue_body", *patch.IssueBody)
	}
	if patch.Labels != nil {
		b, _ := json.Marshal(*patch.Labels)
		setCol("labels_json", string(b))
	}
	if patch.Tier != nil {
		setCol("tier", string(*patch.Tier))
	}
	if patch.Category != nil {
		setCol("category", string(*patch.Category))
	}
	if patch.ComplexityScore != nil {
		setCol("complexity_score", *patch.ComplexityScore)
	}
	if patch.AssignedAgent != nil {
		setCol("assigned_agent", *patch.AssignedAgent)
	}
	if patch.ReviewerAgent != nil {
		setCol("reviewer_agent", *patch.ReviewerAgent)
	}
	if patch.FallbackCount != nil {
		setCol("fallback_count", *patch.FallbackCount)
	}
	if patch.FallbackHistory != nil {
		b, _ := json.Marshal(*patch.FallbackHistory)
		setCol("fallback_history_json", string(b))
	}
	if patch.RoutingRationale != nil {
		setCol("routing_rationale", *patch.RoutingRationale)
	}
	if patch.BranchName != nil {
		setCol("branch_name", *patch.BranchName)
	}
	if patch.WorktreePath != nil {
		setCol("worktree_path", *patch.WorktreePath)
	}
	if patch.PrNumber != nil {
		setCol("pr_number", *patch.PrNumber)
	}
	if patch.PrURL != nil {
		setCol("pr_url", *patch.PrURL)
	}
	if patch.ReleasePrNumber != nil {
		setCol("release_pr_number", *patch.ReleasePrNumber)
	}
	if patch.ReleasePrURL != nil {
		setCol("release_pr_url", *patch.ReleasePrURL)
	}
	if patch.ReleaseTag != nil {
		setCol("release_tag", *patch.ReleaseTag)
	}
	if patch.ReleaseURL != nil {
		setCol("release_url", *patch.ReleaseURL)
	}
	if patch.StatusCommentID != nil {
		setCol("status_comment_id", *patch.StatusCommentID)
	}
	if patch.LocalFixRetries != nil {
		setCol("local_fix_retries", *patch.LocalFixRetries)
	}
	if patch.CrossReviewRetries != nil {
		setCol("cross_review_retries", *patch.CrossReviewRetries)
	}
	if patch.CiFixRetries != nil {
		setCol("ci_fix_retries", *patch.CiFixRetries)
	}
	if patch.ReviewFixRetries != nil {
		setCol("review_fix_retries", *patch.ReviewFixRetries)
	}
	if patch.LastProcessedCommentID != nil {
		setCol("last_processed_comment_id", *patch.LastProcessedCommentID)
	}
	if patch.LastProcessedReviewID != nil {
		setCol("last_processed_review_id", *patch.LastProcessedReviewID)
	}
	if patch.TotalTokens != nil {
		setCol("total_tokens", *patch.TotalTokens)
	}
	if patch.EstimatedCostUsd != nil {
		setCol("estimated_cost_usd", *patch.EstimatedCostUsd)
	}
	if patch.ClearLastError {
		setCol("last_error", nil)
	} else if patch.LastError != nil {
		setCol("last_error", *patch.LastError)
	}

	setCol("updated_at", nowISO())
	values = append(values, id)

	query := fmt.Sprintf("UPDATE tasks SET %s WHERE id = ?", strings.Join(assignments, ", "))
	if _, err := r.db.Exec(query, values...); err != nil {
		return nil, err
	}
	return r.getTaskLocked(id)
}

func (r *Repository) UpdateTask(id string, patch TaskPatch) (domain.TaskRecord, error) {
	r.mu.Lock()
	updated, err := r.updateTaskLocked(id, patch)
	r.mu.Unlock()
	if err != nil {
		return domain.TaskRecord{}, err
	}
	r.emit(domain.AppEvent{Type: "task:updated", Task: updated})
	return *updated, nil
}

func (r *Repository) TransitionTask(id string, toStatus domain.TaskStatus, actor string, reason string, extraPatch *TaskPatch) (domain.TaskRecord, error) {
	r.mu.Lock()
	current, err := r.getTaskLocked(id)
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, err
	}
	if current == nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, fmt.Errorf("Task not found: %s", id)
	}
	if !domain.CanTransition(current.Status, toStatus) {
		r.mu.Unlock()
		return domain.TaskRecord{}, fmt.Errorf("Invalid state transition: %s -> %s for task %s", current.Status, toStatus, id)
	}

	now := nowISO()
	tx, err := r.db.Begin()
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, err
	}
	if _, err := tx.Exec(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, string(toStatus), now, id); err != nil {
		_ = tx.Rollback()
		r.mu.Unlock()
		return domain.TaskRecord{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO events_audit (task_id, from_status, to_status, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, string(current.Status), string(toStatus), actor, reason, now,
	); err != nil {
		_ = tx.Rollback()
		r.mu.Unlock()
		return domain.TaskRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		r.mu.Unlock()
		return domain.TaskRecord{}, err
	}

	var updated *domain.TaskRecord
	if extraPatch != nil {
		updated, err = r.updateTaskLocked(id, *extraPatch)
	} else {
		updated, err = r.getTaskLocked(id)
	}
	r.mu.Unlock()
	if err != nil || updated == nil {
		return domain.TaskRecord{}, err
	}

	from := current.Status
	to := toStatus
	r.emit(domain.AppEvent{Type: "task:updated", Task: updated})
	r.emit(domain.AppEvent{
		Type:       "task:transitioned",
		TaskID:     id,
		FromStatus: &from,
		ToStatus:   &to,
		Actor:      actor,
		Reason:     reason,
		Timestamp:  now,
	})
	return *updated, nil
}

func (r *Repository) addUsageLocked(taskID string, tokensDelta int, costDeltaUsd float64) (*domain.TaskRecord, error) {
	current, err := r.getTaskLocked(taskID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, fmt.Errorf("Task not found: %s", taskID)
	}
	if tokensDelta < 0 {
		tokensDelta = 0
	}
	if costDeltaUsd < 0 {
		costDeltaUsd = 0
	}
	newTokens := current.TotalTokens + tokensDelta
	newCost := math.Round((current.EstimatedCostUsd+costDeltaUsd)*1e6) / 1e6
	return r.updateTaskLocked(taskID, TaskPatch{
		TotalTokens:      &newTokens,
		EstimatedCostUsd: &newCost,
	})
}

func (r *Repository) CreateRun(taskID, stage, agentID string, attempt int) (domain.TaskRunRecord, error) {
	r.mu.Lock()
	id := shortID("run")
	startedAt := nowISO()
	_, err := r.db.Exec(
		`INSERT INTO task_runs (id, task_id, stage, agent_id, attempt, status, error_kind, started_at)
		 VALUES (?, ?, ?, ?, ?, 'running', 'none', ?)`,
		id, taskID, stage, agentID, attempt, startedAt,
	)
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRunRecord{}, err
	}
	run, err := r.getRunLocked(id)
	r.mu.Unlock()
	if err != nil || run == nil {
		return domain.TaskRunRecord{}, err
	}
	r.emit(domain.AppEvent{Type: "run:started", Run: run})
	return *run, nil
}

type FinishRunResult struct {
	Status     string
	ErrorKind  domain.AgentErrorKind
	ExitCode   *int
	TokensUsed int
	CostUsd    float64
	Summary    *string
}

func (r *Repository) FinishRun(runID string, res FinishRunResult) (domain.TaskRunRecord, error) {
	r.mu.Lock()
	current, err := r.getRunLocked(runID)
	if err != nil {
		r.mu.Unlock()
		return domain.TaskRunRecord{}, err
	}
	if current == nil {
		r.mu.Unlock()
		return domain.TaskRunRecord{}, fmt.Errorf("Run not found: %s", runID)
	}

	finishedAt := nowISO()
	startT, _ := time.Parse(time.RFC3339Nano, current.StartedAt)
	finT, _ := time.Parse(time.RFC3339Nano, finishedAt)
	durMs := finT.Sub(startT).Milliseconds()
	if durMs < 0 {
		durMs = 0
	}

	var exitCode any
	if res.ExitCode != nil {
		exitCode = *res.ExitCode
	}
	var summary any
	if res.Summary != nil {
		summary = *res.Summary
	}

	if _, err := r.db.Exec(
		`UPDATE task_runs
		 SET status = ?, error_kind = ?, exit_code = ?, tokens_used = ?, cost_usd = ?,
		     summary = ?, finished_at = ?, duration_ms = ?
		 WHERE id = ?`,
		res.Status, string(res.ErrorKind), exitCode, res.TokensUsed, res.CostUsd,
		summary, finishedAt, durMs, runID,
	); err != nil {
		r.mu.Unlock()
		return domain.TaskRunRecord{}, err
	}

	var updatedTask *domain.TaskRecord
	if res.TokensUsed > 0 || res.CostUsd > 0 {
		updatedTask, _ = r.addUsageLocked(current.TaskID, res.TokensUsed, res.CostUsd)
	}

	updatedRun, err := r.getRunLocked(runID)
	r.mu.Unlock()
	if err != nil || updatedRun == nil {
		return domain.TaskRunRecord{}, err
	}
	if updatedTask != nil {
		r.emit(domain.AppEvent{Type: "task:updated", Task: updatedTask})
	}
	r.emit(domain.AppEvent{Type: "run:finished", Run: updatedRun})
	return *updatedRun, nil
}

func scanRun(scanner rowScanner) (domain.TaskRunRecord, error) {
	var (
		run        domain.TaskRunRecord
		errKindStr string
		exitCode   sql.NullInt64
		summary    sql.NullString
		finishedAt sql.NullString
		durationMs sql.NullInt64
	)
	if err := scanner.Scan(
		&run.ID, &run.TaskID, &run.Stage, &run.AgentID, &run.Attempt,
		&run.Status, &errKindStr, &exitCode, &run.TokensUsed, &run.CostUsd,
		&summary, &run.StartedAt, &finishedAt, &durationMs,
	); err != nil {
		return domain.TaskRunRecord{}, err
	}
	run.ErrorKind = domain.AgentErrorKind(errKindStr)
	if exitCode.Valid {
		v := int(exitCode.Int64)
		run.ExitCode = &v
	}
	if summary.Valid {
		v := summary.String
		run.Summary = &v
	}
	if finishedAt.Valid {
		v := finishedAt.String
		run.FinishedAt = &v
	}
	if durationMs.Valid {
		v := durationMs.Int64
		run.DurationMs = &v
	}
	return run, nil
}

func (r *Repository) getRunLocked(runID string) (*domain.TaskRunRecord, error) {
	row := r.db.QueryRow(
		`SELECT id, task_id, stage, agent_id, attempt, status, error_kind, exit_code, tokens_used, cost_usd, summary, started_at, finished_at, duration_ms
		 FROM task_runs WHERE id = ?`, runID,
	)
	run, err := scanRun(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *Repository) ListRuns(taskID string) ([]domain.TaskRunRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rows, err := r.db.Query(
		`SELECT id, task_id, stage, agent_id, attempt, status, error_kind, exit_code, tokens_used, cost_usd, summary, started_at, finished_at, duration_ms
		 FROM task_runs WHERE task_id = ? ORDER BY started_at ASC`, taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.TaskRunRecord, 0)
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

func (r *Repository) SaveArtifact(taskID string, kind domain.ArtifactKind, title, content string, metadata map[string]any) (domain.TaskArtifact, error) {
	r.mu.Lock()
	id := shortID("art")
	createdAt := nowISO()
	var metaStr any
	if metadata != nil {
		b, _ := json.Marshal(metadata)
		metaStr = string(b)
	}
	_, err := r.db.Exec(
		`INSERT INTO task_artifacts (id, task_id, kind, title, content, metadata_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, taskID, string(kind), title, content, metaStr, createdAt,
	)
	r.mu.Unlock()
	if err != nil {
		return domain.TaskArtifact{}, err
	}

	art := domain.TaskArtifact{
		ID:        id,
		TaskID:    taskID,
		Kind:      kind,
		Title:     title,
		Content:   content,
		Metadata:  metadata,
		CreatedAt: createdAt,
	}
	r.emit(domain.AppEvent{Type: "artifact:created", Artifact: &art})
	return art, nil
}

func scanArtifact(scanner rowScanner) (domain.TaskArtifact, error) {
	var (
		art     domain.TaskArtifact
		kindStr string
		meta    sql.NullString
	)
	if err := scanner.Scan(&art.ID, &art.TaskID, &kindStr, &art.Title, &art.Content, &meta, &art.CreatedAt); err != nil {
		return domain.TaskArtifact{}, err
	}
	art.Kind = domain.ArtifactKind(kindStr)
	if meta.Valid && meta.String != "" {
		var m map[string]any
		if err := json.Unmarshal([]byte(meta.String), &m); err == nil {
			art.Metadata = m
		}
	}
	return art, nil
}

func (r *Repository) ListArtifacts(taskID string) ([]domain.TaskArtifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rows, err := r.db.Query(
		`SELECT id, task_id, kind, title, content, metadata_json, created_at
		 FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC`, taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.TaskArtifact, 0)
	for rows.Next() {
		a, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) GetLatestArtifact(taskID string, kind domain.ArtifactKind) (*domain.TaskArtifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	row := r.db.QueryRow(
		`SELECT id, task_id, kind, title, content, metadata_json, created_at
		 FROM task_artifacts WHERE task_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`,
		taskID, string(kind),
	)
	a, err := scanArtifact(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repository) AppendLog(taskID, runID, stream, message string) (domain.TaskLogEntry, error) {
	r.mu.Lock()
	ts := nowISO()
	res, err := r.db.Exec(
		`INSERT INTO task_logs (task_id, run_id, stream, message, timestamp) VALUES (?, ?, ?, ?, ?)`,
		taskID, runID, stream, message, ts,
	)
	if err != nil {
		r.mu.Unlock()
		return domain.TaskLogEntry{}, err
	}
	id, _ := res.LastInsertId()
	r.mu.Unlock()

	entry := domain.TaskLogEntry{
		ID:        id,
		TaskID:    taskID,
		RunID:     runID,
		Stream:    stream,
		Message:   message,
		Timestamp: ts,
	}
	r.emit(domain.AppEvent{Type: "log:chunk", Entry: &entry})
	return entry, nil
}

func (r *Repository) ListLogs(taskID string, limit int, afterID int64) ([]domain.TaskLogEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if limit <= 0 {
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}
	if afterID < 0 {
		afterID = 0
	}
	rows, err := r.db.Query(
		`SELECT id, task_id, run_id, stream, message, timestamp
		 FROM task_logs WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
		taskID, afterID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.TaskLogEntry, 0)
	for rows.Next() {
		var e domain.TaskLogEntry
		if err := rows.Scan(&e.ID, &e.TaskID, &e.RunID, &e.Stream, &e.Message, &e.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) ListAuditEvents(taskID string) ([]domain.AuditEventRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rows, err := r.db.Query(
		`SELECT id, task_id, from_status, to_status, actor, reason, created_at
		 FROM events_audit WHERE task_id = ? ORDER BY id ASC`, taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AuditEventRecord, 0)
	for rows.Next() {
		var (
			ev         domain.AuditEventRecord
			fromStatus sql.NullString
			toStatus   string
		)
		if err := rows.Scan(&ev.ID, &ev.TaskID, &fromStatus, &toStatus, &ev.Actor, &ev.Reason, &ev.CreatedAt); err != nil {
			return nil, err
		}
		if fromStatus.Valid {
			st := domain.TaskStatus(fromStatus.String)
			ev.FromStatus = &st
		}
		ev.ToStatus = domain.TaskStatus(toStatus)
		out = append(out, ev)
	}
	return out, rows.Err()
}

type PollerState struct {
	LastIssuePollAt string
	LastPrPollAt    string
}

func (r *Repository) GetPollerState(repoFullName string) (PollerState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.getPollerStateLocked(repoFullName)
}

func (r *Repository) getPollerStateLocked(repoFullName string) (PollerState, error) {
	var issueAt, prAt sql.NullString
	err := r.db.QueryRow(
		`SELECT last_issue_poll_at, last_pr_poll_at FROM poller_state WHERE repo_full_name = ?`,
		repoFullName,
	).Scan(&issueAt, &prAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PollerState{}, nil
	}
	if err != nil {
		return PollerState{}, err
	}
	return PollerState{
		LastIssuePollAt: issueAt.String,
		LastPrPollAt:    prAt.String,
	}, nil
}

func (r *Repository) SavePollerState(repoFullName string, state PollerState) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cur, err := r.getPollerStateLocked(repoFullName)
	if err != nil {
		return err
	}
	issueAt := state.LastIssuePollAt
	if issueAt == "" {
		issueAt = cur.LastIssuePollAt
	}
	prAt := state.LastPrPollAt
	if prAt == "" {
		prAt = cur.LastPrPollAt
	}
	var issueVal, prVal any
	if issueAt != "" {
		issueVal = issueAt
	}
	if prAt != "" {
		prVal = prAt
	}
	_, err = r.db.Exec(
		`INSERT INTO poller_state (repo_full_name, last_issue_poll_at, last_pr_poll_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(repo_full_name) DO UPDATE SET
		   last_issue_poll_at = excluded.last_issue_poll_at,
		   last_pr_poll_at = excluded.last_pr_poll_at`,
		repoFullName, issueVal, prVal,
	)
	return err
}

type OverviewMeta struct {
	Mode                 string
	RepoFullName         string
	AvailableAgentsCount int
	TotalAgentsCount     int
}

func (r *Repository) GetDashboardOverview(meta OverviewMeta) (domain.DashboardOverview, error) {
	tasks, err := r.ListTasks("", "")
	if err != nil {
		return domain.DashboardOverview{}, err
	}

	byStatus := make(map[string]int)
	byAgent := make(map[string]int)
	activeTasks := 0
	totalTokens := 0
	estimatedCost := 0.0
	successCount := 0
	finishedCount := 0

	for _, t := range tasks {
		byStatus[string(t.Status)]++
		if t.AssignedAgent != nil && *t.AssignedAgent != "" {
			byAgent[*t.AssignedAgent]++
		}
		if !domain.IsTerminalStatus(t.Status) &&
			t.Status != domain.StatusAwaitingInfo &&
			t.Status != domain.StatusAwaitingTrigger &&
			t.Status != domain.StatusNeedsHuman {
			activeTasks++
		}
		totalTokens += t.TotalTokens
		estimatedCost += t.EstimatedCostUsd

		switch t.Status {
		case domain.StatusMerged, domain.StatusReleasePrOpen, domain.StatusReleased:
			successCount++
			finishedCount++
		case domain.StatusFailed, domain.StatusNeedsHuman:
			finishedCount++
		}
	}

	r.mu.Lock()
	var avgMs sql.NullFloat64
	_ = r.db.QueryRow(`SELECT AVG(duration_ms) FROM task_runs WHERE duration_ms IS NOT NULL`).Scan(&avgMs)
	r.mu.Unlock()

	successRate := 100.0
	if finishedCount > 0 {
		successRate = math.Round((float64(successCount)/float64(finishedCount))*1000) / 10
	}

	return domain.DashboardOverview{
		TotalTasks:           len(tasks),
		ActiveTasks:          activeTasks,
		ByStatus:             byStatus,
		ByAgent:              byAgent,
		SuccessRate:          successRate,
		AvgDurationMs:        int64(math.Round(avgMs.Float64)),
		TotalTokens:          totalTokens,
		EstimatedCostUsd:     math.Round(estimatedCost*10000) / 10000,
		Mode:                 meta.Mode,
		RepoFullName:         meta.RepoFullName,
		AvailableAgentsCount: meta.AvailableAgentsCount,
		TotalAgentsCount:     meta.TotalAgentsCount,
	}, nil
}
