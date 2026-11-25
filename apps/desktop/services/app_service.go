package services

import (
	"os/exec"
	"runtime"

	"github.com/dragonflow/desktop/internal/adapters"
	"github.com/dragonflow/desktop/internal/desktop"
	"github.com/dragonflow/desktop/internal/domain"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AppHandles struct {
	App       *application.App
	MainWin   *application.WebviewWindow
	FlyoutWin *application.WebviewWindow
	TrayCtrl  *desktop.TrayController
	QuitFn    func()
}

type AppService struct {
	rt      *desktop.Runtime
	handles *AppHandles
}

func NewAppService(rt *desktop.Runtime, handles *AppHandles) *AppService {
	return &AppService{rt: rt, handles: handles}
}

func (s *AppService) GetDesktopInfo() domain.DesktopInfo {
	cfg := s.rt.ConfigMgr.Get()
	autostart := false
	if s.handles != nil && s.handles.App != nil {
		autostart, _ = s.handles.App.Autostart.IsEnabled()
	}
	whActive, whAddr := false, ""
	if s.rt.WebhookServer != nil {
		whActive, whAddr = s.rt.WebhookServer.Status()
	}
	return domain.DesktopInfo{
		Version:        "0.1.0",
		Mode:           s.rt.Mode,
		DataDir:        s.rt.Paths.DataDir,
		ConfigPath:     s.rt.Paths.ConfigPath(),
		DBPath:         s.rt.DBPath,
		Portable:       s.rt.Paths.Portable,
		Autostart:      autostart,
		Theme:          cfg.Desktop.Theme,
		IsFirstLaunch:  s.rt.ConfigMgr.IsFirstLaunch(),
		GitAvailable:   s.rt.GitAvailable,
		WebhookActive:  whActive,
		WebhookAddress: whAddr,
	}
}

func (s *AppService) SetTheme(theme string) (string, error) {
	if theme != "light" && theme != "dark" {
		theme = "system"
	}
	cfg := s.rt.ConfigMgr.Get()
	cfg.Desktop.Theme = theme
	if _, err := s.rt.ConfigMgr.Save(cfg); err != nil {
		return "", err
	}
	if s.handles != nil {
		desktop.ApplyWindowTheme(s.handles.MainWin, theme)
		desktop.ApplyWindowTheme(s.handles.FlyoutWin, theme)
		if s.handles.App != nil {
			s.handles.App.Event.Emit("app:theme-changed", theme)
		}
	}
	return theme, nil
}

func (s *AppService) SetAutostart(enabled bool) (bool, error) {
	if s.handles == nil || s.handles.App == nil {
		return false, nil
	}
	var err error
	if enabled {
		err = s.handles.App.Autostart.EnableWithOptions(application.AutostartOptions{
			Identifier: "DragonFlow",
			Arguments:  []string{"--minimized"},
		})
	} else {
		err = s.handles.App.Autostart.Disable()
	}
	if err != nil {
		return false, err
	}
	actual, _ := s.handles.App.Autostart.IsEnabled()
	if s.handles.TrayCtrl != nil {
		s.handles.TrayCtrl.SyncAutostartCheckbox(actual)
	}
	return actual, nil
}

func (s *AppService) OpenDataDir() error {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("explorer.exe", s.rt.Paths.DataDir)
		adapters.ApplyHiddenProcAttr(cmd)
		return cmd.Start()
	}
	if s.handles != nil && s.handles.App != nil {
		return s.handles.App.Browser.OpenFile(s.rt.Paths.DataDir)
	}
	return nil
}

func (s *AppService) OpenExternalURL(targetURL string) error {
	if s.handles == nil || s.handles.App == nil || targetURL == "" {
		return nil
	}
	return s.handles.App.Browser.OpenURL(targetURL)
}

func (s *AppService) ShowMainWindow(focusTaskID string, navigateTab string) {
	if s.handles == nil {
		return
	}
	if s.handles.TrayCtrl != nil {
		s.handles.TrayCtrl.ShowMain(focusTaskID)
	} else if s.handles.MainWin != nil {
		s.handles.MainWin.Show()
		s.handles.MainWin.Restore()
		s.handles.MainWin.Focus()
	}
	if navigateTab != "" && s.handles.App != nil {
		s.handles.App.Event.Emit("app:navigate", navigateTab)
	}
}

func (s *AppService) HideFlyout() {
	if s.handles != nil && s.handles.FlyoutWin != nil {
		s.handles.FlyoutWin.Hide()
	}
}

func (s *AppService) MinimizeMain() {
	if s.handles != nil && s.handles.MainWin != nil {
		s.handles.MainWin.Minimise()
	}
}

func (s *AppService) ToggleMaximizeMain() bool {
	if s.handles == nil || s.handles.MainWin == nil {
		return false
	}
	s.handles.MainWin.ToggleMaximise()
	return s.handles.MainWin.IsMaximised()
}

func (s *AppService) IsMainMaximized() bool {
	if s.handles == nil || s.handles.MainWin == nil {
		return false
	}
	return s.handles.MainWin.IsMaximised()
}

func (s *AppService) HideMainToTray() {
	if s.handles != nil && s.handles.MainWin != nil {
		s.handles.MainWin.Hide()
	}
}

func (s *AppService) QuitApp() {
	if s.handles != nil && s.handles.QuitFn != nil {
		s.handles.QuitFn()
	}
}
