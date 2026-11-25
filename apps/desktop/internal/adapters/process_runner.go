package adapters

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/secrets"
)

type SubprocessOptions struct {
	Command      string
	Args         []string
	Cwd          string
	StdinText    *string
	TimeoutMs    int
	EnvAllowlist []string
	ExtraEnv     map[string]string
	Vault        *secrets.SecretVault
	OnLog        func(stream string, line string)
}

type SubprocessResult struct {
	ExitCode     int
	Stdout       string
	Stderr       string
	TimedOut     bool
	ResolvedPath string
	DurationMs   int64
}

var windowsBaselineEnv = []string{
	"PATH", "Path", "PATHEXT",
	"SystemRoot", "SYSTEMROOT", "COMSPEC", "ComSpec",
	"USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH",
	"APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
	"PROGRAMDATA", "ProgramData", "PROGRAMFILES", "ProgramFiles", "ProgramFiles(x86)",
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
	"http_proxy", "https_proxy", "no_proxy",
	"NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE",
	"LANG", "LC_ALL", "TERM",
}

var winExtPriority = map[string]int{
	".exe": 1,
	".cmd": 2,
	".bat": 3,
	".com": 4,
	".ps1": 5,
}

func itoa(v int) string {
	return strconv.Itoa(v)
}

func spawnSimpleCapture(ctx context.Context, bin string, args []string) (int, string, string) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, args...)
	ApplyHiddenProcAttr(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
		} else {
			code = -1
			if stderr.Len() == 0 {
				stderr.WriteString(err.Error())
			}
		}
	}
	return code, stdout.String(), stderr.String()
}

func ResolveExecutable(command string) string {
	command = strings.TrimSpace(command)
	if command == "" {
		return ""
	}
	if strings.ContainsAny(command, "/\\") {
		info, err := os.Stat(command)
		if err == nil && !info.IsDir() {
			return command
		}
		return ""
	}

	if runtime.GOOS == "windows" {
		code, stdout, _ := spawnSimpleCapture(context.Background(), "where.exe", []string{command})
		if code != 0 || strings.TrimSpace(stdout) == "" {
			return ""
		}
		lines := strings.Split(stdout, "\n")
		candidates := make([]string, 0, len(lines))
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" {
				candidates = append(candidates, line)
			}
		}
		if len(candidates) == 0 {
			return ""
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			pA, okA := winExtPriority[strings.ToLower(filepath.Ext(candidates[i]))]
			if !okA {
				pA = 99
			}
			pB, okB := winExtPriority[strings.ToLower(filepath.Ext(candidates[j]))]
			if !okB {
				pB = 99
			}
			return pA < pB
		})
		best := candidates[0]
		if filepath.Ext(best) == "" {
			return ""
		}
		return best
	}

	path, err := exec.LookPath(command)
	if err != nil {
		return ""
	}
	return path
}

func BuildFilteredEnv(allowlist []string, extraEnv map[string]string, vault *secrets.SecretVault) []string {
	merged := make(map[string]string)
	upperMap := make(map[string]string) // canonical key lookup on Windows

	setKey := func(k, v string) {
		uk := strings.ToUpper(k)
		if existingKey, ok := upperMap[uk]; ok && runtime.GOOS == "windows" {
			delete(merged, existingKey)
		}
		upperMap[uk] = k
		merged[k] = v
	}

	for _, k := range windowsBaselineEnv {
		if val, ok := os.LookupEnv(k); ok {
			setKey(k, val)
		}
	}
	for _, k := range allowlist {
		if vault != nil {
			if val, ok := vault.Get(k); ok {
				setKey(k, val)
				continue
			}
		}
		if val, ok := os.LookupEnv(k); ok {
			setKey(k, val)
		}
	}
	for k, v := range extraEnv {
		setKey(k, v)
	}

	out := make([]string, 0, len(merged))
	for k, v := range merged {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return out
}

func readStreamLines(r io.Reader, stream string, buf *bytes.Buffer, mu *sync.Mutex, onLog func(string, string)) {
	reader := bufio.NewReaderSize(r, 64*1024)
	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			mu.Lock()
			buf.WriteString(line)
			mu.Unlock()
			trimmed := strings.TrimRight(line, "\r\n")
			if trimmed != "" && onLog != nil {
				onLog(stream, trimmed)
			}
		}
		if err != nil {
			break
		}
	}
}

func RunSubprocess(ctx context.Context, opts SubprocessOptions) (SubprocessResult, error) {
	start := time.Now()
	resolvedPath := ResolveExecutable(opts.Command)
	if resolvedPath == "" {
		return SubprocessResult{}, fmt.Errorf("Executable not found in PATH: %s", opts.Command)
	}

	spawnCmd := resolvedPath
	spawnArgs := append([]string{}, opts.Args...)
	if runtime.GOOS == "windows" {
		ext := strings.ToLower(filepath.Ext(resolvedPath))
		switch ext {
		case ".ps1":
			spawnCmd = "powershell.exe"
			spawnArgs = append([]string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedPath}, opts.Args...)
		case ".cmd", ".bat":
			comspec := os.Getenv("ComSpec")
			if comspec == "" {
				comspec = "cmd.exe"
			}
			spawnCmd = comspec
			spawnArgs = append([]string{"/d", "/c", resolvedPath}, opts.Args...)
		}
	}

	timeoutMs := opts.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 900_000
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.Command(spawnCmd, spawnArgs...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = BuildFilteredEnv(opts.EnvAllowlist, opts.ExtraEnv, opts.Vault)
	ApplyHiddenProcAttr(cmd)

	if opts.StdinText != nil {
		cmd.Stdin = strings.NewReader(*opts.StdinText)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return SubprocessResult{}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return SubprocessResult{}, err
	}

	if err := cmd.Start(); err != nil {
		if opts.OnLog != nil {
			opts.OnLog("stderr", fmt.Sprintf("[DragonFlow] Spawn error: %s", err.Error()))
		}
		return SubprocessResult{
			ExitCode:     -1,
			Stderr:       err.Error(),
			ResolvedPath: resolvedPath,
			DurationMs:   time.Since(start).Milliseconds(),
		}, nil
	}

	var (
		stdoutBuf bytes.Buffer
		stderrBuf bytes.Buffer
		bufMu     sync.Mutex
		wg        sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		readStreamLines(stdoutPipe, "stdout", &stdoutBuf, &bufMu, opts.OnLog)
	}()
	go func() {
		defer wg.Done()
		readStreamLines(stderrPipe, "stderr", &stderrBuf, &bufMu, opts.OnLog)
	}()

	doneWatch := make(chan struct{})
	timedOut := false
	var timeoutMu sync.Mutex
	go func() {
		select {
		case <-runCtx.Done():
			timeoutMu.Lock()
			if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
				timedOut = true
				if opts.OnLog != nil {
					opts.OnLog("stderr", fmt.Sprintf("[DragonFlow] Process exceeded timeout (%dms), terminating...", timeoutMs))
				}
			}
			timeoutMu.Unlock()
			if cmd.Process != nil {
				killProcessTree(cmd.Process.Pid)
			}
		case <-doneWatch:
		}
	}()

	wg.Wait()
	waitErr := cmd.Wait()
	close(doneWatch)

	timeoutMu.Lock()
	isTimedOut := timedOut
	timeoutMu.Unlock()

	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	return SubprocessResult{
		ExitCode:     exitCode,
		Stdout:       stdoutBuf.String(),
		Stderr:       stderrBuf.String(),
		TimedOut:     isTimedOut,
		ResolvedPath: resolvedPath,
		DurationMs:   time.Since(start).Milliseconds(),
	}, nil
}

var (
	defaultQuotaPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)insufficient[_\s-]?quota`),
		regexp.MustCompile(`(?i)quota[_\s-]?exceeded`),
		regexp.MustCompile(`(?i)credit balance is too low`),
		regexp.MustCompile(`(?i)billing.*limit`),
		regexp.MustCompile(`(?i)exceeded your current quota`),
		regexp.MustCompile(`(?i)usage limit reached`),
		regexp.MustCompile(`(?i)out of credits`),
	}
	defaultRateLimitPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)rate[_\s-]?limit`),
		regexp.MustCompile(`(?i)\b429\b`),
		regexp.MustCompile(`(?i)too many requests`),
		regexp.MustCompile(`(?i)overloaded_error`),
	}
	defaultAuthPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)unauthorized`),
		regexp.MustCompile(`(?i)invalid[_\s-]?api[_\s-]?key`),
		regexp.MustCompile(`(?i)authentication failed`),
		regexp.MustCompile(`(?i)not logged in`),
		regexp.MustCompile(`(?i)please run .*login`),
		regexp.MustCompile(`(?i)\b401\b`),
	}
)

func ClassifyAgentError(exitCode int, stdout, stderr string, timedOut bool, customQuotaPatterns []string) domain.AgentErrorKind {
	if timedOut {
		return domain.ErrKindTimeout
	}
	if exitCode == 0 {
		return domain.ErrKindNone
	}
	combined := stderr + "\n" + stdout
	for _, pat := range customQuotaPatterns {
		if pat == "" {
			continue
		}
		if re, err := regexp.Compile("(?i)" + pat); err == nil && re.MatchString(combined) {
			return domain.ErrKindQuotaExceeded
		}
	}
	for _, re := range defaultQuotaPatterns {
		if re.MatchString(combined) {
			return domain.ErrKindQuotaExceeded
		}
	}
	for _, re := range defaultRateLimitPatterns {
		if re.MatchString(combined) {
			return domain.ErrKindRateLimited
		}
	}
	for _, re := range defaultAuthPatterns {
		if re.MatchString(combined) {
			return domain.ErrKindAuthFailed
		}
	}
	return domain.ErrKindRuntimeError
}
