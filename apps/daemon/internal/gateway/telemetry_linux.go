//go:build linux

package gateway

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func collectOSMetrics(res *RuntimeTelemetryResponse) {
	res.OSSource = "linux:/proc+getrusage"

	// 1. Open File Descriptors via /proc/<pid>/fd
	fdDir := fmt.Sprintf("/proc/%d/fd", res.PID)
	if entries, err := os.ReadDir(fdDir); err == nil {
		res.OpenFDs = len(entries)
	}

	// 2. Current Resident Set Size (RSS) via /proc/<pid>/statm (field 1 is resident pages)
	statmPath := fmt.Sprintf("/proc/%d/statm", res.PID)
	if data, err := os.ReadFile(statmPath); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 2 {
			if rssPages, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
				res.RSSBytes = rssPages * uint64(os.Getpagesize())
			}
		}
	}

	// 3. Process CPU Time (user + sys) and MaxRSS fallback via syscall.Getrusage when in-process
	if res.PID == os.Getpid() {
		var rusage syscall.Rusage
		if err := syscall.Getrusage(syscall.RUSAGE_SELF, &rusage); err == nil {
			userSec := float64(rusage.Utime.Sec) + float64(rusage.Utime.Usec)/1e6
			sysSec := float64(rusage.Stime.Sec) + float64(rusage.Stime.Usec)/1e6
			res.CPUSeconds = userSec + sysSec
			if res.RSSBytes == 0 && rusage.Maxrss > 0 {
				res.RSSBytes = uint64(rusage.Maxrss) * 1024
			}
		}
		return
	}

	// 4. External PID fallback on Linux (e.g. older daemon binary without /api/v1/status):
	// Read /proc/<pid>/stat for utime (field 14), stime (field 15), num_threads (field 20),
	// and /proc/<pid> creation time for uptime fallback.
	if res.UptimeSeconds <= 0 {
		if st, err := os.Stat(fmt.Sprintf("/proc/%d", res.PID)); err == nil {
			res.StartedAt = st.ModTime().UTC().Format(time.RFC3339)
			res.UptimeSeconds = time.Since(st.ModTime()).Seconds()
		}
	}
	if data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", res.PID)); err == nil {
		raw := string(data)
		if idx := strings.LastIndex(raw, ")"); idx != -1 && idx+2 < len(raw) {
			fields := strings.Fields(raw[idx+2:])
			// After comm ")", field 0 is state (3rd field in proc/stat).
			// utime is 14th (index 11), stime is 15th (index 12) in clock ticks (usually 100 Hz).
			if len(fields) > 12 {
				utimeTicks, _ := strconv.ParseFloat(fields[11], 64)
				stimeTicks, _ := strconv.ParseFloat(fields[12], 64)
				const clkTck = 100.0
				res.CPUSeconds = (utimeTicks + stimeTicks) / clkTck
			}
		}
	}
}
