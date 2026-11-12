//go:build darwin

package gateway

import (
	"os"
	"syscall"
)

func collectOSMetrics(res *RuntimeTelemetryResponse) {
	res.OSSource = "darwin:getrusage+/dev/fd"

	if res.PID != os.Getpid() {
		return
	}

	if entries, err := os.ReadDir("/dev/fd"); err == nil {
		res.OpenFDs = len(entries)
	}

	var rusage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &rusage); err == nil {
		userSec := float64(rusage.Utime.Sec) + float64(rusage.Utime.Usec)/1e6
		sysSec := float64(rusage.Stime.Sec) + float64(rusage.Stime.Usec)/1e6
		res.CPUSeconds = userSec + sysSec
		if rusage.Maxrss > 0 {
			// On Darwin/macOS, ru_maxrss is reported in bytes.
			res.RSSBytes = uint64(rusage.Maxrss)
		}
	}
}
