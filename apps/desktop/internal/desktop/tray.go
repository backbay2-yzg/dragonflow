package desktop

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type TrayController struct {
	mu           sync.Mutex
	app          *application.App
	systray      *application.SystemTray
	mainWin      *application.WebviewWindow
	flyoutWin    *application.WebviewWindow
	rt           *Runtime
	currentState string
	autostartMi  *application.MenuItem
	modeMi       *application.MenuItem
	unsub        func()
}

func SetupTray(
	app *application.App,
	rt *Runtime,
	mainWin *application.WebviewWindow,
	flyoutWin *application.WebviewWindow,
	onOpenDataDir func(),
	onQuit func(),
) *TrayController {
	tc := &TrayController{
		app:       app,
		mainWin:   mainWin,
		flyoutWin: flyoutWin,
		rt:        rt,
	}

	st := app.SystemTray.New()
	st.SetIcon(TrayIdleIcon)
	st.SetTooltip("DragonFlow — AI 研发流水线控制台")
	st.AttachWindow(flyoutWin).WindowOffset(8)

	menu := app.NewMenu()
	menu.Add("打开 DragonFlow 主窗口").OnClick(func(_ *application.Context) {
		tc.ShowMain("")
	})
	menu.Add("立即同步 GitHub (Sync Now)").OnClick(func(_ *application.Context) {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			rt.mu.RLock()
			poller := rt.Poller
			rt.mu.RUnlock()
			if poller != nil {
				_, _ = poller.SyncOnce(ctx)
			}
		}()
	})
	tc.modeMi = menu.Add(tc.modeMenuLabel()).OnClick(func(_ *application.Context) {
		go func() {
			cfg := rt.ConfigMgr.Get()
			if cfg.Project.Mode == "demo" {
				cfg.Project.Mode = "live"
			} else {
				cfg.Project.Mode = "demo"
			}
			_, _ = rt.Reload(cfg)
			tc.RefreshStatus()
		}()
	})

	menu.AddSeparator()

	autostartEnabled, _ := app.Autostart.IsEnabled()
	tc.autostartMi = menu.AddCheckbox("开机自动启动 (静默驻留托盘)", autostartEnabled).OnClick(func(ctx *application.Context) {
		checked := ctx.ClickedMenuItem().Checked()
		if checked {
			_ = app.Autostart.EnableWithOptions(application.AutostartOptions{
				Identifier: "DragonFlow",
				Arguments:  []string{"--minimized"},
			})
		} else {
			_ = app.Autostart.Disable()
		}
	})

	menu.Add("打开数据与配置目录").OnClick(func(_ *application.Context) {
		if onOpenDataDir != nil {
			onOpenDataDir()
		}
	})

	menu.AddSeparator()
	menu.Add("退出 DragonFlow").OnClick(func(_ *application.Context) {
		if onQuit != nil {
			onQuit()
		}
	})

	st.SetMenu(menu)
	tc.systray = st

	tc.unsub = rt.EventBus.Subscribe(func(ev domain.AppEvent) {
		switch ev.Type {
		case "task:updated", "task:transitioned", "runtime:reloaded":
			tc.RefreshStatus()
		}
	})

	tc.RefreshStatus()
	return tc
}

func (tc *TrayController) modeMenuLabel() string {
	tc.rt.mu.RLock()
	mode := tc.rt.Mode
	tc.rt.mu.RUnlock()
	if mode == "demo" {
		return "切换到 Live 实战模式"
	}
	return "切换到 Demo 演练模式"
}

func (tc *TrayController) ShowMain(focusTaskID string) {
	if tc.flyoutWin != nil {
		tc.flyoutWin.Hide()
	}
	if tc.mainWin != nil {
		if tc.mainWin.IsMinimised() {
			tc.mainWin.UnMinimise()
		}
		tc.mainWin.Show()
		tc.mainWin.Restore()
		tc.mainWin.Focus()
	}
	if focusTaskID != "" && tc.app != nil {
		tc.app.Event.Emit("app:focus-task", focusTaskID)
	}
}

func (tc *TrayController) SyncAutostartCheckbox(enabled bool) {
	if tc.autostartMi != nil {
		tc.autostartMi.SetChecked(enabled)
	}
}

func (tc *TrayController) RefreshStatus() {
	snap, err := tc.rt.GetTraySnapshot()
	if err != nil {
		return
	}

	nextState := "idle"
	if len(snap.PendingTasks) > 0 {
		for _, t := range snap.PendingTasks {
			if t.Status == domain.StatusAwaitingPlanApproval || t.Status == domain.StatusReadyToMerge || t.Status == domain.StatusNeedsHuman {
				nextState = "attention"
				break
			}
		}
	}
	if nextState == "idle" && snap.ActiveTasks > 0 {
		nextState = "running"
	}

	modeText := "LIVE"
	if snap.Mode == "demo" {
		modeText = "DEMO"
	}
	tooltip := fmt.Sprintf("DragonFlow [%s] · 运行中 %d · 待处理 %d", modeText, snap.ActiveTasks, len(snap.PendingTasks))

	tc.mu.Lock()
	if tc.systray != nil {
		tc.systray.SetTooltip(tooltip)
		if nextState != tc.currentState {
			tc.currentState = nextState
			switch nextState {
			case "attention":
				tc.systray.SetIcon(TrayAttentionIcon)
			case "running":
				tc.systray.SetIcon(TrayRunningIcon)
			default:
				tc.systray.SetIcon(TrayIdleIcon)
			}
		}
		if tc.modeMi != nil {
			tc.modeMi.SetLabel(tc.modeMenuLabel())
		}
	}
	tc.mu.Unlock()
}

func (tc *TrayController) Close() {
	if tc.unsub != nil {
		tc.unsub()
		tc.unsub = nil
	}
}
