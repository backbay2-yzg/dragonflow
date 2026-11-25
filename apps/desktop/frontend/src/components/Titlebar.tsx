import { useState } from "react";
import { Copy, Cpu, Kanban, Minus, Monitor, Moon, Settings2, Square, Sun, X } from "lucide-react";
import type { ThemePreference } from "../hooks/useTheme";

export type NavTab = "kanban" | "agents" | "config";

interface TitlebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  tasksCount: number;
  availableAgentsCount: number;
  mode: string;
  switchingMode: boolean;
  onSwitchMode: (mode: "demo" | "live") => void;
  themePreference: ThemePreference;
  onCycleTheme: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => Promise<boolean>;
  onHideToTray: () => void;
}

export function Titlebar({
  activeTab,
  onSelectTab,
  tasksCount,
  availableAgentsCount,
  mode,
  switchingMode,
  onSwitchMode,
  themePreference,
  onCycleTheme,
  onMinimize,
  onToggleMaximize,
  onHideToTray,
}: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  const handleToggleMax = async () => {
    const next = await onToggleMaximize();
    setMaximized(next);
  };

  const ThemeIcon =
    themePreference === "light" ? Sun : themePreference === "dark" ? Moon : Monitor;
  const themeLabel =
    themePreference === "light" ? "浅色" : themePreference === "dark" ? "深色" : "跟随系统";

  const isDemo = mode === "demo";

  return (
    <header
      onDoubleClick={() => void handleToggleMax()}
      className="wails-drag flex h-[46px] shrink-0 items-center justify-between border-b border-hairline bg-surface-1 pl-3 select-none"
    >
      {/* Left: Brand + Integrated Tabs */}
      <div className="flex h-full items-center gap-4">
        <div className="flex items-center gap-2 pr-1">
          <img src="/dragonflow.png" alt="DragonFlow" className="h-5 w-5 rounded-[4px]" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            DragonFlow
          </span>
        </div>

        <nav aria-label="主视图切换" className="wails-no-drag flex h-full items-end gap-1 pt-2">
          <TabItem
            active={activeTab === "kanban"}
            onClick={() => onSelectTab("kanban")}
            icon={<Kanban className="h-4 w-4" />}
            label="任务看板"
            badge={tasksCount}
          />
          <TabItem
            active={activeTab === "agents"}
            onClick={() => onSelectTab("agents")}
            icon={<Cpu className="h-4 w-4" />}
            label="Agent 池"
            badge={availableAgentsCount}
          />
          <TabItem
            active={activeTab === "config"}
            onClick={() => onSelectTab("config")}
            icon={<Settings2 className="h-4 w-4" />}
            label="系统配置"
          />
        </nav>
      </div>

      {/* Right: Concentric Mode Toggle, Theme Toggle, Live Pill, Win11 Window Captions */}
      <div className="wails-no-drag flex h-full items-center gap-1.5">
        <div className="mr-1 hidden items-center gap-0.5 rounded-[8px] border border-hairline bg-canvas p-[2px] sm:flex">
          <button
            type="button"
            disabled={switchingMode}
            onClick={() => onSwitchMode("demo")}
            className={`rounded-[6px] border px-2.5 py-0.5 text-[12px] font-medium transition duration-150 ${
              isDemo
                ? "df-badge-waiting"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            Demo
          </button>
          <button
            type="button"
            disabled={switchingMode}
            onClick={() => onSwitchMode("live")}
            className={`rounded-[6px] border px-2.5 py-0.5 text-[12px] font-medium transition duration-150 ${
              !isDemo
                ? "df-badge-success"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            Live
          </button>
        </div>

        <button
          type="button"
          onClick={onCycleTheme}
          title={`主题模式: ${themeLabel}（点击切换）`}
          className="df-btn-secondary min-h-[30px] px-2.5 py-1 text-[12px] text-ink-muted"
        >
          <ThemeIcon className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{themeLabel}</span>
        </button>

        <div
          title="Wails 原生事件通道已就绪"
          className="df-badge-success mr-1 hidden h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium lg:inline-flex"
        >
          <span className="df-pulse-dot h-1.5 w-1.5 rounded-full bg-current" />
          <span>实时</span>
        </div>

        {/* Native Win11 Caption Buttons */}
        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={onMinimize}
            title="最小化"
            aria-label="最小化"
            className="inline-flex w-[46px] items-center justify-center text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleToggleMax()}
            title={maximized ? "还原" : "最大化"}
            aria-label={maximized ? "还原" : "最大化"}
            className="inline-flex w-[46px] items-center justify-center text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          >
            {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={onHideToTray}
            title="隐藏到系统托盘（后台继续运行）"
            aria-label="隐藏到系统托盘"
            className="inline-flex w-[46px] items-center justify-center text-ink-muted transition hover:bg-[#c42b1c] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function TabItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-[38px] items-center gap-1.5 rounded-t-[6px] px-3.5 text-[13.5px] font-medium transition duration-150 ${
        active
          ? "border-x border-t border-hairline bg-canvas text-ink"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <span className={active ? "text-primary-text" : "text-ink-subtle"}>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.2 font-mono text-[12px] tabular-nums ${
            active ? "bg-primary-soft text-primary-text" : "bg-surface-2 text-ink-subtle"
          }`}
        >
          {badge}
        </span>
      )}
      {active && (
        <span className="absolute right-2.5 bottom-0 left-2.5 h-[2px] rounded-full bg-primary" />
      )}
    </button>
  );
}
