import { useEffect, useRef, useState } from 'react';
import type {
  AgentHealthInfo,
  DashboardOverview,
  SanitizedConfig,
  SseEvent,
  TaskDetailResponse,
  TaskLogEntry,
  TaskRecord,
} from '@dragonflow/shared';

export type DemoTierPreset = 'quick_fix' | 'full_sdlc' | 'quota_fallback' | 'ci_fail_heal';

export interface SimulateIssuePayload {
  title?: string;
  body?: string;
  labels?: string[];
  tierPreset?: DemoTierPreset;
  autoTrigger?: boolean;
}

export interface SimulateIssueResponse {
  task: TaskRecord;
  issueNumber: number;
}

export interface SyncResponse {
  synced: boolean;
  issuesProcessed: number;
  prsChecked: number;
}

export type SseConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string; message?: string };
          message = parsed.error || parsed.message || text;
        } catch {
          message = text;
        }
      }
    } catch {
      // Ignore secondary body parsing errors
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

export function fetchOverview(): Promise<DashboardOverview> {
  return requestJson<DashboardOverview>('/api/overview');
}

export async function fetchTasks(): Promise<TaskRecord[]> {
  const data = await requestJson<{ tasks: TaskRecord[] }>('/api/tasks');
  return data.tasks;
}

export function fetchTaskDetail(taskId: string): Promise<TaskDetailResponse> {
  return requestJson<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function fetchTaskLogs(taskId: string): Promise<TaskLogEntry[]> {
  const data = await requestJson<{ logs: TaskLogEntry[] }>(`/api/tasks/${encodeURIComponent(taskId)}/logs`);
  return data.logs;
}

export async function triggerTask(taskId: string, agentId?: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/trigger`, {
    method: 'POST',
    body: JSON.stringify(agentId ? { agentId } : {}),
  });
  return data.task;
}

export async function approvePlan(taskId: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/approve-plan`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return data.task;
}

export async function rejectPlan(taskId: string, feedback: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/reject-plan`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  });
  return data.task;
}

export async function retryTask(taskId: string, agentId?: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST',
    body: JSON.stringify(agentId ? { agentId } : {}),
  });
  return data.task;
}

export async function mergeTask(taskId: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/merge`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return data.task;
}

export async function cancelTask(taskId: string): Promise<TaskRecord> {
  const data = await requestJson<{ task: TaskRecord }>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return data.task;
}

export function syncNow(): Promise<SyncResponse> {
  return requestJson<SyncResponse>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function simulateIssue(payload: SimulateIssuePayload): Promise<SimulateIssueResponse> {
  return requestJson<SimulateIssueResponse>('/api/demo/simulate-issue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAgents(): Promise<AgentHealthInfo[]> {
  const data = await requestJson<{ agents: AgentHealthInfo[] }>('/api/agents');
  return data.agents;
}

export async function probeAgents(): Promise<AgentHealthInfo[]> {
  const data = await requestJson<{ agents: AgentHealthInfo[] }>('/api/agents/probe', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return data.agents;
}

export async function fetchConfig(): Promise<SanitizedConfig> {
  const data = await requestJson<{ config: SanitizedConfig }>('/api/config');
  return data.config;
}

export function useSseEvents(onEvent: (event: SseEvent) => void): {
  status: SseConnectionStatus;
  lastHeartbeatAt: string | null;
} {
  const [status, setStatus] = useState<SseConnectionStatus>('connecting');
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let retryAttempt = 0;

    const clearTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (closed) return;
      clearTimer();
      setStatus((prev) => (prev === 'reconnecting' ? 'reconnecting' : 'connecting'));

      const es = new EventSource('/api/events');
      source = es;

      es.onopen = () => {
        if (closed) return;
        retryAttempt = 0;
        setStatus('connected');
      };

      es.onmessage = (msg) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(msg.data) as SseEvent;
          if (parsed.type === 'heartbeat') {
            setLastHeartbeatAt(parsed.timestamp);
          }
          onEventRef.current(parsed);
        } catch {
          // Ignore malformed keepalive or non-JSON frames
        }
      };

      es.onerror = () => {
        es.close();
        if (source === es) {
          source = null;
        }
        if (closed) return;
        setStatus('reconnecting');
        const delayMs = Math.min(15000, 1000 * Math.pow(2, retryAttempt));
        retryAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimer();
      if (source) {
        source.close();
        source = null;
      }
      setStatus('disconnected');
    };
  }, []);

  return { status, lastHeartbeatAt };
}
