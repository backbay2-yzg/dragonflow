//go:build windows

package adapters

import (
	"os/exec"
	"syscall"
)

const createNoWindowFlag = 0x08000000

// ApplyHiddenProcAttr ensures child console processes never flash a console window on Windows.
func ApplyHiddenProcAttr(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNoWindowFlag,
		HideWindow:    true,
	}
}

func killProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	cmd := exec.Command("taskkill", "/pid", itoa(pid), "/T", "/F")
	ApplyHiddenProcAttr(cmd)
	_ = cmd.Run()
}
