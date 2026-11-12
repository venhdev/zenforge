//go:build windows

package runner

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	const CREATE_NEW_PROCESS_GROUP = 0x00000200
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: CREATE_NEW_PROCESS_GROUP,
	}
}

func getProcessGroup(cmd *exec.Cmd) int {
	if cmd == nil || cmd.Process == nil {
		return 0
	}
	return cmd.Process.Pid
}

func killProcessGroup(pgid int, cmd *exec.Cmd) error {
	if pgid <= 0 {
		return nil
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	_ = exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", pgid)).Run()
	return nil
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = proc
	return false
}
