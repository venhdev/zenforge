package gateway

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"runtime/metrics"
	"time"

	"zenf/internal/version"
)

// RuntimeTelemetryResponse describes the live health, resource footprint, and active
// workloads of the running zenf daemon process.
type RuntimeTelemetryResponse struct {
	PID           int     `json:"pid"`
	Version       string  `json:"version"`
	OS            string  `json:"os"`
	Arch          string  `json:"arch"`
	StartedAt     string  `json:"started_at"`
	UptimeSeconds float64 `json:"uptime_seconds"`

	Goroutines int `json:"goroutines"`
	GOMAXPROCS int `json:"gomaxprocs"`

	HeapAllocBytes uint64 `json:"heap_alloc_bytes"`
	HeapInuseBytes uint64 `json:"heap_inuse_bytes"`
	SysBytes       uint64 `json:"sys_bytes"`
	StackInuse     uint64 `json:"stack_inuse_bytes"`
	RSSBytes       uint64 `json:"rss_bytes"`

	CPUSeconds        float64 `json:"cpu_seconds"`
	GoCPUUserSeconds  float64 `json:"go_cpu_user_seconds"`
	GoCPUGCSeconds    float64 `json:"go_cpu_gc_seconds"`
	GoCPUTotalSeconds float64 `json:"go_cpu_total_seconds"`

	OpenFDs        int    `json:"open_fds"`
	OSSource       string `json:"os_source"`
	SSEClients     int    `json:"sse_clients"`
	ActiveSessions int    `json:"active_sessions"`
}

func (s *Server) handleGetRuntimeStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.CollectRuntimeTelemetry())
}

// CollectRuntimeTelemetry gathers cross-platform Go runtime metrics and merges
// OS-native process telemetry for the current daemon process.
func (s *Server) CollectRuntimeTelemetry() RuntimeTelemetryResponse {
	return CollectProcessTelemetry(os.Getpid(), s.startedAt, s.sseClientCount(), s.activeSessionCount())
}

func (s *Server) sseClientCount() int {
	s.sseMu.RLock()
	defer s.sseMu.RUnlock()
	return len(s.sseClients)
}

func (s *Server) activeSessionCount() int {
	if s.runnerRegistry == nil {
		return 0
	}
	return s.runnerRegistry.Count()
}

// CollectProcessTelemetry collects runtime and OS metrics for a given PID.
// When pid == os.Getpid(), full in-process runtime and OS syscalls are used.
// When pid != os.Getpid() (e.g. CLI fallback probing a running daemon on Linux),
// OS-level /proc probes are populated where available.
func CollectProcessTelemetry(pid int, startedAt time.Time, sseClients int, activeSessions int) RuntimeTelemetryResponse {
	res := RuntimeTelemetryResponse{
		PID:            pid,
		Version:        version.Version,
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		GOMAXPROCS:     runtime.GOMAXPROCS(0),
		OpenFDs:        -1,
		SSEClients:     sseClients,
		ActiveSessions: activeSessions,
	}

	if !startedAt.IsZero() {
		res.StartedAt = startedAt.UTC().Format(time.RFC3339)
		res.UptimeSeconds = time.Since(startedAt).Seconds()
	}

	if pid == os.Getpid() {
		res.Goroutines = runtime.NumGoroutine()

		samples := []metrics.Sample{
			{Name: "/memory/classes/heap/objects:bytes"},
			{Name: "/memory/classes/heap/unused:bytes"},
			{Name: "/memory/classes/total:bytes"},
			{Name: "/memory/classes/heap/stacks:bytes"},
			{Name: "/cpu/classes/user:cpu-seconds"},
			{Name: "/cpu/classes/gc/total:cpu-seconds"},
			{Name: "/cpu/classes/total:cpu-seconds"},
		}
		metrics.Read(samples)
		getUint64 := func(sm metrics.Sample) uint64 {
			if sm.Value.Kind() == metrics.KindUint64 {
				return sm.Value.Uint64()
			}
			return 0
		}
		getFloat := func(sm metrics.Sample) float64 {
			if sm.Value.Kind() == metrics.KindFloat64 {
				return sm.Value.Float64()
			}
			return 0
		}
		heapObjects := getUint64(samples[0])
		heapUnused := getUint64(samples[1])
		res.HeapAllocBytes = heapObjects
		res.HeapInuseBytes = heapObjects + heapUnused
		res.SysBytes = getUint64(samples[2])
		res.StackInuse = getUint64(samples[3])
		res.GoCPUUserSeconds = getFloat(samples[4])
		res.GoCPUGCSeconds = getFloat(samples[5])
		res.GoCPUTotalSeconds = getFloat(samples[6])
	}

	collectOSMetrics(&res)

	if res.RSSBytes == 0 && res.SysBytes > 0 {
		res.RSSBytes = res.SysBytes
		if res.OSSource == "" {
			res.OSSource = "runtime.MemStats.Sys"
		}
	}
	if res.CPUSeconds == 0 && res.GoCPUUserSeconds > 0 {
		res.CPUSeconds = res.GoCPUUserSeconds + res.GoCPUGCSeconds
	}

	return res
}
