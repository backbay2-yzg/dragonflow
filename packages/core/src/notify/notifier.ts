import { createHmac } from 'node:crypto';
import type {
  NotificationChannelConfig,
  NotificationEventType,
} from '@dragonflow/shared';

export interface NotificationMessage {
  event: NotificationEventType;
  repoFullName: string;
  issueNumber: number;
  title: string;
  summary: string;
  agentId?: string;
  prUrl?: string;
  releaseUrl?: string;
  issueUrl?: string;
}

export function formatChannelPayload(
  channel: NotificationChannelConfig,
  msg: NotificationMessage,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; body: Record<string, unknown> } {
  const baseUrl = env[channel.urlEnv];
  if (!baseUrl) {
    throw new Error(`Missing webhook URL env "${channel.urlEnv}" for channel ${channel.id}`);
  }

  const lines = [
    `[DragonFlow] ${msg.event.toUpperCase()} — ${msg.repoFullName}#${msg.issueNumber}`,
    `标题: ${msg.title}`,
    `说明: ${msg.summary}`,
    msg.agentId ? `Agent: ${msg.agentId}` : null,
    msg.prUrl ? `PR: ${msg.prUrl}` : null,
    msg.releaseUrl ? `Release: ${msg.releaseUrl}` : null,
    msg.issueUrl ? `Issue: ${msg.issueUrl}` : null,
  ].filter(Boolean);

  const text = lines.join('\n');

  switch (channel.type) {
    case 'feishu': {
      const body: Record<string, unknown> = {
        msg_type: 'text',
        content: { text },
      };
      const secret = channel.secretEnv ? env[channel.secretEnv] : undefined;
      if (secret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const stringToSign = `${timestamp}\n${secret}`;
        const sign = createHmac('sha256', stringToSign).digest('base64');
        body.timestamp = timestamp;
        body.sign = sign;
      }
      return { url: baseUrl, body };
    }

    case 'dingtalk': {
      let url = baseUrl;
      const secret = channel.secretEnv ? env[channel.secretEnv] : undefined;
      if (secret) {
        const timestamp = Date.now().toString();
        const stringToSign = `${timestamp}\n${secret}`;
        const sign = encodeURIComponent(
          createHmac('sha256', secret).update(stringToSign).digest('base64'),
        );
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}timestamp=${timestamp}&sign=${sign}`;
      }
      return {
        url,
        body: {
          msgtype: 'markdown',
          markdown: {
            title: `DragonFlow #${msg.issueNumber}`,
            text: lines.map((l) => `- ${l}`).join('\n'),
          },
        },
      };
    }

    case 'wecom':
      return {
        url: baseUrl,
        body: {
          msgtype: 'markdown',
          markdown: { content: text },
        },
      };

    case 'slack':
      return {
        url: baseUrl,
        body: { text },
      };

    case 'discord':
      return {
        url: baseUrl,
        body: { content: text },
      };

    case 'telegram': {
      const chatId = channel.chatIdEnv ? env[channel.chatIdEnv] : undefined;
      return {
        url: baseUrl,
        body: {
          chat_id: chatId,
          text,
        },
      };
    }

    case 'generic':
    default:
      return {
        url: baseUrl,
        body: { ...msg, text },
      };
  }
}

export class NotificationDispatcher {
  constructor(
    private readonly channels: NotificationChannelConfig[] = [],
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notify(msg: NotificationMessage): Promise<{ sent: number; errors: string[] }> {
    const activeChannels = this.channels.filter(
      (c) => c.enabled && c.events.includes(msg.event) && Boolean(this.env[c.urlEnv]),
    );
    if (activeChannels.length === 0) {
      return { sent: 0, errors: [] };
    }

    let sent = 0;
    const errors: string[] = [];

    await Promise.all(
      activeChannels.map(async (channel) => {
        try {
          const { url, body } = formatChannelPayload(channel, msg, this.env);
          const res = await this.fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            errors.push(`${channel.id}: HTTP ${res.status}`);
          } else {
            sent += 1;
          }
        } catch (err) {
          errors.push(
            `${channel.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );

    return { sent, errors };
  }
}
