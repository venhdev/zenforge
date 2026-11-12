//go:build windows

package gateway

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	modkernel32               = syscall.NewLazyDLL("kernel32.dll")
	procGetProcessHandleCount = modkernel32.NewProc("GetProcessHandleCount")

	modpsapi                 = syscall.NewLazyDLL("psapi.dll")
	procGetProcessMemoryInfo = modpsapi.NewProc("GetProcessMemoryInfo")
)

type processMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

func collectOSMetrics(res *RuntimeTelemetryResponse) {
	res.OSSource = "windows:win32api"

	if res.PID != os.Getpid() {
		return
	}

	handle, err := syscall.GetCurrentProcess()
	if err != nil {
		return
	}

	var creation, exit, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err == nil {
		kNs := uint64(kernel.HighDateTime)<<32 | uint64(kernel.LowDateTime)
		uNs := uint64(user.HighDateTime)<<32 | uint64(user.LowDateTime)
		res.CPUSeconds = float64(kNs+uNs) / 1e7
	}

	var memCounters processMemoryCounters
	memCounters.CB = uint32(unsafe.Sizeof(memCounters))
	r1, _, _ := procGetProcessMemoryInfo.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&memCounters)),
		uintptr(memCounters.CB),
	)
	if r1 != 0 {
		res.RSSBytes = uint64(memCounters.WorkingSetSize)
	}

	var handleCount uint32
	r2, _, _ := procGetProcessHandleCount.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&handleCount)),
	)
	if r2 != 0 {
		res.OpenFDs = int(handleCount)
	}
}
