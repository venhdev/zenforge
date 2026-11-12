//go:build !linux && !darwin && !windows

package gateway

func collectOSMetrics(res *RuntimeTelemetryResponse) {
	res.OSSource = "generic:runtime-fallback"
}
