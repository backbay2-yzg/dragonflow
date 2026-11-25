package paths

import (
	"os"
	"path/filepath"
	"slices"
)

type AppPaths struct {
	DataDir  string
	Portable bool
	ExePath  string
	ExeDir   string
}

func ResolveAppPaths(args []string) (AppPaths, error) {
	exePath, err := os.Executable()
	if err != nil {
		exePath = "."
	}
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}
	exeDir := filepath.Dir(exePath)

	hasPortableFlag := slices.Contains(args, "--portable")
	portableMarker := filepath.Join(exeDir, "portable.flag")
	_, markerErr := os.Stat(portableMarker)
	portable := hasPortableFlag || markerErr == nil

	var dataDir string
	if override := os.Getenv("DRAGONFLOW_DATA_DIR"); override != "" {
		abs, err := filepath.Abs(override)
		if err != nil {
			return AppPaths{}, err
		}
		dataDir = abs
	} else if portable {
		dataDir = filepath.Join(exeDir, "data")
	} else {
		cfgDir, err := os.UserConfigDir()
		if err != nil || cfgDir == "" {
			cfgDir = exeDir
		}
		dataDir = filepath.Join(cfgDir, "DragonFlow")
	}

	return AppPaths{
		DataDir:  dataDir,
		Portable: portable,
		ExePath:  exePath,
		ExeDir:   exeDir,
	}, nil
}

func NewAppPathsForDir(dataDir string, portable bool) AppPaths {
	abs, err := filepath.Abs(dataDir)
	if err == nil {
		dataDir = abs
	}
	return AppPaths{
		DataDir:  dataDir,
		Portable: portable,
	}
}

func (p AppPaths) Ensure() error {
	return os.MkdirAll(p.DataDir, 0o755)
}

func (p AppPaths) ConfigPath() string {
	return filepath.Join(p.DataDir, "dragonflow.yaml")
}

func (p AppPaths) VaultPath() string {
	return filepath.Join(p.DataDir, "secrets.vault")
}

func (p AppPaths) DBPath(mode string) string {
	if mode == "demo" {
		return filepath.Join(p.DemoDataDir(), "dragonflow-demo.db")
	}
	return filepath.Join(p.DataDir, "dragonflow.db")
}

func (p AppPaths) DemoDataDir() string {
	return filepath.Join(p.DataDir, "demo")
}

func (p AppPaths) ReposRoot(mode string) string {
	if mode == "demo" {
		return filepath.Join(p.DemoDataDir(), "repos")
	}
	return filepath.Join(p.DataDir, "repos")
}

func (p AppPaths) WorktreeRoot(mode string) string {
	if mode == "demo" {
		return filepath.Join(p.DemoDataDir(), "worktrees")
	}
	return filepath.Join(p.DataDir, "worktrees")
}
