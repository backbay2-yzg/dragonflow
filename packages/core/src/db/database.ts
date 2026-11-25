import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export class DragonFlowDatabase {
  public readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
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
    `);
  }

  close(): void {
    this.db.close();
  }
}
