import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  GitHubWebhookHandler,
  NotificationDispatcher,
  formatChannelPayload,
  parseMaintainerCommand,
  verifyWebhookSignature,
} from '../src/index.js';

describe('Notifications, Commands & GitHub Webhook Verification', () => {
  it('parses maintainer slash commands cleanly', () => {
    expect(parseMaintainerCommand('/auto', 'alice', 1)).toEqual({
      command: 'auto',
      arg: undefined,
      author: 'alice',
      commentId: 1,
    });
    expect(parseMaintainerCommand('Looks good!\n/auto qodercli', 'alice', 2)).toEqual({
      command: 'auto',
      arg: 'qodercli',
      author: 'alice',
      commentId: 2,
    });
    expect(parseMaintainerCommand('/reject Please add rate limit tests', 'alice', 3)).toEqual({
      command: 'reject',
      arg: 'Please add rate limit tests',
      author: 'alice',
      commentId: 3,
    });
    expect(parseMaintainerCommand('/approve', 'alice', 4)?.command).toBe('approve');
    expect(parseMaintainerCommand('/merge', 'alice', 5)?.command).toBe('merge');
    expect(parseMaintainerCommand('just a normal comment', 'bob', 6)).toBeNull();
  });

  it('verifies GitHub HMAC-SHA256 webhook signatures using timingSafeEqual', async () => {
    const secret = 'dragonflow-test-secret';
    const rawBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'acme/demo' },
      issue: {
        number: 9,
        title: 'Crash on startup',
        body: 'Stack trace...',
        user: { login: 'alice' },
        author_association: 'OWNER',
        labels: [{ name: 'auto-dev' }],
        state: 'open',
        html_url: 'https://github.com/acme/demo/issues/9',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    const validSig = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    expect(verifyWebhookSignature(rawBody, validSig, secret)).toBe(true);
    expect(verifyWebhookSignature(rawBody, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(rawBody, undefined, secret)).toBe(false);

    const ingestIssue = vi.fn().mockResolvedValue(undefined);
    const handler = new GitHubWebhookHandler(
      {
        ingestIssue,
        handleComment: vi.fn().mockResolvedValue(undefined),
        pollOpenPrs: vi.fn().mockResolvedValue(0),
      },
      secret,
    );

    const rejected = await handler.handleEvent({
      eventName: 'issues',
      signatureHeader: 'sha256=0000',
      rawBody,
    });
    expect(rejected.accepted).toBe(false);
    expect(ingestIssue).not.toHaveBeenCalled();

    const accepted = await handler.handleEvent({
      eventName: 'issues',
      signatureHeader: validSig,
      rawBody,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.action).toBe('issues:opened');
    expect(ingestIssue).toHaveBeenCalledTimes(1);
  });

  it('formats IM webhook payloads for Feishu, DingTalk, WeCom, Slack, Discord, and Telegram', async () => {
    const env = {
      FEISHU_URL: 'https://open.feishu.cn/hook/1',
      FEISHU_SEC: 'sec1',
      DING_URL: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
      DING_SEC: 'SECabc',
      WECOM_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1',
      SLACK_URL: 'https://hooks.slack.com/services/1/2/3',
      DISCORD_URL: 'https://discord.com/api/webhooks/1/2',
      TG_URL: 'https://api.telegram.org/bot123/sendMessage',
      TG_CHAT: '-10012345',
    };

    const msg = {
      event: 'ready_to_merge' as const,
      repoFullName: 'acme/demo',
      issueNumber: 12,
      title: 'Add OAuth login',
      summary: 'CI passed',
      agentId: 'claude',
      prUrl: 'https://github.com/acme/demo/pull/15',
    };

    const feishu = formatChannelPayload(
      { id: 'f', type: 'feishu', enabled: true, urlEnv: 'FEISHU_URL', secretEnv: 'FEISHU_SEC', events: ['ready_to_merge'] },
      msg,
      env,
    );
    expect(feishu.body.msg_type).toBe('text');
    expect(feishu.body.sign).toBeTruthy();

    const ding = formatChannelPayload(
      { id: 'd', type: 'dingtalk', enabled: true, urlEnv: 'DING_URL', secretEnv: 'DING_SEC', events: ['ready_to_merge'] },
      msg,
      env,
    );
    expect(ding.url).toContain('&timestamp=');
    expect(ding.url).toContain('&sign=');
    expect(ding.body.msgtype).toBe('markdown');

    const tg = formatChannelPayload(
      { id: 't', type: 'telegram', enabled: true, urlEnv: 'TG_URL', chatIdEnv: 'TG_CHAT', events: ['ready_to_merge'] },
      msg,
      env,
    );
    expect(tg.body.chat_id).toBe('-10012345');

    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const dispatcher = new NotificationDispatcher(
      [
        { id: 'slack', type: 'slack', enabled: true, urlEnv: 'SLACK_URL', events: ['ready_to_merge'] },
        { id: 'wecom', type: 'wecom', enabled: true, urlEnv: 'WECOM_URL', events: ['released'] },
      ],
      env,
      mockFetch as unknown as typeof fetch,
    );

    const res = await dispatcher.notify(msg);
    expect(res.sent).toBe(1);
    expect(res.errors).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
