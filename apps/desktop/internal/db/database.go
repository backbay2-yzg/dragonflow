package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Database struct {
	SQL *sql.DB
}

func OpenDatabase(dbPath string) (*Database, error) {
	dsn := dbPath
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}

	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Single connection prevents SQLITE_BUSY / nested transaction conflicts on concurrent goroutines
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
	}
	for _, p := range pragmas {
		if _, err := sqlDB.Exec(p); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("exec %q: %w", p, err)
		}
	}

	d := &Database{SQL: sqlDB}
	if err := d.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return d, nil
}

func (d *Database) migrate() error {
	schema := `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        repo_full_name TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        issue_title TEXT NOT NULL,
        issue_body TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        issue_author TEXT NOT NULL,
        labels_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'quick_fix',
        category TEXT,
        complexity_score INTEGER,
        assigned_agent TEXT,
        reviewer_agent TEXT,
        fallback_count INTEGER NOT NULL DEFAULT 0,
        fallback_history_json TEXT NOT NULL DEFAULT '[]',
        routing_rationale TEXT,
        branch_name TEXT,
        worktree_path TEXT,
        pr_number INTEGER,
        pr_url TEXT,
        release_pr_number INTEGER,
        release_pr_url TEXT,
        release_tag TEXT,
        release_url TEXT,
        status_comment_id INTEGER,
        local_fix_retries INTEGER NOT NULL DEFAULT 0,
        cross_review_retries INTEGER NOT NULL DEFAULT 0,
        ci_fix_retries INTEGER NOT NULL DEFAULT 0,
        review_fix_retries INTEGER NOT NULL DEFAULT 0,
        last_processed_comment_id INTEGER NOT NULL DEFAULT 0,
        last_processed_review_id INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repo_full_name, issue_number)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repo_full_name);

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_kind TEXT NOT NULL DEFAULT 'none',
        exit_code INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        summary TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, started_at);

      CREATE TABLE IF NOT EXISTS task_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_artifacts_task ON task_artifacts(task_id, created_at);

      CREATE TABLE IF NOT EXISTS task_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        stream TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, id);

      CREATE TABLE IF NOT EXISTS events_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_audit_task ON events_audit(task_id, id);

      CREATE TABLE IF NOT EXISTS poller_state (
        repo_full_name TEXT PRIMARY KEY,
        last_issue_poll_at TEXT,
        last_pr_poll_at TEXT
      );
	`
	if _, err := d.SQL.Exec(schema); err != nil {
		return fmt.Errorf("migrate sqlite schema: %w", err)
	}
	return nil
}

func (d *Database) Close() error {
	if d == nil || d.SQL == nil {
		return nil
	}
	return d.SQL.Close()
}
