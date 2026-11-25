package desktop

import _ "embed"

//go:embed assets/tray_idle.png
var TrayIdleIcon []byte

//go:embed assets/tray_running.png
var TrayRunningIcon []byte

//go:embed assets/tray_attention.png
var TrayAttentionIcon []byte
