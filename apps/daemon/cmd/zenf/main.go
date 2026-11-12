package main

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"zenf/internal/version"

	"github.com/creack/pty"
	"github.com/spf13/cobra"
)

var (
	defaultPort   int
	defaultDBPath string
	defaultURL    string
)

// Installation defaults shared by `daemon start` and the post-update restart.
const (
	defaultDaemonPort   = 1123
	defaultDaemonDBPath = "~/.zenforge/state.db"
)

// cliHTTPClient bounds every CLI request so a wedged daemon fails fast instead
// of blocking the shell indefinitely.
var cliHTTPClient = &http.Client{Timeout: 15 * time.Second}

var (
	Version   = version.Version
	Commit    = "none"
	BuildDate = "unknown"
)

func resolveHomePath(path string) string {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return filepath.Join(os.TempDir(), "zenforge", "state.db")
		}
		return filepath.Join(home, ".zenforge", "state.db")
	}
	if path == "~" || path == "~/" {
		home, _ := os.UserHomeDir()
		return home
	}
	if len(path) > 2 && path[:2] == "~/" {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, path[2:])
	}
	return path
}

func getTerminalWidth() int {
	if _, cols, err := pty.Getsize(os.Stdout); err == nil && cols > 0 {
		return cols
	}
	if envCols := os.Getenv("COLUMNS"); envCols != "" {
		if n, err := strconv.Atoi(envCols); err == nil && n > 0 {
			return n
		}
	}
	return 80
}

func printHorizontalRule(maxWidth int) {
	width := getTerminalWidth()
	if maxWidth > 0 && width > maxWidth {
		width = maxWidth
	}
	if width < 32 {
		width = 32
	}
	fmt.Println(strings.Repeat("─", width))
}

func printField(label string, value string, extra string, termWidth int) {
	prefix := fmt.Sprintf(" • %-13s: %s", label, value)
	if extra == "" {
		fmt.Println(prefix)
		return
	}

	singleLine := fmt.Sprintf("%s (%s)", prefix, extra)
	if len(singleLine) <= termWidth {
		fmt.Println(singleLine)
	} else {
		fmt.Println(prefix)
		fmt.Printf("   ↳ %s\n", extra)
	}
}

type DatabaseStorageInfo struct {
	TotalBytes int64  `json:"total_bytes"`
	TotalHuman string `json:"total_human"`
	MainBytes  int64  `json:"main_bytes"`
	MainHuman  string `json:"main_human"`
	WalBytes   int64  `json:"wal_bytes"`
	WalHuman   string `json:"wal_human"`
	ShmBytes   int64  `json:"shm_bytes"`
	ShmHuman   string `json:"shm_human"`
	LogBytes   int64  `json:"log_bytes,omitempty"`
	LogHuman   string `json:"log_human,omitempty"`
}

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func formatDurationShort(seconds float64) string {
	if seconds <= 0 {
		return "0s"
	}
	d := time.Duration(seconds * float64(time.Second))
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	totalSec := int64(d.Seconds())
	days := totalSec / 86400
	hours := (totalSec % 86400) / 3600
	mins := (totalSec % 3600) / 60
	secs := totalSec % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, mins, secs)
	}
	if mins > 0 {
		return fmt.Sprintf("%dm %ds", mins, secs)
	}
	return fmt.Sprintf("%ds", secs)
}

func getDatabaseStorage(dbPath string) DatabaseStorageInfo {
	info := DatabaseStorageInfo{}
	mainStat, err := os.Stat(dbPath)
	if err == nil {
		info.MainBytes = mainStat.Size()
		info.MainHuman = formatBytes(info.MainBytes)
	}

	walStat, err := os.Stat(dbPath + "-wal")
	if err == nil {
		info.WalBytes = walStat.Size()
		info.WalHuman = formatBytes(info.WalBytes)
	}

	shmStat, err := os.Stat(dbPath + "-shm")
	if err == nil {
		info.ShmBytes = shmStat.Size()
		info.ShmHuman = formatBytes(info.ShmBytes)
	}

	logPath := filepath.Join(filepath.Dir(dbPath), "zenf.log")
	if logStat, err := os.Stat(logPath); err == nil {
		info.LogBytes = logStat.Size()
		info.LogHuman = formatBytes(info.LogBytes)
	}

	info.TotalBytes = info.MainBytes + info.WalBytes + info.ShmBytes
	info.TotalHuman = formatBytes(info.TotalBytes)
	return info
}

// waitForProcessExit polls until the process is gone or the timeout elapses.
func waitForProcessExit(process *os.Process, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if err := process.Signal(syscall.Signal(0)); err != nil {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// daemonRestartArgs builds the detached start command. `-f` reclaims the port
// if the previous daemon has not released it yet.
func daemonRestartArgs(port int, dbPath string) []string {
	if port == 0 {
		port = defaultDaemonPort
	}
	if dbPath == "" {
		dbPath = defaultDaemonDBPath
	}
	return []string{
		"daemon", "start", "-d", "-f",
		"--port", strconv.Itoa(port),
		"--db", dbPath,
	}
}

// restartActiveDaemonIfRunning stops the background daemon (if any) and starts
// the freshly installed binary again.
//
// execPath must be the installed path captured before ReplaceBinary: after the
// swap, the running process's executable resolves to the removed `.old` inode,
// so os.Executable() can no longer be launched.
func restartActiveDaemonIfRunning(port int, dbPath, execPath string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	pidFile := filepath.Join(home, ".zenforge", "zenf.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return
	}

	fmt.Printf("Restarting active ZenForge background daemon (PID: %d)...\n", pid)
	_ = process.Signal(syscall.SIGTERM)
	if !waitForProcessExit(process, 5*time.Second) {
		fmt.Println("  ⚠ Previous daemon is still shutting down; forcing port reclaim.")
	}
	// A stale pid file would make `daemon start` believe the old process is alive.
	_ = os.Remove(pidFile)

	if execPath == "" {
		if resolved, err := os.Executable(); err == nil {
			execPath = resolved
		} else {
			execPath = "zenf"
		}
	}

	cmd := exec.Command(execPath, daemonRestartArgs(port, dbPath)...)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		fmt.Printf("  ✖ Failed to restart daemon: %v\n", err)
		if trimmed := strings.TrimSpace(output.String()); trimmed != "" {
			fmt.Printf("    %s\n", strings.ReplaceAll(trimmed, "\n", "\n    "))
		}
		return
	}
	if trimmed := strings.TrimSpace(output.String()); trimmed != "" {
		fmt.Printf("    %s\n", strings.ReplaceAll(trimmed, "\n", "\n    "))
	}
	fmt.Println("  ✔ Background daemon restarted successfully.")
}

func main() {
	rootCmd := &cobra.Command{
		Use:     "zenf",
		Version: Version,
		Short:   "ZenForge Control Plane (zenf) - Multi-Agent State Daemon & Cockpit Orchestrator",
		Long: `zenf is the single-binary control plane for ZenForge.
It owns the SQLite WAL tracking plane, exposes an MCP stdio surface for agents,
and serves a read-only cockpit with real-time SSE updates on port 1123.`,
		Run: func(cmd *cobra.Command, args []string) {
			statusStr := "○ Stopped"
			client := &http.Client{Timeout: 1 * time.Second}
			resp, err := client.Get(defaultURL + "/api/v1/projects")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					statusStr = fmt.Sprintf("● Active (%s)", defaultURL)
				}
			}

			fmt.Printf("ZenForge Control Plane (zenf v%s)\n", Version)
			fmt.Printf("Daemon Status: %s\n\n", statusStr)
			fmt.Println("Quickstart Commands:")
			fmt.Println("  zenf daemon start   Start daemon in foreground (or -d for background)")
			fmt.Println("  zenf daemon stop    Gracefully stop running background daemon")
			fmt.Println("  zenf daemon logs    Stream logs from background daemon")
			fmt.Println("  zenf status         View comprehensive status of daemon & all AI MCP clients")
			fmt.Println("  zenf mcp            Audit AI client MCP setups and display MCP actions")
			fmt.Println("  zenf task list      List current tasks across active projects")
			fmt.Println("\nRun 'zenf --help' for the complete command reference.")
		},
	}

	rootCmd.PersistentFlags().StringVar(&defaultURL, "url", "http://127.0.0.1:1123", "Daemon control plane URL")

	rootCmd.AddCommand(
		newDaemonCmd(),
		newPlanCmd(),
		newTaskCmd(),
		newResourceCmd(),
		newStatusCmd(),
		newMCPCmd(),
		newUpdateCmd(),
	)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
