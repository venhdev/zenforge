//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// ProcessInfo holds information about a process occupying a port.
type ProcessInfo struct {
	PID     int
	Cmdline string
	Exe     string
	IsZenf  bool
}

// findProcessListeningOnPort finds the process listening on the given TCP port using /proc.
func findProcessListeningOnPort(port int) (*ProcessInfo, error) {
	hexPort := fmt.Sprintf("%04X", port)
	inodes := make(map[string]bool)

	// Scan /proc/net/tcp and /proc/net/tcp6
	for _, netFile := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(netFile)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) >= 10 {
				localAddr := fields[1]
				state := fields[3]
				// State 0A == TCP_LISTEN
				if state == "0A" && strings.HasSuffix(strings.ToUpper(localAddr), ":"+hexPort) {
					inode := fields[9]
					inodes[inode] = true
				}
			}
		}
		_ = f.Close()
	}

	if len(inodes) == 0 {
		return nil, nil
	}

	// Scan /proc/[pid]/fd to find the matching socket inode
	procEntries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}

	for _, entry := range procEntries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		fdDir := filepath.Join("/proc", entry.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}

		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			for inode := range inodes {
				if strings.Contains(link, fmt.Sprintf("socket:[%s]", inode)) {
					// Found matching PID!
					info := &ProcessInfo{PID: pid}

					// Read exe
					if exePath, err := os.Readlink(filepath.Join("/proc", entry.Name(), "exe")); err == nil {
						info.Exe = exePath
					}

					// Read cmdline
					if cmdData, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline")); err == nil {
						info.Cmdline = strings.ReplaceAll(string(cmdData), "\x00", " ")
					}

					// Determine if it is a zenf process
					baseExe := filepath.Base(info.Exe)
					if strings.Contains(strings.ToLower(baseExe), "zenf") ||
						strings.Contains(strings.ToLower(info.Cmdline), "zenf daemon") ||
						strings.Contains(strings.ToLower(info.Cmdline), "zenf start") {
						info.IsZenf = true
					}

					return info, nil
				}
			}
		}
	}

	return nil, nil
}

// killProcess terminates a process by PID.
func killProcess(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	// Try graceful SIGTERM first
	_ = proc.Signal(syscall.SIGTERM)

	// If still running after a short grace period, SIGKILL
	if err := proc.Signal(syscall.Signal(0)); err == nil {
		_ = proc.Signal(syscall.SIGKILL)
	}
	return nil
}
