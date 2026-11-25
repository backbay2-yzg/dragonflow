//go:build windows

package desktop

import (
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows/registry"
)

var (
	dwmapi                  = syscall.NewLazyDLL("dwmapi.dll")
	procDwmSetWindowAttr    = dwmapi.NewProc("DwmSetWindowAttribute")
)

const dwmwaUseImmersiveDarkMode = 20

func IsSystemDarkMode() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return true
	}
	defer k.Close()
	val, _, err := k.GetIntegerValue("AppsUseLightTheme")
	if err != nil {
		return true
	}
	return val == 0
}

func ApplyWindowTheme(win *application.WebviewWindow, theme string) {
	if win == nil {
		return
	}
	hwnd := win.NativeWindow()
	if hwnd == nil {
		return
	}
	dark := true
	switch theme {
	case "light":
		dark = false
	case "dark":
		dark = true
	default:
		dark = IsSystemDarkMode()
	}
	var useDark uint32
	if dark {
		useDark = 1
	}
	_, _, _ = procDwmSetWindowAttr.Call(
		uintptr(hwnd),
		uintptr(dwmwaUseImmersiveDarkMode),
		uintptr(unsafe.Pointer(&useDark)),
		unsafe.Sizeof(useDark),
	)
}
