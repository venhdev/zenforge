//go:build windows

package main

// ProcessInfo holds information about a process occupying a port.
type ProcessInfo struct {
	PID     int
	Cmdline string
	Exe     string
	IsZenf  bool
}

// findProcessListeningOnPort is a stub for Windows.
func findProcessListeningOnPort(port int) (*ProcessInfo, error) {
	return nil, nil
}

// killProcess is a stub for Windows.
func killProcess(pid int) error {
	return nil
}
