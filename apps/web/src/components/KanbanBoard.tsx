import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  Filter,
  GitPullRequest,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { TaskRecord, WorkflowTier } from '@dragonflow/shared';
import {
  KANBAN_COLUMNS,
  TIER_META,
  formatRelativeTime,
  formatTokens,
  type SemanticTone,
} from '../utils/format';
import { StatusBadge } from './StatusBadge';

interface KanbanBoardProps {
  tasks: TaskRecord[];
  loading: boolean;
  selectedTaskId: string | null;
  overlayOpen?: boolean;
  onSelectTask: (taskId: string) => void;
}

const COLUMN_DOT_COLOR: Record<SemanticTone, string> = {
  running: 'bg-[var(--df-running)]',
  waiting: 'bg-[var(--df-waiting)]',
  success: 'bg-[var(--df-success)]',
  danger: 'bg-[var(--df-danger)]',
  neutral: 'bg-[var(--df-neutral)]',
};

export function KanbanBoard({
  tasks,
  loading,
  selectedTaskId,
  overlayOpen = false,
  onSelectTask,
}: KanbanBoardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | WorkflowTier>('all');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (overlayOpen || e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlayOpen]);

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (tierFilter !== 'all' && task.tier !== tierFilter) return false;
      if (!query) return true;
      return (
        String(task.issueNumber).includes(query) ||
        `#${task.issueNumber}`.includes(query) ||
        task.issueTitle.toLowerCase().includes(query) ||
        (task.assignedAgent?.toLowerCase().includes(query) ?? false) ||
        task.status.toLowerCase().includes(query) ||
        task.labels.some((label) => label.toLowerCase().includes(query))
      );
    });
  }, [tasks, searchQuery, tierFilter]);

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    for (const col of KANBAN_COLUMNS) {
      map.set(col.id, []);
    }
    for (const task of filteredTasks) {
      const col = KANBAN_COLUMNS.find((c) => c.statuses.includes(task.status));
      if (col) {
        map.get(col.id)?.push(task);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    return map;
  }, [filteredTasks]);

  return (
    <div className="space-y-3">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[8px] border border-hairline bg-surface-1 px-3 py-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="过滤 #Issue、标题、Agent 或状态..."
            className="df-input h-[34px] w-full py-1.5 pr-8 pl-8 text-[14px]"
          />
          <kbd className="df-kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            /
          </kbd>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted">
            <Filter className="h-3.5 w-3.5 text-ink-subtle" />
            <span>Tier</span>
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-[8px] border border-hairline bg-canvas p-[2px]">
            {(['all', 'quick_fix', 'full_sdlc'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`rounded-[6px] border px-2.5 py-0.5 text-[12.5px] font-medium transition duration-150 ${
                  tierFilter === tier
                    ? 'border-hairline-strong bg-surface-2 text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {tier === 'all' ? '全部' : TIER_META[tier].label}
              </button>
            ))}
          </div>

          <span className="ml-1 font-mono text-[12.5px] tabular-nums text-ink-subtle">
            {filteredTasks.length} / {tasks.length} 项
          </span>
        </div>
      </div>

      {/* 6-Column Full-Width Kanban */}
      {loading && tasks.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
          正在加载任务看板...
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map((column) => {
            const colTasks = tasksByColumn.get(column.id) ?? [];
            return (
              <div
                key={column.id}
                className="flex min-h-[460px] min-w-[220px] flex-1 flex-col rounded-[10px] border border-hairline bg-surface-1"
              >
                <div className="flex items-center justify-between border-b border-hairline px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${COLUMN_DOT_COLOR[column.dotTone]}`}
                    />
                    <h3 className="truncate text-[14px] font-semibold text-ink">
                      {column.title}
                    </h3>
                  </div>
                  <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[12px] font-medium tabular-nums text-ink-muted">
                    {colTasks.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {colTasks.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-[8px] border border-dashed border-hairline-subtle p-4 text-center text-[13px] text-ink-subtle">
                      暂无任务
                    </div>
                  ) : (
                    colTasks.map((task) => (
                      <TaskKanbanCard
                        key={task.id}
                        task={task}
                        selected={selectedTaskId === task.id}
                        onSelect={() => onSelectTask(task.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TaskKanbanCardProps {
  task: TaskRecord;
  selected: boolean;
  onSelect: () => void;
}

function TaskKanbanCard({ task, selected, onSelect }: TaskKanbanCardProps) {
  const tierMeta = TIER_META[task.tier];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group cursor-pointer rounded-[8px] border p-2.5 transition duration-150 ${
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-hairline bg-surface-2 hover:border-hairline-strong hover:bg-surface-3'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-primary-text">
            #{task.issueNumber}
          </span>
          <span
            className={`rounded-[4px] border px-1.5 py-0.5 text-[11.5px] font-medium leading-none ${tierMeta.className}`}
          >
            {tierMeta.label}
          </span>
        </div>

        <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
          {formatRelativeTime(task.updatedAt)}
        </span>
      </div>

      <div className="mt-1.5 line-clamp-2 [text-wrap:balance] text-[14px] leading-snug font-medium text-ink">
        {task.issueTitle}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} size="xs" />

        {task.assignedAgent && (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-muted">
            <Bot className="h-3 w-3 text-primary-text" />
            {task.assignedAgent}
          </span>
        )}

        {task.fallbackCount > 0 && (
          <span
            title={`已触发 ${task.fallbackCount} 次 Agent 自动降级切换`}
            className="df-badge-waiting inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[11.5px] font-medium tabular-nums"
          >
            <RefreshCw className="h-3 w-3" />
            ×{task.fallbackCount}
          </span>
        )}
      </div>

      {task.lastError && (task.status === 'FAILED' || task.status === 'NEEDS_HUMAN') && (
        <div className="df-badge-danger selectable mt-2 flex items-start gap-1.5 rounded-[4px] border px-2 py-1 text-[12px]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{task.lastError}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-hairline-subtle pt-1.5 text-[12px] tabular-nums text-ink-subtle">
        <div className="flex items-center gap-2 font-mono">
          {task.complexityScore !== undefined && <span>C{task.complexityScore}/5</span>}
          {task.totalTokens > 0 && <span>{formatTokens(task.totalTokens)} tok</span>}
        </div>

        {task.prNumber || task.prUrl ? (
          task.prUrl ? (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="df-badge-success inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 font-mono text-[11.5px] transition hover:opacity-85"
            >
              <GitPullRequest className="h-3 w-3" />
              <span>PR #{task.prNumber ?? ''}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[var(--df-success)]">
              <GitPullRequest className="h-3 w-3" />
              PR #{task.prNumber}
            </span>
          )
        ) : (
          <span className="font-mono text-[11.5px]">{task.status}</span>
        )}
      </div>
    </div>
  );
}
