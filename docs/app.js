(function () {
  const THEME_KEY = 'dragonflow:docs-theme';

  const PIPELINE_STAGES = [
    {
      num: 'Stage 1',
      title: 'Issue 分诊与门禁',
      statuses: ['NEW', 'TRIAGING', 'AWAITING_INFO', 'AWAITING_TRIGGER'],
      summary:
        '收到 GitHub Issue 后自动判断分类（bug/feature/docs 等）、重复率与 1~5 复杂度评分。若信息缺失自动留言追问；若提交者非仓库维护者且没有 auto-dev 标签，则安全停在 AWAITING_TRIGGER 等待人工放行。',
      gate: '安全门禁：非维护者 Issue 需维护者评论 /auto 或添加 auto-dev 标签才启动执行；支持 ownerFastTrack: true 维护者直通。',
      tier: '只读 AI 分析，零代码写入',
    },
    {
      num: 'Stage 2',
      title: '三层路由与方案规划',
      statuses: ['ROUTING', 'PLANNING', 'AWAITING_PLAN_APPROVAL'],
      summary:
        '按“静态规则 -> LLM 能力评估 -> 默认兜底”三层策略选出主执行 Agent 与异构 Reviewer。高复杂度任务（full_sdlc）会先生成 Spec 需求规格与 Plan 技术方案，并等待维护者审批通过。',
      gate: '人工审批门禁：requirePlanApprovalForFullSdlc=true 时暂停在 AWAITING_PLAN_APPROVAL，支持 /approve 放行或 /reject <建议> 重规划。',
      tier: 'quick_fix 跳过审批；full_sdlc 强制审批',
    },
    {
      num: 'Stage 3',
      title: 'Worktree 隔离编码与自测',
      statuses: ['IMPLEMENTING', 'TESTING'],
      summary:
        '在独立 Git Worktree 目录与专用分支（如 dragonflow/issue-103）中编码实现，避免污染主仓库工作区。完成后自动运行 lint / test / build 验证；失败时按 maxLocalFixRetries 自动读取报错自愈，遇到配额耗尽自动按 fallbackOrder 切换备用 CLI。',
      gate: '配额/故障自动降级：支持 quota_exceeded、rate_limited、auth_failed、timeout 等错误自动切换下一个可用 Agent。',
      tier: '独立工作树隔离，支持 Windows 与预留 Docker 沙箱',
    },
    {
      num: 'Stage 4',
      title: '异构审查与 PR 自愈',
      statuses: ['CROSS_REVIEW', 'PR_OPEN', 'CI_FIXING', 'REVIEW_FIXING'],
      summary:
        '编码通过本地测试后，由与主实现不同的异构 Agent 执行 Cross-Review 交叉审查；随后自动创建 PR 并持续监听 GitHub Actions CI 状态与 Reviewer 评论。若远程 CI 变红或收到修改意见，自动拉取日志并在原分支修复推送。',
      gate: '重试封顶兜底：本地修复、Cross-Review、CI 修复、Review 修复均设重试上限，超限自动转入 NEEDS_HUMAN 并推送 IM 告警。',
      tier: '跨模型交叉把关 + 自动 CI/Review 修复闭环',
    },
    {
      num: 'Stage 5',
      title: '合并门禁',
      statuses: ['READY_TO_MERGE', 'MERGED'],
      summary:
        '当远程 CI 全绿且审查通过后进入 READY_TO_MERGE。默认保守停在此门禁等待维护者核对，也可配置仅对 docs/chore 等低风险、低复杂度、少改动文件开启 autoMergeLowRisk 自动合并。',
      gate: '合并确认：在 GitHub 评论 /merge 或在控制台点击“合并 PR”即可触发合并进入 MERGED。',
      tier: '支持 squash / merge / rebase 合并方式',
    },
    {
      num: 'Stage 6',
      title: '自动发版与异常终态',
      statuses: ['RELEASE_PR_OPEN', 'RELEASED', 'NEEDS_HUMAN', 'FAILED', 'CANCELLED'],
      summary:
        'PR 合并后支持两种自动发版流：配合 release-please 追踪 Release PR 直至合并发布（release_pr），或在合并后立即计算 SemVer Tag 发布 Release（immediate_per_pr）。人工排除异常后可随时 /retry 恢复或 /cancel 中止。',
      gate: '全程审计可追溯：每次状态流转、子运行耗时、Tokens/费用、产物 Markdown 与终端日志均持久化到 SQLite WAL 数据库。',
      tier: '完整 Changelog + Tag + GitHub Release 闭环',
    },
  ];

  const GALLERY_ITEMS = [
    {
      id: 'kanban-dark',
      tab: '1. 任务看板（深色）',
      badge: 'Mission Control 主视图',
      title: '6 列实时状态看板 + 5 项全局 KPI',
      src: './screenshots/01-kanban-overview-dark.png',
      desc: '通过 SSE 实时接收任务状态推送，从左到右清晰呈现分诊、规划审批、编码测试、Review/PR 自愈、待合并发版与异常介入全貌。',
      bullets: [
        '顶部 KPI 栏直观展示活跃任务、累计任务、本机可用 Agent CLI 数、成功率与 Token/费用估算',
        '支持键盘 / 快捷键快速过滤 #Issue 编号、标题、Agent 名称或状态',
        '卡片展示复杂度评分（如 C4/5）、降级切换次数徽标（×1）与可点击的 PR 链接',
      ],
    },
    {
      id: 'kanban-light',
      tab: '2. 浅色双主题',
      badge: 'Light / Dark / System',
      title: '高可读浅色模式 + 一键三态主题切换',
      src: './screenshots/02-kanban-overview-light.png',
      desc: '遵循冷灰中性底色与统一靛蓝主按钮规范，支持浅色、深色与跟随系统自动切换，且无论何种主题均保持终端日志区域的高对比度可读性。',
      bullets: [
        '顶部工具栏一键循环切换：跟随系统 -> 浅色 -> 深色',
        '状态胶囊收敛为运行中 / 等待审批 / 成功 / 需人工 / 中性 5 类语义色',
        'Web 控制台与 Windows 原生桌面端共享统一设计规范（DESIGN.md）',
      ],
    },
    {
      id: 'simulate-modal',
      tab: '3. 模拟 Issue 演练',
      badge: '零密钥体验入口',
      title: '4 种典型研发场景预设，一键填入即跑',
      src: './screenshots/03-simulate-issue-modal.png',
      desc: '在 Demo 演练模式下无需真实 GitHub 仓库或付费 API Key，点击“模拟 Issue”即可直接测试完整研发流、配额降级和 CI 自愈。',
      bullets: [
        'Quick Fix：低复杂度缺陷修复，跳过人工审批直达 PR',
        'Full SDLC：复杂功能需求，生成 Spec 与 Plan 并暂停在人工审批卡点',
        'Quota Fallback / CI + Review Self-Heal：直接复现自动降级与 CI 自动修复闭环',
      ],
    },
    {
      id: 'plan-gate',
      tab: '4. 方案审批门禁',
      badge: 'Full SDLC 人工把关',
      title: '先看 Spec 与 Plan 方案，点批准再写代码',
      src: './screenshots/04-task-detail-plan-approval.png',
      desc: '复杂任务不会让 AI 贸然改代码，而是先暂停在“待审批计划”，让你先审阅需求规格与技术方案，满意再批准，不满意可附建议打回重规划。',
      bullets: [
        '顶部 6 阶段进度条标明当前所处环节与阻塞状态',
        '智能路由卡片清晰解释主 Agent / Reviewer 选择依据与静态规则命中原因',
        '阶段产物面板保留分诊报告、Spec、Plan、测试报告、交叉 Review、Diff 与 PR 描述',
      ],
    },
    {
      id: 'logs-fallback',
      tab: '5. 实时日志与降级',
      badge: '终端可观测性',
      title: '自动降级切换记录 + 实时命令终端流',
      src: './screenshots/05-task-detail-logs.png',
      desc: '当主 Agent 触发 quota_exceeded 时系统会自动切换至备用 CLI 并在顶部高亮提示；下方终端实时回放每条系统命令与测试输出。',
      bullets: [
        '支持按 all / stdout / stderr / system 快速筛选日志流',
        '支持自动滚屏跟踪最新日志，定位失败原因不用再翻服务器黑框',
        '清晰记录每次降级的原 Agent、目标 Agent、阶段与错误分类',
      ],
    },
    {
      id: 'audit',
      tab: '6. 执行与审计',
      badge: '全链路追溯',
      title: '子阶段 Run 明细与状态机审计时间线',
      src: './screenshots/06-task-detail-audit.png',
      desc: '每一次 LLM 调用和编码 CLI 执行都会被记录下来，包括耗时、Token 消耗、费用估算与状态机流转历史。',
      bullets: [
        '清楚看到每次重试或切换 Agent 发生在哪一环（如 implementing #1 failed -> #2 succeeded）',
        '完整保留状态变更操作者（orchestrator / dashboard / maintainer）与变更原因',
        '所有记录持久化保存在本地 SQLite WAL 数据库中，重启不丢失',
      ],
    },
    {
      id: 'agent-pool',
      tab: '7. 多 Agent 调度池',
      badge: '8+1 CLI 引擎',
      title: '自动探测本机已安装编码 CLI 与健康状态',
      src: './screenshots/07-agent-pool.png',
      desc: 'DragonFlow 自动扫描本机 PATH（在 Windows 上兼容 .exe / .cmd / .ps1），实时识别每个 CLI 的可执行路径、版本号与能力标签。',
      bullets: [
        '内置支持 Claude Code、Codex、Gemini CLI、QoderCLI、OpenCode、Aider、WorkBuddy、CodeBuddy',
        '支持 YAML 自定义 template 类型零代码接入第 9 种任意自研 CLI',
        '新装完 CLI 后点击右上角“重新探测本机 CLI”即可立即热刷新状态',
      ],
    },
    {
      id: 'config',
      tab: '8. 脱敏配置总览',
      badge: '安全透明',
      title: '密钥严格脱敏 + 一键复制 CI 工作流',
      src: './screenshots/08-config-overview.png',
      desc: 'Web 控制台永远不会向浏览器回传明文 Token 或 API Key，仅显示环境变量名称和配置就绪状态，兼顾排查便利与凭据安全。',
      bullets: [
        '集中展示 GitHub 仓库、双通道 LLM、路由规则、重试上限与通知渠道状态',
        '内置 GitHub Actions CI 工作流片段，新手可直接复制放进目标仓库',
        'Windows 桌面端更提供 6 标签可视化编辑器与 DPAPI 加密保险箱',
      ],
    },
  ];

  // 1. Theme Switcher
  const themeBtn = document.getElementById('theme-toggle');
  const heroImg = document.getElementById('hero-preview-img');
  const heroBadge = document.getElementById('hero-theme-label');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
    if (themeBtn) {
      themeBtn.textContent = theme === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式';
    }
    if (heroImg) {
      heroImg.src =
        theme === 'light'
          ? './screenshots/02-kanban-overview-light.png'
          : './screenshots/01-kanban-overview-dark.png';
      heroImg.alt =
        theme === 'light'
          ? 'DragonFlow 控制台浅色模式任务看板截图'
          : 'DragonFlow 控制台深色模式任务看板截图';
    }
    if (heroBadge) {
      heroBadge.textContent = theme === 'light' ? 'Light Theme Preview' : 'Dark Theme Preview';
    }
  }

  let initialTheme = 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      initialTheme = saved;
    }
  } catch (_) {}
  applyTheme(initialTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // 2. Interactive 6-Stage Pipeline Explorer
  const stageBtns = document.querySelectorAll('.stage-btn');
  const stageTitleEl = document.getElementById('stage-detail-title');
  const stageStatusesEl = document.getElementById('stage-detail-statuses');
  const stageSummaryEl = document.getElementById('stage-detail-summary');
  const stageGateEl = document.getElementById('stage-detail-gate');
  const stageTierEl = document.getElementById('stage-detail-tier');

  function renderPipelineStage(index) {
    const stage = PIPELINE_STAGES[index];
    if (!stage) return;
    stageBtns.forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
      btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    if (stageTitleEl) stageTitleEl.textContent = stage.num + ' · ' + stage.title;
    if (stageSummaryEl) stageSummaryEl.textContent = stage.summary;
    if (stageGateEl) stageGateEl.textContent = stage.gate;
    if (stageTierEl) stageTierEl.textContent = stage.tier;
    if (stageStatusesEl) {
      stageStatusesEl.innerHTML = '';
      stage.statuses.forEach((st) => {
        const span = document.createElement('span');
        span.className = 'status-chip mono';
        span.textContent = st;
        stageStatusesEl.appendChild(span);
      });
    }
  }

  stageBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => renderPipelineStage(idx));
  });
  renderPipelineStage(0);

  // 3. Interactive Screenshot Gallery & Lightbox
  const galleryTabsEl = document.getElementById('gallery-tabs');
  const galleryImgEl = document.getElementById('gallery-img');
  const galleryBadgeEl = document.getElementById('gallery-badge');
  const galleryTitleEl = document.getElementById('gallery-title');
  const galleryDescEl = document.getElementById('gallery-desc');
  const galleryBulletsEl = document.getElementById('gallery-bullets');
  const zoomBtnEl = document.getElementById('gallery-zoom-btn');

  const lightboxEl = document.getElementById('lightbox');
  const lightboxImgEl = document.getElementById('lightbox-img');
  const lightboxTitleEl = document.getElementById('lightbox-title');
  const lightboxCloseEl = document.getElementById('lightbox-close');
  const lightboxPrevEl = document.getElementById('lightbox-prev');
  const lightboxNextEl = document.getElementById('lightbox-next');

  let activeGalleryIndex = 0;

  function renderGallery(index) {
    activeGalleryIndex = index;
    const item = GALLERY_ITEMS[index];
    if (!item) return;

    if (galleryTabsEl) {
      Array.from(galleryTabsEl.children).forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
      });
    }
    if (galleryImgEl) {
      galleryImgEl.src = item.src;
      galleryImgEl.alt = item.title;
    }
    if (galleryBadgeEl) galleryBadgeEl.textContent = item.badge;
    if (galleryTitleEl) galleryTitleEl.textContent = item.title;
    if (galleryDescEl) galleryDescEl.textContent = item.desc;
    if (galleryBulletsEl) {
      galleryBulletsEl.innerHTML = '';
      item.bullets.forEach((b) => {
        const li = document.createElement('li');
        li.textContent = b;
        galleryBulletsEl.appendChild(li);
      });
    }
  }

  if (galleryTabsEl) {
    GALLERY_ITEMS.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-tab' + (idx === 0 ? ' active' : '');
      btn.textContent = item.tab;
      btn.addEventListener('click', () => renderGallery(idx));
      galleryTabsEl.appendChild(btn);
    });
  }
  renderGallery(0);

  function openLightbox(index) {
    const item = GALLERY_ITEMS[index] || GALLERY_ITEMS[0];
    activeGalleryIndex = GALLERY_ITEMS.indexOf(item);
    if (lightboxImgEl) {
      lightboxImgEl.src = item.src;
      lightboxImgEl.alt = item.title;
    }
    if (lightboxTitleEl) {
      lightboxTitleEl.textContent = item.tab + ' — ' + item.title;
    }
    if (lightboxEl) {
      lightboxEl.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeLightbox() {
    if (lightboxEl) {
      lightboxEl.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  if (galleryImgEl) galleryImgEl.addEventListener('click', () => openLightbox(activeGalleryIndex));
  if (zoomBtnEl) zoomBtnEl.addEventListener('click', () => openLightbox(activeGalleryIndex));
  if (heroImg) {
    heroImg.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      openLightbox(isLight ? 1 : 0);
    });
  }
  if (lightboxCloseEl) lightboxCloseEl.addEventListener('click', closeLightbox);
  if (lightboxPrevEl) {
    lightboxPrevEl.addEventListener('click', () => {
      const nextIdx = (activeGalleryIndex - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length;
      renderGallery(nextIdx);
      openLightbox(nextIdx);
    });
  }
  if (lightboxNextEl) {
    lightboxNextEl.addEventListener('click', () => {
      const nextIdx = (activeGalleryIndex + 1) % GALLERY_ITEMS.length;
      renderGallery(nextIdx);
      openLightbox(nextIdx);
    });
  }
  if (lightboxEl) {
    lightboxEl.addEventListener('click', (e) => {
      if (e.target === lightboxEl) closeLightbox();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (!lightboxEl || !lightboxEl.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && lightboxPrevEl) lightboxPrevEl.click();
    if (e.key === 'ArrowRight' && lightboxNextEl) lightboxNextEl.click();
  });

  // 4. One-Click Code Copy
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const block = btn.closest('.code-block');
      const code = block ? block.querySelector('pre code')?.textContent || '' : '';
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.trimEnd());
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = code.trimEnd();
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const prev = btn.textContent;
      btn.textContent = '已复制 ✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove('copied');
      }, 1800);
    });
  });

  // 5. FAQ Accordion
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      if (!item) return;
      const isOpen = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });
})();
