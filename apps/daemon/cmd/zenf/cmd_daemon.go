package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"zenf/internal/contextpacket"
	"zenf/internal/gateway"
	"zenf/internal/storage"

	"github.com/spf13/cobra"
)

func newDaemonCmd() *cobra.Command {
	daemonCmd := &cobra.Command{
		Use:   "daemon [command]",
		Short: "Manage the background orchestrator and gateway server",
		Run: func(cmd *cobra.Command, args []string) {
			_ = cmd.Help()
		},
	}

	var daemonDetach bool
	var daemonForce bool

	daemonStartCmd := &cobra.Command{
		Use:   "start",
		Short: "Start the orchestrator & web cockpit (use -d/--detach for background, -f/--force to reclaim port)",
		RunE: func(cmd *cobra.Command, args []string) error {
			dbPath := resolveHomePath(defaultDBPath)
			stateDir := filepath.Dir(dbPath)
			if err := os.MkdirAll(stateDir, 0755); err != nil {
				return fmt.Errorf("failed to create state directory: %w", err)
			}

			pidFile := filepath.Join(stateDir, "zenf.pid")
			logFile := filepath.Join(stateDir, "zenf.log")

			if err := checkPortAvailability(defaultPort, pidFile, daemonForce, daemonDetach); err != nil {
				return err
			}

			if daemonDetach {
				return startDetachedDaemon(defaultPort, defaultDBPath, logFile, pidFile, daemonForce)
			}

			return runForegroundDaemon(defaultPort, dbPath, pidFile)
		},
	}

	daemonStartCmd.Flags().BoolVarP(&daemonDetach, "detach", "d", false, "Run daemon in background and return terminal")
	daemonStartCmd.Flags().BoolVarP(&daemonForce, "force", "f", false, "Force terminate previous zenf process occupying the port")
	daemonStartCmd.Flags().IntVarP(&defaultPort, "port", "p", defaultDaemonPort, "Port to bind the HTTP/SSE gateway")
	daemonStartCmd.Flags().StringVar(&defaultDBPath, "db", defaultDaemonDBPath, "Path to SQLite WAL database")

	daemonStopCmd := &cobra.Command{
		Use:   "stop",
		Short: "Stop the running background daemon",
		RunE: func(cmd *cobra.Command, args []string) error {
			dbPath := resolveHomePath(defaultDBPath)
			stateDir := filepath.Dir(dbPath)
			pidFile := filepath.Join(stateDir, "zenf.pid")

			data, err := os.ReadFile(pidFile)
			if err != nil {
				client := &http.Client{Timeout: 500 * time.Millisecond}
				if _, err := client.Get(defaultURL + "/api/v1/tasks"); err != nil {
					fmt.Println("○ No active ZenForge Daemon found.")
					return nil
				}
				return fmt.Errorf("daemon is running but PID file not found at %s", pidFile)
			}

			pidStr := strings.TrimSpace(string(data))
			var pid int
			if _, err := fmt.Sscanf(pidStr, "%d", &pid); err != nil {
				return fmt.Errorf("invalid PID in %s: %s", pidFile, pidStr)
			}

			proc, err := os.FindProcess(pid)
			if err != nil {
				_ = os.Remove(pidFile)
				fmt.Println("○ Daemon process already stopped.")
				return nil
			}

			fmt.Printf("==> Stopping ZenForge Daemon (PID %d)...\n", pid)
			if err := proc.Signal(syscall.SIGTERM); err != nil {
				_ = os.Remove(pidFile)
				fmt.Printf("○ Process %d was not reachable (%v). Cleaned PID file.\n", pid, err)
				return nil
			}

			for i := 0; i < 30; i++ {
				time.Sleep(100 * time.Millisecond)
				if err := proc.Signal(syscall.Signal(0)); err != nil {
					break
				}
			}
			_ = os.Remove(pidFile)
			fmt.Printf("✔ ZenForge Daemon stopped successfully.\n")
			return nil
		},
	}

	daemonLogsCmd := &cobra.Command{
		Use:   "logs",
		Short: "Tail log output from background daemon",
		RunE: func(cmd *cobra.Command, args []string) error {
			dbPath := resolveHomePath(defaultDBPath)
			logFile := filepath.Join(filepath.Dir(dbPath), "zenf.log")

			if _, err := os.Stat(logFile); err != nil {
				fmt.Printf("○ No log file found at %s\n", logFile)
				return nil
			}

			tailCmd := exec.Command("tail", "-n", "50", "-f", logFile)
			tailCmd.Stdout = os.Stdout
			tailCmd.Stderr = os.Stderr
			return tailCmd.Run()
		},
	}

	daemonCmd.AddCommand(daemonStartCmd)
	daemonCmd.AddCommand(daemonStopCmd)
	daemonCmd.AddCommand(daemonLogsCmd)
	return daemonCmd
}

func checkPortAvailability(port int, pidFile string, force bool, detach bool) error {
	occupiedBy, _ := findProcessListeningOnPort(port)
	if occupiedBy == nil {
		client := &http.Client{Timeout: 500 * time.Millisecond}
		if resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/tasks", port)); err == nil {
			resp.Body.Close()
			fmt.Printf("⚠ ZenForge Daemon is already active at http://127.0.0.1:%d\n", port)
			if data, err := os.ReadFile(pidFile); err == nil {
				fmt.Printf("  PID: %s\n", strings.TrimSpace(string(data)))
			}
			return nil
		}
		return nil
	}

	if !occupiedBy.IsZenf {
		fmt.Printf("✗ Port %d is occupied by an external application (PID %d: %s).\n", port, occupiedBy.PID, filepath.Base(occupiedBy.Exe))
		fmt.Printf("  Command: %s\n", occupiedBy.Cmdline)
		fmt.Printf("  (--force flag is only effective for zenf processes)\n")
		return fmt.Errorf("port %d is occupied by external process %s (PID %d)", port, filepath.Base(occupiedBy.Exe), occupiedBy.PID)
	}

	if force {
		fmt.Printf("==> Reclaiming port %d from previous zenf daemon (PID %d)...\n", port, occupiedBy.PID)
		_ = killProcess(occupiedBy.PID)
		_ = os.Remove(pidFile)
		for i := 0; i < 20; i++ {
			time.Sleep(100 * time.Millisecond)
			stillThere, _ := findProcessListeningOnPort(port)
			if stillThere == nil {
				break
			}
		}
		return nil
	}

	client := &http.Client{Timeout: 500 * time.Millisecond}
	if resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/tasks", port)); err == nil {
		resp.Body.Close()
		fmt.Printf("⚠ ZenForge Daemon is already active at http://127.0.0.1:%d (PID %d)\n", port, occupiedBy.PID)
		return nil
	}

	fmt.Printf("⚠ Port %d is occupied by a stale or unresponsive ZenForge process (PID %d: %s).\n", port, occupiedBy.PID, filepath.Base(occupiedBy.Exe))
	if detach {
		fmt.Printf("💡 Run 'zenf daemon start -f -d' to force-terminate the stale process and start a fresh daemon.\n")
	} else {
		fmt.Printf("💡 Run 'zenf daemon start -f' to force-terminate the stale process and start a fresh daemon.\n")
	}
	return fmt.Errorf("port %d already in use by zenf PID %d", port, occupiedBy.PID)
}

func startDetachedDaemon(port int, dbPath string, logFile string, pidFile string, force bool) error {
	selfBin, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to find self binary: %w", err)
	}

	logFd, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open daemon log file: %w", err)
	}
	defer logFd.Close()

	childArgs := []string{
		"daemon", "start",
		"--port", fmt.Sprintf("%d", port),
		"--db", dbPath,
	}
	if force {
		childArgs = append(childArgs, "--force")
	}

	childCmd := exec.Command(selfBin, childArgs...)
	childCmd.Stdout = logFd
	childCmd.Stderr = logFd
	setDetachedProcess(childCmd)

	if err := childCmd.Start(); err != nil {
		return fmt.Errorf("failed to launch detached daemon: %w", err)
	}

	pid := childCmd.Process.Pid
	_ = os.WriteFile(pidFile, []byte(fmt.Sprintf("%d\n", pid)), 0644)

	fmt.Printf("==> Starting ZenForge Daemon in background...\n")
	started := false
	for i := 0; i < 20; i++ {
		time.Sleep(100 * time.Millisecond)
		client := &http.Client{Timeout: 500 * time.Millisecond}
		if resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/tasks", port)); err == nil {
			resp.Body.Close()
			started = true
			break
		}
	}

	if started {
		fmt.Printf("  ✔ Daemon running (PID: %d)\n", pid)
		fmt.Printf("  ✔ Control Plane active at http://127.0.0.1:%d\n", port)
		fmt.Printf("  ✔ Logs streaming to %s\n", logFile)
		fmt.Println("\nTo stop the daemon, run: 'zenf daemon stop'")
		return nil
	}

	return fmt.Errorf("daemon failed to start properly. Check logs at %s", logFile)
}

func runForegroundDaemon(port int, dbPath string, pidFile string) error {
	fmt.Printf("ZenForge Control Plane (zenf) v%s starting...\n", Version)
	fmt.Printf("  • Port:     %d\n", port)
	fmt.Printf("  • Database: %s (SQLite WAL)\n", dbPath)

	_ = os.WriteFile(pidFile, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0644)
	defer os.Remove(pidFile)

	db, err := storage.Open(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open storage engine: %w", err)
	}
	defer db.Close()

	store := storage.NewStore(db)
	store.SetPacketBuilder(contextpacket.New(store.ArtifactRepository, nil,
		contextpacket.WithProjectReader(store.ProjectRepository),
		contextpacket.WithPlanReader(store.PlanRepository),
		contextpacket.WithAgentReader(store.AgentRepository),
		contextpacket.WithResourceReader(store.ResourceRepository),
	))

	gw := gateway.NewServer(store)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	listenAddr := fmt.Sprintf("127.0.0.1:%d", port)
	errChan := make(chan error, 1)

	go func() {
		if err := gw.Start(listenAddr); err != nil && err != http.ErrServerClosed {
			errChan <- err
		}
	}()

	fmt.Printf("  ✓ Control Plane active at http://%s\n", listenAddr)
	fmt.Printf("  ✓ Realtime Event Stream at http://%s/api/v1/events/stream\n", listenAddr)

	select {
	case err := <-errChan:
		return fmt.Errorf("gateway error: %w", err)
	case <-ctx.Done():
		fmt.Printf("\nShutdown requested. Flushing WAL and closing gateway...\n")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = gw.Shutdown(shutdownCtx)
		fmt.Printf("ZenForge Daemon stopped cleanly.\n")
		return nil
	}
}
