import { useEffect, useState } from 'react';
import {
  FlaskConical,
  GitPullRequestArrow,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { DemoTierPreset, SimulateIssuePayload } from '../api/client';

interface ScenarioPreset {
  id: DemoTierPreset;
  name: string;
  badge: string;
  description: string;
  defaultTitle: string;
  defaultBody: string;
  defaultLabels: string;
  icon: React.ReactNode;
}

const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'quick_fix',
    name: 'Quick Fix',
    badge: '快速通道',
    description: '低复杂度 Bug / 文档修复，跳过人工审批门禁，直接编码、单测并提 PR。',
    defaultTitle: 'fix: 修复配置文件缺少可选字段时健康检查抛出异常',
    defaultBody:
      '当 workspace.dockerImage 未显式配置时，health check 路由会抛出 TypeError。\n\n期望行为：\n- 回退默认值并补充单元测试验证边界条件。',
    defaultLabels: 'bug,auto-dev',
    icon: <Zap className="h-4 w-4 text-ink-muted" />,
  },
  {
    id: 'full_sdlc',
    name: 'Full SDLC',
    badge: '完整研发流',
    description: '复杂功能需求，执行 Triage → Spec → Plan（人工审批门禁）→ 编码 → 测试 → 跨模型 Review。',
    defaultTitle: 'feat: 新增多仓库 Webhook 签名校验与任务并发限流队列',
    defaultBody:
      '需要为任务调度器增加按仓库维度的并发上限控制，并在 Webhook 入口校验 X-Hub-Signature-256。\n\n验收标准：\n1. 支持配置 maxConcurrentTasks\n2. 签名非法返回 401\n3. 补充完整集成测试',
    defaultLabels: 'enhancement,auto-dev',
    icon: <Layers className="h-4 w-4 text-primary-text" />,
  },
  {
    id: 'quota_fallback',
    name: 'Quota Fallback',
    badge: '配额降级自愈',
    description: '模拟主 Agent 发生 quota_exceeded / 限流，自动记录 Fallback 历史并切换备用 CLI 完成交付。',
    defaultTitle: 'feat: 重构 CLI 输出流式解析器并增强错误分类器 [quota-demo]',
    defaultBody:
      '测试当主执行 Agent 返回配额不足错误时，调度引擎自动识别 quota_exceeded 并按 fallbackOrder 切换至下一可用 Agent 继续执行。',
    defaultLabels: 'refactor,auto-dev',
    icon: <RefreshCw className="h-4 w-4 text-[var(--df-waiting)]" />,
  },
  {
    id: 'ci_fail_heal',
    name: 'CI + Review Self-Heal',
    badge: 'CI 与 Review 自愈',
    description: '模拟 PR 创建后 CI 检查失败与 Reviewer 提出修改意见，自动拉取日志自愈修复后转绿。',
    defaultTitle: 'fix: 修复 PR 并发状态机竞态导致的构建失败 [ci-heal-demo]',
    defaultBody:
      '模拟 PR 打开后首次 CI Check Run 失败且 Review 提出边界问题，验证 CI_FIXING -> REVIEW_FIXING -> READY_TO_MERGE 自动修复闭环。',
    defaultLabels: 'bug,auto-dev',
    icon: <GitPullRequestArrow className="h-4 w-4 text-[var(--df-success)]" />,
  },
];

interface SimulateIssueModalProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: SimulateIssuePayload) => Promise<void>;
}

export function SimulateIssueModal({
  open,
  submitting,
  onClose,
  onSubmit,
}: SimulateIssueModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<DemoTierPreset>('quick_fix');
  const [title, setTitle] = useState(SCENARIO_PRESETS[0].defaultTitle);
  const [body, setBody] = useState(SCENARIO_PRESETS[0].defaultBody);
  const [labelsInput, setLabelsInput] = useState(SCENARIO_PRESETS[0].defaultLabels);
  const [autoTrigger, setAutoTrigger] = useState(true);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleSelectPreset = (preset: ScenarioPreset) => {
    setSelectedPreset(preset.id);
    setTitle(preset.defaultTitle);
    setBody(preset.defaultBody);
    setLabelsInput(preset.defaultLabels);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const labels = labelsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await onSubmit({
      tierPreset: selectedPreset,
      title: title.trim() || undefined,
      body: body.trim() || undefined,
      labels: labels.length > 0 ? labels : undefined,
      autoTrigger,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--df-scrim)] p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="df-float flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[10px] border border-hairline-strong bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary-text" />
            <h2 className="text-[16px] font-semibold text-ink">模拟 GitHub Issue 演练</h2>
            <span className="hidden rounded-[4px] border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-ink-muted sm:inline-flex">
              POST /api/demo/simulate-issue
            </span>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="df-btn-ghost gap-1.5 px-2 py-1"
            aria-label="关闭弹窗"
          >
            <kbd className="df-kbd hidden sm:inline-flex">Esc</kbd>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink">选择演练场景预设</span>
              <span className="text-[12px] text-ink-subtle">点击卡片自动填充标题与描述</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SCENARIO_PRESETS.map((preset) => {
                const active = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`flex flex-col rounded-[8px] border p-3 text-left transition duration-150 ${
                      active
                        ? 'border-primary bg-primary-soft'
                        : 'border-hairline bg-surface-2 hover:border-hairline-strong hover:bg-surface-3'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {preset.icon}
                        <span className="text-[14px] font-semibold text-ink">{preset.name}</span>
                      </div>
                      <span className="rounded-[4px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[12px] text-ink-muted">
                        {preset.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 border-t border-hairline-subtle pt-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-muted" htmlFor="sim-title">
                Issue 标题
              </label>
              <input
                id="sim-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入自定义 Issue 标题..."
                className="df-input h-[36px] w-full px-3 py-1.5 text-[14px]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-muted" htmlFor="sim-body">
                Issue 正文描述
              </label>
              <textarea
                id="sim-body"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="描述需求背景、复现步骤或验收标准..."
                className="df-input w-full px-3 py-2 font-mono text-[13px] leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-muted" htmlFor="sim-labels">
                  Labels（逗号分隔）
                </label>
                <input
                  id="sim-labels"
                  type="text"
                  value={labelsInput}
                  onChange={(e) => setLabelsInput(e.target.value)}
                  placeholder="bug, auto-dev"
                  className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13px]"
                />
              </div>

              <div className="flex items-end">
                <label className="flex min-h-[34px] w-full cursor-pointer items-center gap-2 rounded-[6px] border border-hairline bg-surface-2 px-3 py-1.5 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={autoTrigger}
                    onChange={(e) => setAutoTrigger(e.target.checked)}
                    className="h-4 w-4 accent-[var(--df-primary)]"
                  />
                  <span>
                    自动触发流水线 (
                    <code className="font-mono text-primary-text">autoTrigger</code>)
                  </span>
                </label>
              </div>
            </div>

            {!autoTrigger && (
              <div className="df-badge-waiting flex items-center gap-2 rounded-[6px] border px-3 py-2 text-[12.5px]">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>
                  关闭自动触发后，任务将停留在待触发阶段，可在看板详情抽屉中手动指定 Agent 触发。
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="df-btn-secondary"
            >
              取消
            </button>
            <button type="submit" disabled={submitting} className="df-btn-primary ps-3 pe-3.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {submitting ? '正在创建...' : autoTrigger ? '创建并立即执行' : '创建模拟 Issue'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
