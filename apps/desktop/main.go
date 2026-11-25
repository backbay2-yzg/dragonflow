package main

import (
	"embed"
	"log"
	"os"
	"slices"
	"sync/atomic"

	"github.com/dragonflow/desktop/internal/desktop"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/paths"
	"github.com/dragonflow/desktop/services"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[domain.AppEvent]("dragonflow:event")
	application.RegisterEvent[string]("app:focus-task")
	application.RegisterEvent[string]("app:navigate")
	application.RegisterEvent[string]("app:theme-changed")
}

func main() {
	startMinimized := slices.Contains(os.Args[1:], "--minimized")

	appPaths, err := paths.ResolveAppPaths(os.Args[1:])
	if err != nil {
		log.Fatalf("Failed to resolve DragonFlow paths: %v", err)
	}

	notifSvc := notifications.New()

	var (
		app      *application.App
		trayCtrl *desktop.TrayController
		mainWin  *application.WebviewWindow
		quitting atomic.Bool
	)

	rt, err := desktop.NewRuntime(appPaths, notifSvc, func(taskID string) {
		if trayCtrl != nil {
			trayCtrl.ShowMain(taskID)
		} else if mainWin != nil {
			mainWin.Show()
			mainWin.Restore()
			mainWin.Focus()
			if app != nil && taskID != "" {
				app.Event.Emit("app:focus-task", taskID)
			}
		}
	})
	if err != nil {
		log.Fatalf("Failed to initialize DragonFlow runtime: %v", err)
	}

	dashSvc := services.NewDashboardService(rt)
	agentSvc := services.NewAgentService(rt)
	configSvc := services.NewConfigService(rt)
	handles := &services.AppHandles{}
	appSvc := services.NewAppService(rt, handles)

	app = application.New(application.Options{
		Name:        "DragonFlow",
		Description: "DragonFlow AI SDLC Mission Control",
		Icon:        desktop.TrayIdleIcon,
		Services: []application.Service{
			application.NewService(notifSvc),
			application.NewService(dashSvc),
			application.NewService(agentSvc),
			application.NewService(configSvc),
			application.NewService(appSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "dev.dragonflow.desktop",
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
				if trayCtrl != nil {
					trayCtrl.ShowMain("")
				} else if mainWin != nil {
					mainWin.Show()
					mainWin.Restore()
					mainWin.Focus()
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	unsubBus := rt.EventBus.Subscribe(func(ev domain.AppEvent) {
		app.Event.Emit("dragonflow:event", ev)
	})

	cfg := rt.ConfigMgr.Get()
	winTheme := application.SystemDefault
	switch cfg.Desktop.Theme {
	case "dark":
		winTheme = application.Dark
	case "light":
		winTheme = application.Light
	}

	mainWin = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main-window",
		Title:            "DragonFlow",
		Width:            1360,
		Height:           860,
		MinWidth:         1024,
		MinHeight:        680,
		Frameless:        true,
		Hidden:           startMinimized,
		BackgroundType:   application.BackgroundTypeTranslucent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/",
		Windows: application.WindowsWindow{
			BackdropType:           application.Tabbed,
			Theme:                  winTheme,
			NonClientRegionSupport: true,
		},
	})

	flyoutWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "tray-flyout",
		Title:            "DragonFlow Quick Panel",
		Width:            360,
		Height:           460,
		Frameless:        true,
		Hidden:           true,
		AlwaysOnTop:      true,
		DisableResize:    true,
		BackgroundType:   application.BackgroundTypeTranslucent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/#/flyout",
		Windows: application.WindowsWindow{
			BackdropType:    application.Acrylic,
			Theme:           winTheme,
			HiddenOnTaskbar: true,
		},
	})

	mainWin.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		desktop.ApplyWindowTheme(mainWin, rt.ConfigMgr.Get().Desktop.Theme)
	})
	flyoutWin.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		desktop.ApplyWindowTheme(flyoutWin, rt.ConfigMgr.Get().Desktop.Theme)
	})

	// Hide main window to tray instead of quitting unless explicitly exited
	mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if !quitting.Load() {
			e.Cancel()
			mainWin.Hide()
		}
	})

	// Light-dismiss behavior for Acrylic tray flyout
	flyoutWin.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) {
		flyoutWin.Hide()
	})

	app.Event.OnApplicationEvent(events.Windows.SystemThemeChanged, func(_ *application.ApplicationEvent) {
		theme := rt.ConfigMgr.Get().Desktop.Theme
		if theme == "system" {
			desktop.ApplyWindowTheme(mainWin, "system")
			desktop.ApplyWindowTheme(flyoutWin, "system")
			app.Event.Emit("app:theme-changed", "system")
		}
	})

	quitApp := func() {
		if !quitting.CompareAndSwap(false, true) {
			return
		}
		if trayCtrl != nil {
			trayCtrl.Close()
		}
		unsubBus()
		rt.Shutdown()
		app.Quit()
	}

	trayCtrl = desktop.SetupTray(app, rt, mainWin, flyoutWin, func() {
		_ = appSvc.OpenDataDir()
	}, quitApp)

	handles.App = app
	handles.MainWin = mainWin
	handles.FlyoutWin = flyoutWin
	handles.TrayCtrl = trayCtrl
	handles.QuitFn = quitApp

	app.OnShutdown(func() {
		quitting.Store(true)
		if trayCtrl != nil {
			trayCtrl.Close()
		}
		unsubBus()
		rt.Shutdown()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
