import { useEffect, useState } from "react";
import {
  FlaskConical,
  GitPullRequestArrow,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { SimulateIssueInput } from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";

export type DemoTierPreset = "quick_fix" | "full_sdlc" | "quota_fallback" | "ci_fail_heal";

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
    id: "quick_fix",
    name: "Quick Fix",
    badge: "快速通道",
    description: "低复杂度 Bug 修复，跳过人工 Plan 审批直接进入隔离工作区修改、校验并提 PR。",
    defaultTitle: "fix: 修复数值输入解析边界异常 (sum helper)",
    defaultBody: "调用 sum(\"1\", 2) 会拼接字符串而非数值求和，需补充数值转换与单元测试。",
    defaultLabels: "bug,auto-dev",
    icon: <Zap className="h-4 w-4 text-ink-muted" />,
  },
  {
    id: "full_sdlc",
    name: "Full SDLC",
    badge: "完整研发流",
    description: "复杂需求：Triage → Spec → Plan（人工审批卡点）→ 编码 → 测试 → 异构 Review。",
    defaultTitle: "feat: 新增多仓库 OAuth2 插件化认证与并发限流架构",
    defaultBody: "支持可插拔 OAuth2 提供方、令牌刷新、会话持久化与完整集成测试覆盖。",
    defaultLabels: "enhancement,auto-dev",
    icon: <Layers className="h-4 w-4 text-primary-text" />,
  },
  {
    id: "quota_fallback",
    name: "Quota Fallback",
    badge: "配额降级自愈",
    description: "模拟主 Agent 遭遇 quota_exceeded 限流，自动记录 Fallback 历史并切换备用 Agent。",
    defaultTitle: "[QuotaFallback] 优化批量索引管线并验证自动降级切换",
    defaultBody: "模拟主 Agent 返回 insufficient_quota，验证调度引擎自动切换至备选 CLI 完成交付。",
    defaultLabels: "bug,auto-dev",
    icon: <RefreshCw className="h-4 w-4 text-[var(--df-waiting)]" />,
  },
  {
    id: "ci_fail_heal",
    name: "CI Self-Heal",
    badge: "CI 失败自愈",
    description: "模拟 PR 创建后首次远程 CI 失败，DragonFlow 自动拉取错误并自愈修复至绿灯。",
    defaultTitle: "[CIFailHeal] 新增严格日期格式化工具并演练远程 CI 自愈",
    defaultBody: "模拟 PR 开启后远程 CI 首次报错，验证 CI_FIXING -> READY_TO_MERGE 自动闭环。",
    defaultLabels: "bug,auto-dev",
    icon: <GitPullRequestArrow className="h-4 w-4 text-[var(--df-success)]" />,
  },
];

interface SimulateIssueModalProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: SimulateIssueInput) => Promise<void>;
}

export function SimulateIssueModal({
  open,
  submitting,
  onClose,
  onSubmit,
}: SimulateIssueModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<DemoTierPreset>("quick_fix");
  const [title, setTitle] = useState(SCENARIO_PRESETS[0].defaultTitle);
  const [body, setBody] = useState(SCENARIO_PRESETS[0].defaultBody);
  const [labelsInput, setLabelsInput] = useState(SCENARIO_PRESETS[0].defaultLabels);
  const [autoTrigger, setAutoTrigger] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const choosePreset = (preset: ScenarioPreset) => {
    setSelectedPreset(preset.id);
    setTitle(preset.defaultTitle);
    setBody(preset.defaultBody);
    setLabelsInput(preset.defaultLabels);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const labels = labelsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmit({
      tierPreset: selectedPreset,
      title: title.trim() || undefined,
      body: body.trim() || undefined,
      labels,
      autoTrigger,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--df-scrim)] p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="df-float relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[10px] border border-hairline-strong bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary-text" />
            <h2 className="text-[16px] font-semibold text-ink">模拟 GitHub Issue 演练流水线</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="df-btn-ghost gap-1.5 px-2 py-1"
            aria-label="关闭弹窗"
          >
            <kbd className="df-kbd hidden sm:inline-flex">Esc</kbd>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink">选择预设演练场景</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SCENARIO_PRESETS.map((preset) => {
                const active = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => choosePreset(preset)}
                    className={`rounded-[8px] border p-3 text-left transition duration-150 ${
                      active
                        ? "border-primary bg-primary-soft"
                        : "border-hairline bg-surface-2 hover:border-hairline-strong hover:bg-surface-3"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                        {preset.icon}
                        {preset.name}
                      </span>
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
              <label className="mb-1 block text-[13px] font-medium text-ink-muted">Issue 标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="df-input h-[36px] w-full px-3 py-1.5 text-[14px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-muted">Issue 描述</label>
              <textarea
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="df-input w-full px-3 py-2 font-mono text-[13px] leading-relaxed"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-muted">
                  Labels（逗号分隔）
                </label>
                <input
                  type="text"
                  value={labelsInput}
                  onChange={(e) => setLabelsInput(e.target.value)}
                  className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13px]"
                />
              </div>

              <label className="flex min-h-[34px] cursor-pointer items-center gap-2.5 self-end rounded-[6px] border border-hairline bg-surface-2 px-3 py-1.5 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={autoTrigger}
                  onChange={(e) => setAutoTrigger(e.target.checked)}
                  className="h-4 w-4 accent-[var(--df-primary)]"
                />
                <span>
                  自动放行执行（<code className="font-mono text-primary-text">auto-dev</code>）
                </span>
              </label>
            </div>
            {!autoTrigger && (
              <div className="df-badge-waiting flex items-center gap-2 rounded-[6px] border px-3 py-2 text-[12.5px]">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>
                  关闭自动放行时，任务在分诊后会暂停于 AWAITING_TRIGGER，可从看板或托盘浮窗手动触发。
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="df-btn-secondary"
            >
              取消
            </button>
            <button type="submit" disabled={submitting} className="df-btn-primary ps-3 pe-3.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{submitting ? "正在注入任务..." : "提交并运行"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
