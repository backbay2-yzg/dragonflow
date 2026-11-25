import { useEffect, useState } from "react";
import {
  Bell,
  Cpu,
  Download,
  FolderOpen,
  GitBranch,
  KeyRound,
  Plus,
  Route,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AgentType,
  NotificationEventType,
  type AgentProfile,
  type DesktopInfo,
  type DragonFlowConfig,
  type RepoConfig,
  type RoutingRule,
  type SanitizedConfig,
  type SecretStatus,
} from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import * as AppService from "../../bindings/github.com/dragonflow/desktop/services/appservice";
import * as ConfigService from "../../bindings/github.com/dragonflow/desktop/services/configservice";
import { getErrorMessage } from "../utils/format";
import { SelectPopover, type SelectOption } from "./SelectPopover";

type ConfigSubTab = "general" | "github" | "llm_routing" | "agents" | "notify" | "secrets_yaml";

interface ConfigEditorViewProps {
  config: SanitizedConfig | null;
  desktopInfo: DesktopInfo | null;
  secrets: SecretStatus[];
  onSaved: (next: SanitizedConfig) => void;
  onSecretsUpdated: (next: SecretStatus[]) => void;
  onDesktopInfoUpdated: (next: DesktopInfo) => void;
  onToast: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

const ALL_NOTIFY_EVENTS: readonly { id: NotificationEventType; label: string }[] = [
  { id: NotificationEventType.NotifyPlanAwaitingApproval, label: "待审批方案" },
  { id: NotificationEventType.NotifyReadyToMerge, label: "PR 待合并" },
  { id: NotificationEventType.NotifyNeedsHuman, label: "需人工介入" },
  { id: NotificationEventType.NotifyReleased, label: "正式发版" },
  { id: NotificationEventType.NotifyFailed, label: "执行失败" },
  { id: NotificationEventType.NotifyAgentFallback, label: "Agent 降级" },
  { id: NotificationEventType.NotifyPrOpened, label: "PR 已开启" },
  { id: NotificationEventType.NotifyCiFailed, label: "CI 失败" },
];

const LLM_MODE_OPTIONS: readonly SelectOption[] = [
  { value: "cli_fallback", label: "cli_fallback (API 优先 + CLI 兜底)" },
  { value: "api", label: "api (仅 HTTP API)" },
  { value: "cli_only", label: "cli_only (仅无头编码 CLI)" },
];

const LLM_PROVIDER_OPTIONS: readonly SelectOption[] = [
  { value: "openai-compatible", label: "openai-compatible" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
];

const PROMPT_MODE_OPTIONS: readonly SelectOption[] = [
  { value: "stdin", label: "stdin" },
  { value: "arg", label: "arg" },
  { value: "file", label: "file" },
];

const NOTIFY_CHANNEL_OPTIONS: readonly SelectOption[] = [
  { value: "feishu", label: "飞书 Feishu" },
  { value: "dingtalk", label: "钉钉 DingTalk" },
  { value: "wecom", label: "企业微信 WeCom" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
  { value: "generic", label: "Generic Webhook" },
];

function toEditableConfig(cfg: SanitizedConfig): DragonFlowConfig {
  return {
    project: { ...cfg.project },
    github: {
      tokenEnv: cfg.github.tokenEnv,
      webhookSecretEnv: cfg.github.webhookSecretEnv,
      pollIntervalSec: cfg.github.pollIntervalSec,
      repositories: (cfg.github.repositories ?? []).map((r) => ({ ...r })),
      triggerLabel: cfg.github.triggerLabel,
      needsHumanLabel: cfg.github.needsHumanLabel,
      ownerFastTrack: cfg.github.ownerFastTrack,
      maintainers: [...(cfg.github.maintainers ?? [])],
      autoMergeLowRisk: {
        ...cfg.github.autoMergeLowRisk,
        allowedCategories: [...(cfg.github.autoMergeLowRisk.allowedCategories ?? [])],
      },
    },
    llm: { ...cfg.llm },
    agents: (cfg.agents ?? []).map((a) => ({
      ...a,
      args: [...(a.args ?? [])],
      strengths: [...(a.strengths ?? [])],
      envAllowlist: [...(a.envAllowlist ?? [])],
      template: a.template
        ? {
            argsTemplate: [...(a.template.argsTemplate ?? [])],
            quotaErrorPatterns: [...(a.template.quotaErrorPatterns ?? [])],
            versionArgs: [...(a.template.versionArgs ?? [])],
          }
        : null,
    })),
    routing: {
      ...cfg.routing,
      fallbackOrder: [...(cfg.routing.fallbackOrder ?? [])],
      rules: (cfg.routing.rules ?? []).map((r) => ({
        ...r,
        match: { ...r.match },
        fallbackAgents: [...(r.fallbackAgents ?? [])],
      })),
    },
    workflow: { ...cfg.workflow },
    release: { ...cfg.release },
    workspace: { ...cfg.workspace },
    notifications: {
      channels: (cfg.notifications.channels ?? []).map((c) => ({
        ...c,
        events: [...(c.events ?? [])],
      })),
    },
    server: { ...cfg.server },
    desktop: {
      ...cfg.desktop,
      notifyEvents: [...(cfg.desktop.notifyEvents ?? [])],
    },
  };
}

export function ConfigEditorView({
  config,
  desktopInfo,
  secrets,
  onSaved,
  onSecretsUpdated,
  onDesktopInfoUpdated,
  onToast,
}: ConfigEditorViewProps) {
  const [subTab, setSubTab] = useState<ConfigSubTab>("general");
  const [draft, setDraft] = useState<DragonFlowConfig | null>(() =>
    config ? toEditableConfig(config) : null,
  );
  const [saving, setSaving] = useState(false);

  // Secret vault input state
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newSecretVal, setNewSecretVal] = useState("");

  // YAML export / import state
  const [yamlText, setYamlText] = useState("");

  useEffect(() => {
    if (config) {
      setDraft(toEditableConfig(config));
    }
  }, [config]);

  if (!draft) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-hairline bg-surface-1 text-[13px] text-ink-subtle">
        正在加载配置...
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await ConfigService.SaveConfig(draft);
      onSaved(updated);
      const info = await AppService.GetDesktopInfo();
      onDesktopInfoUpdated(info);
      onToast("success", "配置已保存并热重载", `当前模式: ${updated.project.mode.toUpperCase()}`);
    } catch (err) {
      onToast("error", "保存配置失败", getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAutostart = async (enabled: boolean) => {
    try {
      const actual = await AppService.SetAutostart(enabled);
      const info = await AppService.GetDesktopInfo();
      onDesktopInfoUpdated({ ...info, autostart: actual });
      onToast("success", actual ? "已开启开机自启" : "已关闭开机自启");
    } catch (err) {
      onToast("error", "设置开机自启失败", getErrorMessage(err));
    }
  };

  const handleSaveSecret = async (key: string, value: string) => {
    if (!key.trim() || !value.trim()) return;
    try {
      const next = await ConfigService.SetSecret(key.trim(), value.trim());
      onSecretsUpdated(next ?? []);
      setSecretInputs((prev) => ({ ...prev, [key]: "" }));
      const refreshed = await ConfigService.GetConfig();
      onSaved(refreshed);
      onToast("success", "凭据已通过 Windows DPAPI 加密保存", key);
    } catch (err) {
      onToast("error", "保存凭据失败", getErrorMessage(err));
    }
  };

  const handleDeleteSecret = async (key: string) => {
    try {
      const next = await ConfigService.DeleteSecret(key);
      onSecretsUpdated(next ?? []);
      const refreshed = await ConfigService.GetConfig();
      onSaved(refreshed);
      onToast("info", "已清除保险箱凭据", key);
    } catch (err) {
      onToast("error", "清除凭据失败", getErrorMessage(err));
    }
  };

  const handleLoadYaml = async () => {
    try {
      const text = await ConfigService.ExportYAML();
      setYamlText(text);
      onToast("info", "已导出当前配置 YAML");
    } catch (err) {
      onToast("error", "导出 YAML 失败", getErrorMessage(err));
    }
  };

  const handleImportYaml = async () => {
    if (!yamlText.trim()) return;
    try {
      const updated = await ConfigService.ImportYAML(yamlText);
      onSaved(updated);
      onToast("success", "YAML 已导入并应用热重载");
    } catch (err) {
      onToast("error", "YAML 导入校验失败", getErrorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Top Action Header (Scarce Single Primary CTA) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <SubTabBtn
            active={subTab === "general"}
            onClick={() => setSubTab("general")}
            icon={<Settings2 className="h-3.5 w-3.5" />}
            label="常规与桌面"
          />
          <SubTabBtn
            active={subTab === "github"}
            onClick={() => setSubTab("github")}
            icon={<GitBranch className="h-3.5 w-3.5" />}
            label="GitHub 仓库"
          />
          <SubTabBtn
            active={subTab === "llm_routing"}
            onClick={() => setSubTab("llm_routing")}
            icon={<Route className="h-3.5 w-3.5" />}
            label="LLM 与路由"
          />
          <SubTabBtn
            active={subTab === "agents"}
            onClick={() => setSubTab("agents")}
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="Agent CLI 池"
          />
          <SubTabBtn
            active={subTab === "notify"}
            onClick={() => setSubTab("notify")}
            icon={<Bell className="h-3.5 w-3.5" />}
            label="IM 通知"
          />
          <SubTabBtn
            active={subTab === "secrets_yaml"}
            onClick={() => setSubTab("secrets_yaml")}
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="DPAPI 保险箱 & YAML"
          />
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="df-btn-primary ps-3 pe-3.5"
        >
          <Save className="h-3.5 w-3.5" />
          <span>{saving ? "保存中..." : "保存并热重载"}</span>
        </button>
      </div>

      {/* Sub-Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {subTab === "general" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SectionCard title="运行模式与桌面集成">
              <Field label="运行模式">
                <div className="flex gap-0.5 rounded-[8px] border border-hairline bg-canvas p-[2px]">
                  {(["demo", "live"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, project: { ...draft.project, mode: m } })
                      }
                      className={`flex-1 rounded-[6px] border py-1.5 text-[13px] font-semibold transition duration-150 ${
                        draft.project.mode === m
                          ? "border-hairline-strong bg-surface-2 text-ink"
                          : "border-transparent text-ink-muted hover:text-ink"
                      }`}
                    >
                      {m === "demo" ? "Demo 离线演练" : "Live 真实 GitHub"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="数据与配置目录">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={desktopInfo?.dataDir || draft.project.dataDir}
                    className="df-input h-[34px] flex-1 px-3 py-1.5 font-mono text-[13px] opacity-80"
                  />
                  <button
                    type="button"
                    onClick={() => void AppService.OpenDataDir()}
                    className="df-btn-secondary ps-3 pe-3.5"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-ink-subtle" />
                    <span>打开目录</span>
                  </button>
                </div>
                <p className="mt-1.5 text-[12px] text-ink-subtle">
                  存储模式：
                  {desktopInfo?.portable
                    ? "绿色便携目录 (portable)"
                    : "系统用户目录 (%AppData%\\DragonFlow)"}
                </p>
              </Field>

              <div className="space-y-2 pt-1">
                <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                  <span>Windows 开机自动启动（静默隐藏到托盘）</span>
                  <input
                    type="checkbox"
                    checked={desktopInfo?.autostart ?? false}
                    onChange={(e) => void handleToggleAutostart(e.target.checked)}
                    className="h-4 w-4 accent-[var(--df-primary)]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                  <span className="tabular-nums">
                    启用本地 HTTP Webhook 监听服务（端口 {draft.server.port}）
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.server.webhookEnabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        server: { ...draft.server, webhookEnabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-[var(--df-primary)]"
                  />
                </label>

                {draft.server.webhookEnabled && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="监听地址">
                      <input
                        type="text"
                        value={draft.server.host}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            server: { ...draft.server, host: e.target.value },
                          })
                        }
                        className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                      />
                    </Field>
                    <Field label="监听端口">
                      <input
                        type="number"
                        value={draft.server.port}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            server: { ...draft.server, port: Number(e.target.value) || 4390 },
                          })
                        }
                        className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px] tabular-nums"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="工作流策略与 Windows 原生通知">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="最大并发任务数">
                  <input
                    type="number"
                    min={1}
                    value={draft.workflow.maxConcurrentTasks}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        workflow: {
                          ...draft.workflow,
                          maxConcurrentTasks: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1.5 font-mono text-[13.5px] tabular-nums"
                  />
                </Field>
                <Field label="Quick Fix 复杂度上限 (1~5)">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.workflow.quickFixMaxComplexity}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        workflow: {
                          ...draft.workflow,
                          quickFixMaxComplexity: Math.min(
                            5,
                            Math.max(1, Number(e.target.value) || 2),
                          ),
                        },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1.5 font-mono text-[13.5px] tabular-nums"
                  />
                </Field>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                <span>Full SDLC 强制启用 Plan 人工审批门禁</span>
                <input
                  type="checkbox"
                  checked={draft.workflow.requirePlanApprovalForFullSdlc}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      workflow: {
                        ...draft.workflow,
                        requirePlanApprovalForFullSdlc: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 accent-[var(--df-primary)]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                <span>启用 Windows 系统 Toast 卡点通知</span>
                <input
                  type="checkbox"
                  checked={draft.desktop.notificationsEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      desktop: { ...draft.desktop, notificationsEnabled: e.target.checked },
                    })
                  }
                  className="h-4 w-4 accent-[var(--df-primary)]"
                />
              </label>

              <div>
                <div className="mb-1.5 text-[12.5px] font-medium text-ink-muted">桌面弹窗提醒事件</div>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_NOTIFY_EVENTS.map((ev) => {
                    const checked = (draft.desktop.notifyEvents ?? []).includes(ev.id);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => {
                          const cur = draft.desktop.notifyEvents ?? [];
                          const next = checked ? cur.filter((x) => x !== ev.id) : [...cur, ev.id];
                          setDraft({ ...draft, desktop: { ...draft.desktop, notifyEvents: next } });
                        }}
                        className={`rounded-[6px] border px-2.5 py-1 text-[12px] font-medium transition duration-150 ${
                          checked
                            ? "border-primary-border bg-primary-soft text-primary-text"
                            : "border-hairline bg-surface-2 text-ink-muted hover:text-ink"
                        }`}
                      >
                        {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {subTab === "github" && (
          <div className="space-y-3">
            <SectionCard title="GitHub 仓库列表">
              <div className="space-y-2">
                {(draft.github.repositories ?? []).map((repo, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-2 rounded-[8px] border border-hairline bg-surface-2 p-2.5 sm:grid-cols-6"
                  >
                    <input
                      type="text"
                      value={repo.owner}
                      placeholder="owner"
                      onChange={(e) => {
                        const next = [...(draft.github.repositories ?? [])];
                        next[idx] = { ...repo, owner: e.target.value };
                        setDraft({ ...draft, github: { ...draft.github, repositories: next } });
                      }}
                      className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    />
                    <input
                      type="text"
                      value={repo.repo}
                      placeholder="repo"
                      onChange={(e) => {
                        const next = [...(draft.github.repositories ?? [])];
                        next[idx] = { ...repo, repo: e.target.value };
                        setDraft({ ...draft, github: { ...draft.github, repositories: next } });
                      }}
                      className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    />
                    <input
                      type="text"
                      value={repo.baseBranch}
                      placeholder="main"
                      onChange={(e) => {
                        const next = [...(draft.github.repositories ?? [])];
                        next[idx] = { ...repo, baseBranch: e.target.value };
                        setDraft({ ...draft, github: { ...draft.github, repositories: next } });
                      }}
                      className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    />
                    <input
                      type="text"
                      value={repo.testCommand ?? ""}
                      placeholder="testCommand"
                      onChange={(e) => {
                        const next = [...(draft.github.repositories ?? [])];
                        next[idx] = { ...repo, testCommand: e.target.value };
                        setDraft({ ...draft, github: { ...draft.github, repositories: next } });
                      }}
                      className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px] sm:col-span-2"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink">
                        <input
                          type="checkbox"
                          checked={repo.enabled}
                          onChange={(e) => {
                            const next = [...(draft.github.repositories ?? [])];
                            next[idx] = { ...repo, enabled: e.target.checked };
                            setDraft({
                              ...draft,
                              github: { ...draft.github, repositories: next },
                            });
                          }}
                          className="accent-[var(--df-primary)]"
                        />
                        <span>启用</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const next = (draft.github.repositories ?? []).filter((_, i) => i !== idx);
                          setDraft({ ...draft, github: { ...draft.github, repositories: next } });
                        }}
                        className="df-btn-danger min-h-[28px] border-transparent p-1.5"
                        aria-label="删除仓库"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const empty: RepoConfig = {
                      owner: "your-org",
                      repo: "your-repo",
                      baseBranch: "main",
                      enabled: true,
                      testCommand: "pnpm test",
                    };
                    setDraft({
                      ...draft,
                      github: {
                        ...draft.github,
                        repositories: [...(draft.github.repositories ?? []), empty],
                      },
                    });
                  }}
                  className="df-btn-secondary ps-3 pe-3.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>添加仓库</span>
                </button>
              </div>
            </SectionCard>

            <SectionCard title="门禁、轮询与低风险自动合并">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="触发标签 (Trigger Label)">
                  <input
                    type="text"
                    value={draft.github.triggerLabel}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        github: { ...draft.github, triggerLabel: e.target.value },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
                <Field label="轮询间隔 (秒 ≥5)">
                  <input
                    type="number"
                    min={5}
                    value={draft.github.pollIntervalSec}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        github: {
                          ...draft.github,
                          pollIntervalSec: Math.max(5, Number(e.target.value) || 30),
                        },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px] tabular-nums"
                  />
                </Field>
                <Field label="维护者列表 (逗号分隔)">
                  <input
                    type="text"
                    value={(draft.github.maintainers ?? []).join(", ")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        github: {
                          ...draft.github,
                          maintainers: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                  <span>Owner 快速通道（维护者 Issue 免 /auto）</span>
                  <input
                    type="checkbox"
                    checked={draft.github.ownerFastTrack}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        github: { ...draft.github, ownerFastTrack: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-[var(--df-primary)]"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                  <span>开启低风险 PR 自动合并 (Auto Merge)</span>
                  <input
                    type="checkbox"
                    checked={draft.github.autoMergeLowRisk.enabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        github: {
                          ...draft.github,
                          autoMergeLowRisk: {
                            ...draft.github.autoMergeLowRisk,
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                    className="h-4 w-4 accent-[var(--df-primary)]"
                  />
                </label>
              </div>
            </SectionCard>
          </div>
        )}

        {subTab === "llm_routing" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SectionCard title="结构化 LLM 决策配置">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="决策模式">
                  <SelectPopover
                    value={draft.llm.mode}
                    options={LLM_MODE_OPTIONS}
                    onChange={(val) => setDraft({ ...draft, llm: { ...draft.llm, mode: val } })}
                    ariaLabel="决策模式"
                    className="w-full"
                  />
                </Field>
                <Field label="模型厂商 Provider">
                  <SelectPopover
                    value={draft.llm.provider}
                    options={LLM_PROVIDER_OPTIONS}
                    onChange={(val) =>
                      setDraft({ ...draft, llm: { ...draft.llm, provider: val } })
                    }
                    ariaLabel="模型厂商 Provider"
                    className="w-full"
                  />
                </Field>
                <Field label="Model 名称">
                  <input
                    type="text"
                    value={draft.llm.model}
                    onChange={(e) =>
                      setDraft({ ...draft, llm: { ...draft.llm, model: e.target.value } })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
                <Field label="API Key 键名 (DPAPI / Env)">
                  <input
                    type="text"
                    value={draft.llm.apiKeyEnv}
                    onChange={(e) =>
                      setDraft({ ...draft, llm: { ...draft.llm, apiKeyEnv: e.target.value } })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
              </div>
              <Field label="Base URL">
                <input
                  type="text"
                  value={draft.llm.baseUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, llm: { ...draft.llm, baseUrl: e.target.value } })
                  }
                  className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                />
              </Field>
            </SectionCard>

            <SectionCard title="三层智能路由与异构 Review">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="默认主 Agent">
                  <input
                    type="text"
                    value={draft.routing.defaultAgent}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        routing: { ...draft.routing, defaultAgent: e.target.value },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
                <Field label="默认 Review Agent">
                  <input
                    type="text"
                    value={draft.routing.defaultReviewerAgent ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        routing: { ...draft.routing, defaultReviewerAgent: e.target.value },
                      })
                    }
                    className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                  />
                </Field>
              </div>
              <Field label="全局降级顺序 fallbackOrder (逗号分隔)">
                <input
                  type="text"
                  value={(draft.routing.fallbackOrder ?? []).join(", ")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      routing: {
                        ...draft.routing,
                        fallbackOrder: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                  className="df-input h-[34px] w-full px-3 py-1 font-mono text-[13.5px]"
                />
              </Field>
              <label className="flex cursor-pointer items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-ink">
                <span>强制使用与主开发 Agent 不同的异构 Agent 进行 Cross-Review</span>
                <input
                  type="checkbox"
                  checked={draft.routing.crossReviewDifferentAgent}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      routing: {
                        ...draft.routing,
                        crossReviewDifferentAgent: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 accent-[var(--df-primary)]"
                />
              </label>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[13px] font-medium text-ink-muted">
                  <span className="tabular-nums">
                    静态路由规则 ({(draft.routing.rules ?? []).length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const rule: RoutingRule = {
                        name: "custom-rule",
                        priority: 50,
                        match: { titleRegex: "" },
                        agentId: draft.routing.defaultAgent,
                      };
                      setDraft({
                        ...draft,
                        routing: {
                          ...draft.routing,
                          rules: [...(draft.routing.rules ?? []), rule],
                        },
                      });
                    }}
                    className="df-btn-ghost min-h-[28px] px-2.5 py-0.5 text-[12.5px] text-primary-text"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>新增规则</span>
                  </button>
                </div>
                {(draft.routing.rules ?? []).map((rule, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-4 gap-1.5 rounded-[6px] border border-hairline bg-surface-2 p-2 text-[13px]"
                  >
                    <input
                      type="text"
                      value={rule.name}
                      onChange={(e) => {
                        const rules = [...(draft.routing.rules ?? [])];
                        rules[idx] = { ...rule, name: e.target.value };
                        setDraft({ ...draft, routing: { ...draft.routing, rules } });
                      }}
                      className="df-input h-[30px] px-2.5 py-0.5 font-mono text-[12.5px]"
                      placeholder="规则名"
                    />
                    <input
                      type="number"
                      value={rule.priority}
                      onChange={(e) => {
                        const rules = [...(draft.routing.rules ?? [])];
                        rules[idx] = { ...rule, priority: Number(e.target.value) || 100 };
                        setDraft({ ...draft, routing: { ...draft.routing, rules } });
                      }}
                      className="df-input h-[30px] px-2.5 py-0.5 font-mono text-[12.5px] tabular-nums"
                      placeholder="优先级"
                    />
                    <input
                      type="text"
                      value={rule.agentId}
                      onChange={(e) => {
                        const rules = [...(draft.routing.rules ?? [])];
                        rules[idx] = { ...rule, agentId: e.target.value };
                        setDraft({ ...draft, routing: { ...draft.routing, rules } });
                      }}
                      className="df-input h-[30px] px-2.5 py-0.5 font-mono text-[12.5px]"
                      placeholder="agentId"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const rules = (draft.routing.rules ?? []).filter((_, i) => i !== idx);
                          setDraft({ ...draft, routing: { ...draft.routing, rules } });
                        }}
                        className="df-btn-danger min-h-[28px] border-transparent p-1.5"
                        aria-label="删除规则"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {subTab === "agents" && (
          <SectionCard title="编码 Agent CLI 池配置（含自定义模板扩展）">
            <div className="space-y-2">
              {(draft.agents ?? []).map((ag, idx) => (
                <div
                  key={ag.id + idx}
                  className="grid grid-cols-1 gap-2 rounded-[8px] border border-hairline bg-surface-2 p-2.5 sm:grid-cols-6"
                >
                  <input
                    type="text"
                    value={ag.id}
                    placeholder="id"
                    onChange={(e) => {
                      const next = [...(draft.agents ?? [])];
                      next[idx] = { ...ag, id: e.target.value };
                      setDraft({ ...draft, agents: next });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                  />
                  <input
                    type="text"
                    value={ag.displayName}
                    placeholder="显示名称"
                    onChange={(e) => {
                      const next = [...(draft.agents ?? [])];
                      next[idx] = { ...ag, displayName: e.target.value };
                      setDraft({ ...draft, agents: next });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 text-[13px]"
                  />
                  <input
                    type="text"
                    value={ag.command}
                    placeholder="CLI 命令"
                    onChange={(e) => {
                      const next = [...(draft.agents ?? [])];
                      next[idx] = { ...ag, command: e.target.value };
                      setDraft({ ...draft, agents: next });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                  />
                  <input
                    type="text"
                    value={ag.model ?? ""}
                    placeholder="可选 model"
                    onChange={(e) => {
                      const next = [...(draft.agents ?? [])];
                      next[idx] = { ...ag, model: e.target.value };
                      setDraft({ ...draft, agents: next });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                  />
                  <SelectPopover
                    value={ag.promptMode}
                    options={PROMPT_MODE_OPTIONS}
                    onChange={(val) => {
                      const next = [...(draft.agents ?? [])];
                      next[idx] = { ...ag, promptMode: val };
                      setDraft({ ...draft, agents: next });
                    }}
                    ariaLabel={`选择 ${ag.id} promptMode`}
                    compact
                    mono
                    className="w-full"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink">
                      <input
                        type="checkbox"
                        checked={ag.enabled}
                        onChange={(e) => {
                          const next = [...(draft.agents ?? [])];
                          next[idx] = { ...ag, enabled: e.target.checked };
                          setDraft({ ...draft, agents: next });
                        }}
                        className="accent-[var(--df-primary)]"
                      />
                      <span>启用</span>
                    </label>
                    {ag.type === AgentType.AgentTemplate && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = (draft.agents ?? []).filter((_, i) => i !== idx);
                          setDraft({ ...draft, agents: next });
                        }}
                        className="df-btn-danger min-h-[28px] border-transparent p-1.5"
                        aria-label="删除自定义 CLI"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const custom: AgentProfile = {
                    id: `custom-cli-${(draft.agents ?? []).length + 1}`,
                    displayName: "Custom Coding CLI",
                    type: AgentType.AgentTemplate,
                    enabled: true,
                    command: "my-agent-cli",
                    args: [],
                    strengths: ["custom"],
                    costTier: "medium",
                    timeoutSec: 900,
                    envAllowlist: [],
                    promptMode: "file",
                    outputMode: "text",
                    template: {
                      argsTemplate: ["exec", "--cwd", "{{cwd}}", "--file", "{{promptFile}}"],
                      quotaErrorPatterns: ["quota exceeded"],
                      versionArgs: ["--version"],
                    },
                  };
                  setDraft({ ...draft, agents: [...(draft.agents ?? []), custom] });
                }}
                className="df-btn-secondary ps-3 pe-3.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新增自定义 Template CLI</span>
              </button>
            </div>
          </SectionCard>
        )}

        {subTab === "notify" && (
          <SectionCard title="IM Webhook 通知渠道（飞书 / 钉钉 / 企业微信 / Slack / Discord / Telegram）">
            <div className="space-y-2.5">
              {(draft.notifications.channels ?? []).map((ch, idx) => (
                <div
                  key={ch.id + idx}
                  className="grid grid-cols-1 gap-2 rounded-[8px] border border-hairline bg-surface-2 p-2.5 sm:grid-cols-5"
                >
                  <input
                    type="text"
                    value={ch.id}
                    onChange={(e) => {
                      const next = [...(draft.notifications.channels ?? [])];
                      next[idx] = { ...ch, id: e.target.value };
                      setDraft({ ...draft, notifications: { channels: next } });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    placeholder="渠道 ID"
                  />
                  <SelectPopover
                    value={ch.type}
                    options={NOTIFY_CHANNEL_OPTIONS}
                    onChange={(val) => {
                      const next = [...(draft.notifications.channels ?? [])];
                      next[idx] = { ...ch, type: val };
                      setDraft({ ...draft, notifications: { channels: next } });
                    }}
                    ariaLabel={`选择渠道 ${ch.id} 类型`}
                    compact
                    className="w-full"
                  />
                  <input
                    type="text"
                    value={ch.urlEnv}
                    onChange={(e) => {
                      const next = [...(draft.notifications.channels ?? [])];
                      next[idx] = { ...ch, urlEnv: e.target.value };
                      setDraft({ ...draft, notifications: { channels: next } });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    placeholder="URL 凭据键名"
                  />
                  <input
                    type="text"
                    value={ch.secretEnv ?? ""}
                    onChange={(e) => {
                      const next = [...(draft.notifications.channels ?? [])];
                      next[idx] = { ...ch, secretEnv: e.target.value };
                      setDraft({ ...draft, notifications: { channels: next } });
                    }}
                    className="df-input h-[30px] px-2.5 py-1 font-mono text-[13px]"
                    placeholder="可选 Secret 键名"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink">
                      <input
                        type="checkbox"
                        checked={ch.enabled}
                        onChange={(e) => {
                          const next = [...(draft.notifications.channels ?? [])];
                          next[idx] = { ...ch, enabled: e.target.checked };
                          setDraft({ ...draft, notifications: { channels: next } });
                        }}
                        className="accent-[var(--df-primary)]"
                      />
                      <span>启用</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = (draft.notifications.channels ?? []).filter((_, i) => i !== idx);
                        setDraft({ ...draft, notifications: { channels: next } });
                      }}
                      className="df-btn-danger min-h-[28px] border-transparent p-1.5"
                      aria-label="删除通知渠道"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    notifications: {
                      channels: [
                        ...(draft.notifications.channels ?? []),
                        {
                          id: `channel-${(draft.notifications.channels ?? []).length + 1}`,
                          type: "feishu",
                          enabled: false,
                          urlEnv: "FEISHU_WEBHOOK_URL",
                          secretEnv: "FEISHU_WEBHOOK_SECRET",
                          events: [
                            NotificationEventType.NotifyPlanAwaitingApproval,
                            NotificationEventType.NotifyReadyToMerge,
                            NotificationEventType.NotifyNeedsHuman,
                            NotificationEventType.NotifyReleased,
                          ],
                        },
                      ],
                    },
                  });
                }}
                className="df-btn-secondary ps-3 pe-3.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新增通知渠道</span>
              </button>
            </div>
          </SectionCard>
        )}

        {subTab === "secrets_yaml" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SectionCard title="Windows DPAPI 凭据保险箱（不写入 YAML 明文）">
              <p className="text-[12.5px] text-ink-muted">
                凭据使用当前 Windows 用户身份经 DPAPI (
                <code className="rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-ink">
                  CryptProtectData
                </code>
                ) 加密存入{" "}
                <code className="rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-ink">
                  secrets.vault
                </code>
                ，优先级高于系统环境变量。
              </p>

              <div className="space-y-2">
                {secrets.map((st) => (
                  <div
                    key={st.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="selectable font-mono text-[13px] font-semibold text-ink">
                          {st.key}
                        </code>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${
                            st.configured ? "df-badge-success" : "df-badge-neutral"
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          <span>
                            {st.source === "vault"
                              ? "DPAPI 保险箱"
                              : st.source === "env"
                                ? "系统环境变量"
                                : "未配置"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={secretInputs[st.key] ?? ""}
                        onChange={(e) =>
                          setSecretInputs((prev) => ({ ...prev, [st.key]: e.target.value }))
                        }
                        placeholder="输入新凭据覆盖..."
                        className="df-input h-[30px] w-44 px-2.5 py-1 font-mono text-[13px]"
                      />
                      <button
                        type="button"
                        disabled={!(secretInputs[st.key] ?? "").trim()}
                        onClick={() => void handleSaveSecret(st.key, secretInputs[st.key] ?? "")}
                        className="df-btn-secondary min-h-[30px] px-3 py-1 text-[12.5px]"
                      >
                        存入
                      </button>
                      {st.source === "vault" && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteSecret(st.key)}
                          title="从保险箱删除"
                          aria-label={`删除 ${st.key}`}
                          className="df-btn-danger min-h-[28px] border-transparent p-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-hairline-subtle pt-3">
                <input
                  type="text"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value)}
                  placeholder="自定义键名 (如 DEEPSEEK_API_KEY)"
                  className="df-input h-[34px] flex-1 px-3 py-1 font-mono text-[13px]"
                />
                <input
                  type="password"
                  value={newSecretVal}
                  onChange={(e) => setNewSecretVal(e.target.value)}
                  placeholder="密钥值"
                  className="df-input h-[34px] flex-1 px-3 py-1 font-mono text-[13px]"
                />
                <button
                  type="button"
                  disabled={!newSecretKey.trim() || !newSecretVal.trim()}
                  onClick={() => {
                    void handleSaveSecret(newSecretKey, newSecretVal).then(() => {
                      setNewSecretKey("");
                      setNewSecretVal("");
                    });
                  }}
                  className="df-btn-secondary"
                >
                  添加
                </button>
              </div>
            </SectionCard>

            <SectionCard title="YAML 配置文件导入 / 导出">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLoadYaml()}
                  className="df-btn-secondary ps-3 pe-3.5"
                >
                  <Download className="h-3.5 w-3.5 text-ink-subtle" />
                  <span>导出当前 YAML</span>
                </button>
                <button
                  type="button"
                  disabled={!yamlText.trim()}
                  onClick={() => void handleImportYaml()}
                  className="df-btn-secondary ps-3 pe-3.5"
                >
                  <Upload className="h-3.5 w-3.5 text-primary-text" />
                  <span>导入并覆盖应用</span>
                </button>
              </div>
              {/* Theme-following YAML Editor per Light-Mode Split Rule */}
              <textarea
                rows={18}
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                placeholder="点击“导出当前 YAML”查看配置源码，或粘贴完整 dragonflow.yaml 后点击“导入并覆盖应用”..."
                className="df-input selectable w-full rounded-[8px] p-3 font-mono text-[13px] leading-[1.6]"
              />
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

function SubTabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium transition duration-150 ${
        active
          ? "border-primary-border bg-primary-soft text-primary-text"
          : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[10px] border border-hairline bg-surface-1 p-4">
      <h3 className="border-b border-hairline pb-2 text-[14.5px] font-semibold text-ink">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12.5px] font-medium text-ink-muted">{label}</label>
      {children}
    </div>
  );
}
