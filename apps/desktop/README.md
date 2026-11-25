# DragonFlow Desktop（Windows 原生桌面端）

基于 **Go + Wails v3 + React 19 + Tailwind CSS v4** 构建的 DragonFlow 原生桌面客户端，内嵌完整的 AI 研发流水线编排引擎，无需手动运行终端服务即可管理 GitHub 自动化研发闭环。

> 📘 完整的新手图文使用指南、流水线原理与配置说明，请参阅仓库根目录：[README.md](../../README.md)

## 桌面端专属特性

- **系统托盘常驻与 Acrylic 快捷浮窗**：关闭主窗口自动隐藏到系统托盘；左键托盘图标弹出半透明快捷面板，实时查看运行中任务与待审批/待合并卡点，支持一键批准方案、合并 PR 与触发执行。
- **动态托盘图标与原生通知**：托盘图标随任务状态自动切换（空闲 / 运行中 / 需人工介入），关键卡点弹出 Windows 原生桌面通知并支持点击直达对应任务抽屉。
- **Win11 Mica / Tabbed 无边框窗口**：支持浅色 / 深色 / 跟随系统主题自动切换窗口标题栏外观。
- **6 标签可视化配置编辑器**：支持直接在界面内修改常规与桌面设置、GitHub 仓库、LLM 与三层路由、Agent CLI 池、IM 通知，以及 YAML 导入/导出，保存后即时热重载。
- **Windows DPAPI 凭据保险箱**：通过 `CryptProtectData` 将 `GITHUB_TOKEN`、LLM API Key、IM Webhook 地址加密保存在 `secrets.vault`，不落明文到 YAML。
- **多种启动与存储模式**：
  - 常规模式：数据存储于 `%APPDATA%\DragonFlow`（分别隔离 `dragonflow.db` 与 `demo\dragonflow-demo.db`）。
  - 便携模式：在可执行文件同级目录创建空文件 `portable.flag` 或使用 `--portable` 参数启动，数据保存在同级 `data\` 目录。
  - 静默启动：支持 `--minimized` 启动直接隐藏至系统托盘（配套开机自启选项）。

## 开发与打包命令

环境要求：**Go >= 1.26**、**Node.js >= 22**、**pnpm >= 9**、**Wails v3 CLI**（以及打包安装器所需的 **NSIS**）。

```bash
# 开发热重载模式
wails3 dev

# 编译生产版可执行文件（输出至 apps/desktop/bin/DragonFlow.exe）
wails3 build

# 打包 Windows NSIS 安装包
wails3 task package

# 运行桌面端 Go 后端单元测试
go test ./...
```
