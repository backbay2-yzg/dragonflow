---
version: alpha
name: DragonFlow Design System
description: "Dual-theme (Light / Dark / System) cool-graphite precision engineering design system for DragonFlow's AI SDLC Mission Control, unifying apps/web (React 19 + Tailwind CSS v4) and apps/desktop (Wails v3 Windows desktop + TrayFlyout). Synthesizes Linear's cool-graphite hierarchy and scarce indigo CTA (#5e6ad2 / #4f46e5) with Vercel's crisp neutral light surfaces, CJK-readable engineering density (14px base, 12px CJK floor), 4+1 status convergence across 20 TaskStatus states, and a light-mode technical split keeping live terminal logs dark while Spec/Plan/YAML stay theme-native."

colors:
  # Dark Baseline (Default Engineering Console)
  canvas: "#0b0c0e"
  surface-1: "#111215"
  surface-2: "#17181c"
  surface-3: "#1f2127"
  terminal-bg: "#07080a"
  hairline: "#23252b"
  hairline-strong: "#32353e"
  hairline-subtle: "#1b1d22"
  ink: "#f3f4f6"
  ink-muted: "#b8bcc6"
  ink-subtle: "#8e94a0"
  ink-disabled: "#5c616e"
  primary: "#5e6ad2"
  primary-hover: "#525dc4"
  primary-text: "#9aa5ff"
  primary-soft: "#1e2240"
  on-primary: "#ffffff"
  semantic-running: "#9aa5ff"
  semantic-running-soft: "#1e2240"
  semantic-waiting: "#f2b84b"
  semantic-waiting-soft: "#2f2616"
  semantic-success: "#4ad38f"
  semantic-success-soft: "#132b20"
  semantic-danger: "#f27c85"
  semantic-danger-soft: "#34191d"
  semantic-neutral: "#8e94a0"
  semantic-neutral-soft: "#1f2127"

  # Light Counterpart (First-Class Dual-Theme Parity)
  light-canvas: "#f6f7f9"
  light-surface-1: "#ffffff"
  light-surface-2: "#f0f1f4"
  light-surface-3: "#e7e9ee"
  light-terminal-bg: "#0d0f13"
  light-hairline: "#e2e4e9"
  light-hairline-strong: "#cdd1da"
  light-hairline-subtle: "#eceef2"
  light-ink: "#111318"
  light-ink-muted: "#4a4f5c"
  light-ink-subtle: "#616775"
  light-ink-disabled: "#9aa0ae"
  light-primary: "#4f46e5"
  light-primary-hover: "#4338ca"
  light-primary-text: "#4338ca"
  light-primary-soft: "#eef0ff"
  light-on-primary: "#ffffff"
  light-semantic-running: "#4338ca"
  light-semantic-running-soft: "#eef0ff"
  light-semantic-waiting: "#9a5200"
  light-semantic-waiting-soft: "#fef4e2"
  light-semantic-success: "#117a48"
  light-semantic-success-soft: "#e6f7ee"
  light-semantic-danger: "#c42838"
  light-semantic-danger-soft: "#fdecef"
  light-semantic-neutral: "#525866"
  light-semantic-neutral-soft: "#f0f1f4"

typography:
  kpi:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, Microsoft YaHei UI, monospace"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.4px
  title-page:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.35px
  title-section:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.15px
  title-card:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 14.5px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  body:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  button:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 13.5px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
  caption:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  micro:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0.1px
  mono:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, Microsoft YaHei UI, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px

motion:
  interactive:
    duration: 150ms
    delay: 0ms
    timingFunction: cubic-bezier(.2, .8, .2, 1)
  drawer-enter:
    duration: 200ms
    delay: 0ms
    timingFunction: cubic-bezier(.23, 1, .32, 1)
  popover-enter:
    duration: 180ms
    delay: 0ms
    timingFunction: cubic-bezier(.23, 1, .32, 1)

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 6px 12px
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 6px 12px
  card-default:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
  kanban-column:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.title-card}"
    rounded: "{rounded.lg}"
    padding: 8px
  text-input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
  status-badge:
    backgroundColor: "{colors.semantic-neutral-soft}"
    textColor: "{colors.semantic-neutral}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
  terminal-log:
    backgroundColor: "{colors.terminal-bg}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: 12px
  kbd-keycap:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: 2px 5px
---

## Overview

**DragonFlow（龙流）** 是面向 GitHub 开源仓库的 AI 全自动研发流水线与多 Agent 编排控制台（Mission Control），核心界面涵盖 **6 列 20 状态机任务看板**、**实时日志与产物详情抽屉**、**Agent CLI 健康池**、**多 Tab 系统配置器** 以及 **Windows 桌面托盘快速面板**。

- **视觉基因与对标来源**：融合 `VoltAgent/awesome-design-md` 中 **Linear（`linear.app`）** 的冷灰精密工程骨架与稀缺靛蓝交互强调，以及 **Vercel（`vercel`）** 的干净无色差浅色层级，专为高信息密度的多 Agent 研发调度场景调优。
- **双端统一覆盖范围**：本规范作为唯一视觉真源，同时约束 **`apps/web`**（React 19 + Vite + Tailwind CSS v4 Web 控制台）与 **`apps/desktop`**（Wails v3 桌面主窗口 `MainApp` + `360×460` 托盘浮窗 `TrayFlyout`）。桌面端仅在无边框集成标题栏与托盘壳层保留轻量系统原生行为，两端的颜色 Token、字号阶梯、圆角比例与状态语义保持 100% 同构。
- **双主题同等打磨（Dual-Theme First-Class）**：完整支持 `Light` / `Dark` / `System` 三态切换（通过 `:root[data-theme="light"]`、`:root[data-theme="dark"]` 与 `prefers-color-scheme` 联动，并声明匹配的 `color-scheme` 防止浏览器/WebView 自动反色）。白天审阅 Spec/Plan 与编辑 YAML 清爽透亮，夜间盯守 CLI 日志与流水线沉稳低眩光。
- **实色微阶梯材质策略**：主界面统一采用**实色 4 阶表面阶梯 + `1px` 细边框**分离层次，不依赖大面积毛玻璃或霓虹渐变；仅 Windows 桌面托盘浮窗 `TrayFlyout` 与窗口外框保留轻度系统原生质感。

---

## Colors

### Dual-Theme Surface, Hairline, Ink & Brand Tokens

所有可读正文、说明文字、静音按钮标签（`ink-subtle`）与强调按钮文案均保证满足 **WCAG AA ≥ 4.5:1** 对比度；禁止在卡片或暗色面板上使用低对比度深灰文字。

| Token Key | Dark Value | Light Value | Functional Role & Usage |
| :--- | :--- | :--- | :--- |
| `canvas` / `light-canvas` | `{colors.canvas}` (`#0b0c0e`) | `{colors.light-canvas}` (`#f6f7f9`) | 应用主画布底色、看板列间背景、页面底层 |
| `surface-1` / `light-surface-1` | `{colors.surface-1}` (`#111215`) | `{colors.light-surface-1}` (`#ffffff`) | 顶栏、Overview 概览带、看板列容器、详情抽屉主面板 |
| `surface-2` / `light-surface-2` | `{colors.surface-2}` (`#17181c`) | `{colors.light-surface-2}` (`#f0f1f4`) | 任务卡片、KPI 卡片、Agent 卡片、表单输入框、次级按钮底色 |
| `surface-3` / `light-surface-3` | `{colors.surface-3}` (`#1f2127`) | `{colors.light-surface-3}` (`#e7e9ee`) | 卡片 Hover 抬升态、分段控件选中滑块、代码片段内嵌块、`<kbd>` 键帽 |
| `terminal-bg` / `light-terminal-bg` | `{colors.terminal-bg}` (`#07080a`) | `{colors.light-terminal-bg}` (`#0d0f13`) | **仅限实时 CLI 终端日志区**（`stdout`/`stderr`/`system`），浅色下依然保持控制台对比 |
| `hairline` / `light-hairline` | `{colors.hairline}` (`#23252b`) | `{colors.light-hairline}` (`#e2e4e9`) | 默认容器外框、顶栏/抽屉分割线、卡片 `1px` 边框 |
| `hairline-strong` / `light-hairline-strong` | `{colors.hairline-strong}` (`#32353e`) | `{colors.light-hairline-strong}` (`#cdd1da`) | 输入框边框、Hover 态边框强化、弹窗与浮层边界 |
| `hairline-subtle` / `light-hairline-subtle` | `{colors.hairline-subtle}` (`#1b1d22`) | `{colors.light-hairline-subtle}` (`#eceef2`) | 卡片内部分隔线、日志行间分割、空状态虚线边框 |
| `ink` / `light-ink` | `{colors.ink}` (`#f3f4f6`) | `{colors.light-ink}` (`#111318`) | 一级标题、KPI 数值、任务标题、正文主要文本 |
| `ink-muted` / `light-ink-muted` | `{colors.ink-muted}` (`#b8bcc6`) | `{colors.light-ink-muted}` (`#4a4f5c`) | 次级说明、Tab 未选中标签、Meta 标签与次要数据 |
| `ink-subtle` / `light-ink-subtle` | `{colors.ink-subtle}` (`#8e94a0`) | `{colors.light-ink-subtle}` (`#616775`) | 时间戳、字数/Token 计数、占位提示文本（对比度 ≥ 4.5:1） |
| `ink-disabled` / `light-ink-disabled` | `{colors.ink-disabled}` (`#5c616e`) | `{colors.light-ink-disabled}` (`#9aa0ae`) | 仅用于 `disabled` 禁用态文字与纯装饰性分隔符，禁止承载有效信息 |
| `primary` / `light-primary` | `{colors.primary}` (`#5e6ad2`) | `{colors.light-primary}` (`#4f46e5`) | **唯一主强调色（Linear Indigo）**：Primary CTA、`:focus-visible` 聚焦环、选中卡片边框 |
| `primary-hover` / `light-primary-hover` | `{colors.primary-hover}` (`#525dc4`) | `{colors.light-primary-hover}` (`#4338ca`) | Primary CTA 悬停与按下态 |
| `primary-text` / `light-primary-text` | `{colors.primary-text}` (`#9aa5ff`) | `{colors.light-primary-text}` (`#4338ca`) | 链接文本、`#Issue` 编号高亮、选中导航文字、Active 徽章文字 |
| `primary-soft` / `light-primary-soft` | `{colors.primary-soft}` (`#1e2240`) | `{colors.light-primary-soft}` (`#eef0ff`) | 选中态底色（选中任务卡片、激活 Tab、Running 语义徽章背景） |
| `on-primary` / `light-on-primary` | `{colors.on-primary}` (`#ffffff`) | `{colors.light-on-primary}` (`#ffffff`) | 主色按钮前景色（与 Dark `#5e6ad2` 对比度 ~4.7:1，与 Light `#4f46e5` ~6.3:1） |

### 4+1 Semantic Action Model (20 `TaskStatus` Convergence)

严格收敛现有多达 10 种高饱和色的分散徽章：**所有 20 个 `TaskStatus` 必须映射到以下 4 类动作语义 + 1 类中性语义**，并用 **图形/脉冲点 + 文本标签** 双通道编码（色盲友好）：

| Semantic Bucket | Dark FG / Soft BG | Light FG / Soft BG | Dual-Encoding Indicator | Mapped `TaskStatus` (All 20 States) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Running / In-Flight**<br>*(自动流转与追踪中)* | `{colors.semantic-running}` (`#9aa5ff`)<br>`{colors.semantic-running-soft}` (`#1e2240`) | `{colors.light-semantic-running}` (`#4338ca`)<br>`{colors.light-semantic-running-soft}` (`#eef0ff`) | **执行态**带轻柔脉冲圆点；**追踪态**用实心静止圆点或 Git/PR 图标 | **脉冲执行态 (8)**：`TRIAGING`, `ROUTING`, `PLANNING`, `IMPLEMENTING`, `TESTING`, `CROSS_REVIEW`, `CI_FIXING`, `REVIEW_FIXING`<br>**静止追踪态 (2)**：`PR_OPEN`, `RELEASE_PR_OPEN` |
| **2. Awaiting Human Gate**<br>*(等待人工审批或补充)* | `{colors.semantic-waiting}` (`#f2b84b`)<br>`{colors.semantic-waiting-soft}` (`#2f2616`) | `{colors.light-semantic-waiting}` (`#9a5200`)<br>`{colors.light-semantic-waiting-soft}` (`#fef4e2`) | 琥珀静止圆点 / 沙漏或审批图标（不闪烁，避免制造错误恐慌） | `AWAITING_INFO`, `AWAITING_TRIGGER`, `AWAITING_PLAN_APPROVAL` |
| **3. Ready & Completed**<br>*(合并门禁就绪与完成)* | `{colors.semantic-success}` (`#4ad38f`)<br>`{colors.semantic-success-soft}` (`#132b20`) | `{colors.light-semantic-success}` (`#117a48`)<br>`{colors.light-semantic-success-soft}` (`#e6f7ee`) | `✓` 对勾或 Merge 图标 + 翡翠绿软底徽章 | `READY_TO_MERGE`, `MERGED`, `RELEASED` |
| **4. Escalation & Failure**<br>*(人工兜底告警与失败)* | `{colors.semantic-danger}` (`#f27c85`)<br>`{colors.semantic-danger-soft}` (`#34191d`) | `{colors.light-semantic-danger}` (`#c42838`)<br>`{colors.light-semantic-danger-soft}` (`#fdecef`) | `NEEDS_HUMAN` 配三角警示图标；`FAILED` 配 `×` 图标 | `NEEDS_HUMAN`, `FAILED` |
| **5. Neutral / Idle**<br>*(初始待命或已取消)* | `{colors.semantic-neutral}` (`#8e94a0`)<br>`{colors.semantic-neutral-soft}` (`#1f2127`) | `{colors.light-semantic-neutral}` (`#525866`)<br>`{colors.light-semantic-neutral-soft}` (`#f0f1f4`) | 中性灰实心/空心点，零视觉抢占 | `NEW`, `CANCELLED` |

### Auxiliary Control & Domain Tags

- **Demo vs Live 运行模式切换/状态胶囊**：`demo` 模式使用 **Waiting（琥珀软底）** 标识本地演练隔离；`live` 模式使用 **Success（翡翠绿软底）** 标识真实 GitHub 仓库连接。
- **SSE / Wails 实时连接灯**：已连接用翡翠绿圆点，重连中用琥珀圆点，已断开用玫瑰红圆点 + 明确中文状态字。
- **工作流等级（`WorkflowTier`）**：统一降噪为中性描边标签 + 图标区分（`quick_fix` 用闪电图标配微灰底；`full_sdlc` 用多层图标配 `{colors.primary-soft}` / `{colors.light-primary-soft}` 软底），不再使用高饱和荧光青与洋红。
- **Agent 成本层级（`costTier`）与健康度**：`available` 用实心绿点（**禁止使用 `box-shadow` 外发光光晕**），不可用用玫瑰红 `×` + 简短错误原因；`low`/`medium`/`high` 成本标签依次对应 Success / Waiting / Neutral-Strong 中性描边，不喧宾夺主。

### Light-Mode Technical Surface Split Rule

在 **Light 模式**下，技术内容区按使用心智进行严格分流：
1. **实时终端日志流（`TaskDetailDrawer` → 执行日志 `stdout` / `stderr` / `system`）**：**始终保持深色控制台容器**（Light 下使用 `{colors.light-terminal-bg}` `#0d0f13`，Dark 下使用 `{colors.terminal-bg}` `#07080a`），`stdout` 用 `#e2e6ee`、`stderr` 用 `#f87171`、`system` 用 `#93c5fd`、`timestamp` 用 `#7d8594`，保证实时输出的高对比度与终端直觉。
2. **Spec / Plan / Review / Diff 产物阅读器 与 YAML 配置编辑器**：**跟随当前全局主题**。在 Light 模式下使用 `{colors.light-surface-1}`（`#ffffff`）或 `{colors.light-surface-2}`（`#f0f1f4`）浅色表面配 `{colors.light-ink}`（`#111318`）文字与 `{colors.light-hairline}` 边框，消除大块黑屏对白天阅读长文本与修改配置造成的视觉割裂。

---

## Typography

### Font Family Stacks

- **UI Sans（界面主字体）**：
  `"Inter", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif`
  *(优先加载 Inter；在 Windows 上回落至 Segoe UI Variable Text 与 Microsoft YaHei UI，确保中文小字号下锐利不发虚。)*
- **Monospace（代码、日志、ID 与指标字体，含 Windows CJK 防护）**：
  `"JetBrains Mono", "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", "PingFang SC", ui-monospace, monospace`
  *(必须在 Consolas 之后显式包含 `"Microsoft YaHei UI"` / `"PingFang SC"`，防止日志与终端中的中文字符在 Windows WebView2 下回落为点阵/细宋体 SimSun。)*

### Type Hierarchy

| Token | Size | Weight | Line Height | Tracking | Applied Elements |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `{typography.kpi}` | `24px` | `600` | `1.2` | `-0.4px` | `OverviewBar` 5 项 KPI 主数字（强制 `tabular-nums`） |
| `{typography.title-page}` | `20px` | `600` | `1.25` | `-0.35px` | 空视图与顶层页面大标题 |
| `{typography.title-section}` | `16px` | `600` | `1.35` | `-0.15px` | `TaskDetailDrawer` / 弹窗标题、页面头部标题 |
| `{typography.title-card}` | `14.5px` | `600` | `1.35` | `0` | 看板列头（`14px`）、Agent 与配置分组卡片标题（`14.5px–15px`） |
| `{typography.body}` | `14px` | `400` | `1.55` | `0` | 默认正文、看板任务标题、表单输入、Spec/Plan 正文 |
| `{typography.button}` | `13.5px` | `500` | `1.2` | `0` | 主/次按钮、顶栏主导航 Tab、子导航与下拉选项 |
| `{typography.caption}` | `12.5px` | `400` | `1.45` | `0` | 卡片辅助 Meta、KPI 副标题、表单字段标签与提示说明 |
| `{typography.micro}` | `12px` | `500` | `1.25` | `+0.1px` | 中文可读性底线：状态徽章、Tier 标签、数量角标（`<kbd>` 与纯英文 `[stdout]` 标签可用 `11px–11.5px`） |
| `{typography.mono}` | `13px` | `400` | `1.6` | `0` | 终端日志、YAML 编辑器、代码与 Diff 阅读器、`#Issue` 号、Branch 名 |

### Numeric & Wrapping Rules

- **全量等宽数字（`tabular-nums`）**：所有 KPI 指标、看板列计数、导航角标数字、Token 消耗（`12.4k tok`）、费用（`$0.18`）、耗时（`1m 24s`）、时间戳、`#Issue` 编号、`C1/5–C5/5` 复杂度评分、版本号均必须开启 `font-variant-numeric: tabular-nums`。
- **防撑破与折行纪律**：多行任务标题使用 `text-wrap: balance` / `line-clamp-2`；长路径（`resolvedPath`）、Branch 名、报错信息与 URL 使用 `overflow-wrap: anywhere`，且其 Flex/Grid 父容器必须声明 `min-width: 0`。
- **文本可选性隔离（`user-select` Hygiene）**：顶栏、侧边栏/Tabs、按钮、卡片外框、看板列头与拖拽区设置 `user-select: none`；日志行、错误摘要、Issue ID、Branch 名、Agent CLI 路径、Spec/Plan 内容、审计轨迹与表单输入框必须保留 `user-select: text`。

---

## Layout

### Spacing Scale

遵循严格 `4px` 基准节奏：`{spacing.xxs}` (`4px`) · `{spacing.xs}` (`8px`) · `{spacing.sm}` (`12px`) · `{spacing.md}` (`16px`) · `{spacing.lg}` (`20px`) · `{spacing.xl}` (`24px`)。

### Application Shell & Core Surfaces

1. **顶部单行导航壳层（Top Horizontal Navigation）**：
   - 放弃左侧常驻边栏，将 **100% 水平宽度让渡给 6 列研发看板**。
   - **桌面端（`apps/desktop`）**：沿用 `46px` 高 Wails 无边框集成标题栏（`wails-drag` 拖拽区 + `wails-no-drag` 交互区，Tab 高度 `38px`），左起排列品牌 Logo/名称 + 3 个主 Tab（`任务看板` / `Agent 池` / `系统配置`），右侧集成 `Demo / Live` 分段切换、`System / Light / Dark` 主题循环按钮、实时连接胶囊及 Win11 窗口控制按钮（最小化 / 最大化 / 隐藏至托盘）。
   - **Web 端（`apps/web`）**：使用 `52px` 高 `sticky top-0` 实色顶栏，保持完全一致的左中右信息结构（去除窗口控制按钮，替换为 `SSE 实时连接` 指示灯），容器最大宽度 `max-w-[1800px]`。
2. **概览指标带（`OverviewBar`）**：
   - 仅在 `kanban` 视图显示（或保持紧凑单行）：上方为模式标签 + 仓库名（`owner/repo`）+ 平均耗时与右侧操作区（`Sync Now` 次级按钮 + Demo 模式下唯一的主色 CTA `模拟 Issue`）；下方为 **5 等分 KPI 网格**（`活跃任务`、`累计任务`、`可用 Agent CLI`、`任务成功率`、`Tokens & Cost`），卡片间距 `{spacing.sm}`（`12px`），内边距 `10px 12px`。
3. **6 列全宽看板（`KanbanBoard`）**：
   - 顶部工具栏：左侧关键字搜索框（支持 `/` 快捷键聚焦），右侧 `Tier` 分段过滤器（`全部` / `Quick Fix` / `Full SDLC`）与等宽计数。
   - 6 个固定流程列按研发闭环从左到右排列：`分诊与待触发` → `规划与审批` → `编码与测试` → `Review 与 PR 自愈` → `待合并与发版` → `需人工 / 异常`。
   - 列最小宽度 `220px`（`flex-1 min-w-[220px]`），内边距 `{spacing.xs}`（`8px`），卡片垂直间距 `{spacing.xs}`（`8px`）；在 `1360px` 默认桌面窗口下无横向滚动条一屏全览 6 列，在 `1024px` 最小窗口下启用平滑横向滚动。
4. **右侧滑出详情抽屉（`TaskDetailDrawer`）**：
   - 宽度 `640px–780px`（`max-width: 92vw`），顶部固定头部（`#Issue`、语义状态徽章、`Tier`、标题、仓库/分支/Token 成本、PR 外链与关闭按钮）；中部为 **6 阶段紧凑步进条**（`PIPELINE_STAGES`）+ 主/Review Agent 信息与操作栏；底部为可滚动标签页（`执行日志` / `产物报告` / `状态轨迹 & Runs`）。
5. **Agent 池（`AgentPoolView`）与系统配置（`ConfigEditorView`）**：
   - `AgentPoolView` 采用 `1 / 2 / 3` 列自适应网格（`gap: 12px`），头部保留唯一主 CTA `重新探测本机 CLI`。
   - `ConfigEditorView` 采用左侧或顶部二级子导航（`常规与桌面`、`GitHub 仓库`、`LLM 与路由`、`Agent CLI 池`、`IM 通知`、`DPAPI 保险箱 & YAML`），右上角常驻 `保存并热重载` 主 CTA。
6. **Windows 桌面托盘快速面板（`TrayFlyout`）**：
   - 固定尺寸 `360×460px`（禁用缩放）。结构紧凑垂直三分：48px 极简头部（Logo + Demo/Live + 仓库 + 刷新）→ 3 列紧凑 KPI 条（进行中 / 总任务 / 可用 CLI）→ 可滚动待处理卡点与近期动态列表 → 48px 底部快捷栏（主 CTA `打开主控台` + `演练` + `配置` + `退出`）。

---

## Elevation & Depth

DragonFlow 遵循 **"Surface Stepping Over Drop Shadows"** 原则，消除暗黑模式下的脏影与光晕噪音：

- **静止容器零阴影（Dark & Light 主内容区）**：看板列（`surface-1`）、任务卡片/KPI 卡/表单框（`surface-2`）完全依赖 **表面色阶梯差 + `1px` `{colors.hairline}` / `{colors.light-hairline}` 边框** 建立清晰层级，不添加静止投影。
- **浮动表面复合阴影**：仅在滑出抽屉（`TaskDetailDrawer`）、模态框（`SimulateIssueModal`）、下拉菜单 Popover 与右下角 Toast 上使用复合投影：
  - **Dark 浮层**：`0 0 0 1px {colors.hairline-strong}, 0 16px 40px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .32)`
  - **Light 浮层**：`0 0 0 1px {colors.light-hairline}, 0 12px 32px rgba(17, 19, 24, .12), 0 2px 6px rgba(17, 19, 24, .05)`
- **桌面原生壳层例外与 WebView2 保护**：
  - `TrayFlyout` 在 Windows 11 上保留 Wails 原生 `Acrylic` 轻度透明底衬与外框 `1px` `hairline-strong` 描边，但内部卡片仍需维持足够不透明度（Light ≥ 88%、Dark ≥ 82%）以确保可读性。
  - **禁止全屏 `backdrop-filter: blur(...)` 遮罩**：模态框与抽屉背板（Scrim）仅使用纯色半透明压暗（Dark `rgba(0, 0, 0, .55)` / Light `rgba(17, 19, 24, .32)`），避免 Windows WebView2 GPU 合成掉帧。

---

## Shapes

### Border Radius Scale

保持工程级锐利几何，拒绝大圆角（`16px+`）带来的臃肿感：

- `{rounded.xs}` (`4px`)：微型标签、内联代码角标、`<kbd>` 键帽
- `{rounded.sm}` (`6px`)：主/次按钮、文本输入框、下拉菜单项、导航 Tab、分段控制器内滑块
- `{rounded.md}` (`8px`)：看板任务卡片、KPI 卡片、分段控制器外轨、内嵌代码块与终端日志框
- `{rounded.lg}` (`10px`)：看板列容器、Config 分组面板、Agent 卡片、Toast 卡片、Modal 弹窗
- `{rounded.xl}` (`12px`)：`TrayFlyout` 桌面外框（匹配 Windows 11 弹窗圆角）
- `{rounded.pill}` (`9999px`)：状态徽章（可选 `pill` 或 `xs`/`sm`，全局统一）、圆形脉冲指示点

### Concentric Radii Formula

嵌套容器必须严格满足同心圆角公式：
```text
outerRadius = innerRadius + padding + borderWidth
```
- **分段控制器示例**：`Demo / Live` 切换外轨圆角 `{rounded.md}` (`8px`)、内边距 `2px`、边框 `1px` → 内部选中滑块圆角必须为 `5px–6px`（`{rounded.sm}`），禁止内外同为 `8px`。
- **看板列与卡片示例**：列容器 `{rounded.lg}` (`10px`) + `padding: 8px` 内部承载 `{rounded.md}` (`8px`) 任务卡片时，保持视觉过渡自然不割裂；卡片内部 `padding: 10px` 嵌错日志/报错条用 `{rounded.xs}` (`4px`)。

---

## Components

所有可交互组件必须完整实现 **Default · Hover · Active/Pressed · `:focus-visible` · Disabled · Loading · Empty · Error** 8 态。通用聚焦环统一为 `2px solid {colors.primary}`（Light 为 `{colors.light-primary}`）配合 `1px` 偏移或内嵌 `box-shadow`，绝不全局屏蔽 `outline`。

### 1. Buttons & Scarce Primary CTA
- **Primary CTA (`{component.button-primary}`)**：`{colors.primary}` 底色 + `{colors.on-primary}` 白色文字，`min-height: 34px`（`padding: 6px 13px`，紧凑型按钮 `28px–30px`），圆角 `{rounded.sm}`。**同一页面视图、抽屉操作栏或对话框内最多出现 1 个 Primary CTA**（例如：Overview 区 `模拟 Issue`、配置页 `保存并热重载`、详情抽屉当前阶段唯一主动作 `批准计划` / `合并 PR` / `触发执行`）。
- **Secondary / Ghost Button (`{component.button-secondary}`)**：`{colors.surface-2}` 底色 + `1px {colors.hairline}` 边框 + `{colors.ink}` 文字；Hover 切至 `{colors.surface-3}` 与 `{colors.hairline-strong}`。
- **Danger / Destructive Action**：取消任务、删除 Secret、清空操作默认使用 Neutral Secondary 或玫瑰红描边 Ghost 按钮（`{colors.semantic-danger}` 文字 + `1px` 边框），仅在二次确认框中升级为实心危险按钮。
- **光学内边距**：带前导图标的按钮左侧内边距略微收紧 `2px`（如 `ps-2.5 pe-3`），保持图标与文字视觉重心居中。

### 2. Overview Bar & KPI Cards
- 5 张 KPI 卡统一使用 `{colors.surface-2}` 背景与 **`1px solid {colors.hairline}` 四周等宽细边框**。
- **彻底移除** 现有 `OverviewBar` 的 3px 彩色左边框条（`border-l-*`）。通过左上角小图标 + 清晰文字标题 + `{typography.kpi}` 等宽数字构建简洁高信噪比卡片。

### 3. Kanban Columns & Task Cards (`{component.kanban-column}`, `{component.card-default}`)
- **列容器**：`{colors.surface-1}` 背景 + **`1px solid {colors.hairline}` 统一四周细边框**，**彻底移除** 列顶部的 3px 彩色粗顶条（`border-t-[3px]`）。列头由「中文列标题 + `{typography.micro}` 等宽计数胶囊」构成，允许列头标题前加一个 `6px` 低调中性或阶段微点。
- **任务卡片**：`{colors.surface-2}` 底色 + `1px solid {colors.hairline}`，Hover 升至 `{colors.surface-3}` + `{colors.hairline-strong}`；选中态切换为 `1px solid {colors.primary}` 边框 + `{colors.primary-soft}` 微染底色（Light 为 `{colors.light-primary-soft}`）。
- **卡片信息结构（4 层严格对齐）**：
  1. 顶行：`#Issue` 等宽编号（`{colors.primary-text}`）+ `WorkflowTier` 标签 | 右对齐相对时间（`tabular-nums`）。
  2. 主行：最多 2 行任务标题（`line-clamp-2`，`{typography.body}` weight `500`）。
  3. 状态与调度行：4+1 语义状态徽章（`{component.status-badge}`）+ 分配 Agent 胶囊 +（仅当 `fallbackCount > 0` 时展示）降级次数琥珀徽章。
  4. 底行（`1px {colors.hairline-subtle}` 顶分隔）：`C{score}/5` 与 Token 消耗 | 右对齐 `PR #{num}` 外链或当前阶段简码。
- **异常提示块**：仅当 `lastError` 存在且处于 `FAILED` / `NEEDS_HUMAN` 时展示 `1` 条紧凑内嵌错误框（玫瑰红软底 + `1px` 边框 + 警示图标），禁止使用左侧粗彩条。

### 4. Task Detail Drawer (`TaskDetailDrawer`)
- **6 阶段进度条**：单行 6 格紧凑 Stepper；已完成阶段用翡翠绿软底 + `✓`，当前阶段用 `{colors.primary-soft}` + `1px {colors.primary}`，未到达阶段用 `{colors.surface-2}` + `{colors.ink-subtle}`。
- **执行日志区 (`{component.terminal-log}`)**：内置流过滤器分段条（`all` / `stdout` / `stderr` / `system`）+ `自动滚动` 开关；始终采用深黑控制台底色（Dark `#07080a` / Light `#0d0f13`），行结构为 `[时间 HH:MM:SS] [stream] 消息正文`，强制 `user-select: text` 与 Windows CJK 等宽字体栈。
- **产物报告区（Spec / Plan / Review / Diff）**：**遵循全局明暗主题**，使用 `{colors.surface-1}` / `{colors.light-surface-1}` 底色 + `{colors.hairline}` 边框；左侧产物列表选中态高亮，右侧阅读区支持自由文本选择与一键复制。
- **Agent 选择器（触发 / 重试）**：**禁止使用原生未样式化 `<select>`**，改用符合当前系统表面阶梯的定制 Popover 下拉列表，支持视口边缘碰撞翻转、内部滚动及上下键选择。

### 5. Config Editor, Inputs (`{component.text-input}`), Toast & Keyboard Ergonomics
- **表单控件与自定义下拉**：常规表单与下拉统一 `34px` 高度（高频密集表格行 `30px`，多行文本与 YAML 编辑器除外），`{colors.surface-2}` 底色 + `1px {colors.hairline-strong}` 边框，`:focus-visible` 呈现 `1px {colors.primary}` 边框与 `2px` 柔和聚焦环。YAML 编辑器在 Light 模式下使用 `{colors.light-surface-1}` 浅底深字。
- **Toast 通知**：固定右下角（`right: 16px, bottom: 16px`），最多保留 `3–4` 条，使用 `surface-2` + 浮层阴影 + `1px` 边框 + 左侧 `16px` 语义图标，不使用左粗彩条。
- **轻量键盘交互与 `<kbd>` 键帽 (`{component.kbd-keycap}`)**：
  - 全局约定：`Esc` 关闭抽屉与弹窗；在看板视图按 `/` 聚焦搜索输入框；预留 `Ctrl+K` / `Cmd+K` 全局命令面板快捷键入口（触发快速跳转任务 `#Issue`、切换 Tab、切换 Demo/Live 或主题）。
  - 快捷键提示统一渲染为物理键帽样式：`{colors.surface-3}` 底色、`1px {colors.hairline-strong}` 边框、`box-shadow: inset 0 -1px 0 {colors.hairline-strong}`、`{rounded.xs}` 圆角与 `tabular-nums`。

---

## Motion

- **微交互过渡 (`{motion.interactive}`)**：`150ms cubic-bezier(.2, .8, .2, 1)`，用于按钮、卡片背景与边框、Tab 切换、Hover 态反馈。
- **抽屉滑入 (`{motion.drawer-enter}`)**：`200ms cubic-bezier(.23, 1, .32, 1)`，右进右出位移动画（仅使用 `transform` 与 `opacity`，避免布局重排）。
- **弹窗与气泡 (`{motion.popover-enter}`)**：`180ms cubic-bezier(.23, 1, .32, 1)`，用于 Modal、下拉菜单与 Toast 入场。
- **状态脉冲克制规则**：仅 **Running（执行中 8 个状态）** 与 **Live 实时连接灯** 允许轻柔的透明度呼吸脉冲（`2s ease-in-out infinite`），禁止大面积卡片缩放（如 `scale(1.05)`）或边框跑马灯。
- **减弱动态效果强制兜底（Reduced Motion）**：
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
  ```

---

## Do's and Don'ts

### Do
- **严格执行 4+1 状态收敛与双通道编码**：所有状态徽章必须同时包含文本标签与状态点/图标，保证红绿色盲用户与极窄列下均能秒懂。
- **贯彻 Light 模式技术区分离**：仅实时终端日志保留 `#0d0f13` 暗底；Spec/Plan/Diff 产物与 YAML 源码编辑器随主题变亮。
- **所有指标与日志执行严格字体约束**：数字、金额、Token、时间强制 `tabular-nums`；Windows 下等宽字体栈必须包含 `"Microsoft YaHei UI"` 防 SimSun 回退；日志与错误信息强制 `user-select: text`。
- **保持同心圆角与 1px 细边框体系**：所有嵌套容器遵循 `outerRadius = innerRadius + padding + borderWidth`。

### Don't
- **禁止使用彩色粗边框条**：**不要** 再在 `OverviewBar` KPI 卡使用 `border-l-[3px]` 彩色左边框，也 **不要** 在 `KanbanBoard` 6 列使用 `border-t-[3px]` 彩色粗顶条（迁移改造时优先清理）。
- **禁止状态色泛滥与点状光晕**：不要恢复 10 色高饱和状态徽章（如荧光青、洋红、亮紫混用），也不要在健康绿点上加 `shadow-[0_0_8px_...]` 霓虹光晕。
- **禁止 AI 套模板装饰主义（Anti-Slop）**：严禁未要求的多色霓虹渐变背景、发光卡片边框、暗黑底下的大面积毛玻璃卡片以及卡片悬停放大。
- **禁止桌面控制台使用原生 `<select>` 与全屏模糊**：不要在 `TaskDetailDrawer` 或 `ConfigEditorView` 使用浏览器默认 `<select>`；不要在 Windows WebView2 使用全屏 `backdrop-filter: blur()` 遮罩。
- **禁止低对比度文字与不可选报错**：不要在暗黑卡片（`#17181c`）上使用 `< 4.5:1` 的暗灰文字（如 `#555`），也不要让报错信息和日志继承根节点的 `user-select: none`。

---

## Responsive Behavior

| Viewport / Surface | Width Range | Layout & Collapsing Strategy |
| :--- | :--- | :--- |
| **Tray Flyout (`TrayFlyout`)** | `360px × 460px` (Fixed) | 单列垂直三段式：头部 48px + 3 列紧凑 KPI + 单列可滚动卡点/动态列表 + 48px 底栏；文本单行 `truncate`，快捷按钮固定右侧不折行 |
| **Compact Desktop (`min-width`)** | `1024px – 1279px` | 顶栏次要装饰文字（如副标题、Theme 文字标签）折叠仅留图标；`OverviewBar` KPI 为 5 列紧凑或 3+2 折行；6 列看板保留 `220px` 列宽并启用平滑横向滚动 |
| **Standard Desktop (Default)** | `1280px – 1439px` (目标 `1360px`) | 6 列看板一屏完整铺开无需横向滚动；`TaskDetailDrawer` 覆盖宽度 `720px`；Config 子 Tab 单行完整展示 |
| **Wide Web Console** | `1440px – 1800px` | 容器居中封顶 `1800px`，多余宽度均匀分配给 6 列看板列宽，单列内保持卡片最大可读行宽；`TaskDetailDrawer` 上限 `780px` |

- **滚动条稳定性（Zero-Shift）**：桌面端与 Web 端滚动区统一采用 `6px` 细滚动条与稳定内边距，防止展开日志或折叠面板时引发水平抖动。
- **触摸与指针兼容**：Web 端如遇到 `@media (pointer: coarse)` 触控设备，紧凑型 `28px–32px` 按钮需通过透明 `::after` 伪元素将可点击热区扩展至 `≥ 44×44px`。

---

## Agent Prompt Guide

### Quick Token Cheat Sheet (CSS Custom Properties Starter)

后续迁移 `apps/web/src/index.css` 与 `apps/desktop/frontend/src/styles/fluent2.css` 时，可将以下标准 CSS 变量直接作为唯一真源接入 Tailwind CSS v4 `@theme inline`：

```css
:root {
  color-scheme: light dark;
  --df-canvas: #f6f7f9;
  --df-surface-1: #ffffff;
  --df-surface-2: #f0f1f4;
  --df-surface-3: #e7e9ee;
  --df-terminal-bg: #0d0f13;
  --df-hairline: #e2e4e9;
  --df-hairline-strong: #cdd1da;
  --df-hairline-subtle: #eceef2;
  --df-ink: #111318;
  --df-ink-muted: #4a4f5c;
  --df-ink-subtle: #616775;
  --df-primary: #4f46e5;
  --df-primary-hover: #4338ca;
  --df-primary-text: #4338ca;
  --df-primary-soft: #eef0ff;
  --df-on-primary: #ffffff;
  --df-running: #4338ca;      --df-running-soft: #eef0ff;
  --df-waiting: #9a5200;      --df-waiting-soft: #fef4e2;
  --df-success: #117a48;      --df-success-soft: #e6f7ee;
  --df-danger: #c42838;       --df-danger-soft: #fdecef;
  --df-neutral: #525866;      --df-neutral-soft: #f0f1f4;
  --df-font-sans: "Inter", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --df-font-mono: "JetBrains Mono", "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", "PingFang SC", ui-monospace, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --df-canvas: #0b0c0e;
  --df-surface-1: #111215;
  --df-surface-2: #17181c;
  --df-surface-3: #1f2127;
  --df-terminal-bg: #07080a;
  --df-hairline: #23252b;
  --df-hairline-strong: #32353e;
  --df-hairline-subtle: #1b1d22;
  --df-ink: #f3f4f6;
  --df-ink-muted: #b8bcc6;
  --df-ink-subtle: #8e94a0;
  --df-primary: #5e6ad2;
  --df-primary-hover: #525dc4;
  --df-primary-text: #9aa5ff;
  --df-primary-soft: #1e2240;
  --df-on-primary: #ffffff;
  --df-running: #9aa5ff;      --df-running-soft: #1e2240;
  --df-waiting: #f2b84b;      --df-waiting-soft: #2f2616;
  --df-success: #4ad38f;      --df-success-soft: #132b20;
  --df-danger: #f27c85;       --df-danger-soft: #34191d;
  --df-neutral: #8e94a0;      --df-neutral-soft: #1f2127;
}
```

### Ready-to-Use Agent Prompts

- **新建/改造 UI 组件时**：
  > 请严格遵循根目录 `DESIGN.md`：使用 Cool-Graphite 实色阶梯（`canvas` / `surface-1` / `surface-2` / `surface-3`）+ `1px` `hairline` 边框，同时兼容 `Light` 与 `Dark` 主题；所有 20 个 `TaskStatus` 严格按 4+1 语义收敛；禁止使用彩色粗左/顶边框、禁止原生 `<select>`；KPI/Issue 号/耗时开启 `tabular-nums`，并确保 `stdout/stderr` 日志保持深色且 `user-select: text`，而 Spec/Plan/YAML 随全局主题切换。
- **执行存量代码视觉迁移审计时**：
  > 对照 `DESIGN.md` 检查 `apps/web` 与 `apps/desktop/frontend`：重点清理 `OverviewBar` 的 `border-l-*` 彩条、`KanbanBoard` 的 `border-t-[3px]` 粗顶条、`TaskDetailDrawer` 中产物视图强制黑底与原生 `<select>`、`AgentPoolView` 绿点外发光、以及双端不统一的 Token 命名，统一收口至 `--df-*` 语义变量。
