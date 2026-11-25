//go:build !windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func IsSystemDarkMode() bool { return true }

func ApplyWindowTheme(_ *application.WebviewWindow, _ string) {}
