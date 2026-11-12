//go:build !windows

package runner

import (
	"os/exec"
	"syscall"
	"time"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
}

func getProcessGroup(cmd *exec.Cmd) int {
	if cmd == nil || cmd.Process == nil {
		return 0
	}
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		return cmd.Process.Pid
	}
	return pgid
}

func killProcessGroup(pgid int, cmd *exec.Cmd) error {
	if pgid <= 0 {
		return nil
	}
	// 1. Send SIGTERM to process group for graceful shutdown
	_ = syscall.Kill(-pgid, syscall.SIGTERM)

	// 2. Poll for exit, then hard-kill only if the group is still alive. Never
	//    SIGKILL a recycled pgid, and keep the total grace window at 100ms.
	for i := 0; i < 10; i++ {
		time.Sleep(10 * time.Millisecond)
		if !isProcessAlive(-pgid) {
			return nil
		}
	}
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
	return nil
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}
