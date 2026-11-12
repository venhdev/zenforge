import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import {
  HarnessView,
  formatTelemetryBytes,
  formatTelemetryUptime,
  formatCpuUtilization,
} from './HarnessView'
import type { RuntimeTelemetry } from '../../types/contracts'

const mockTelemetry: RuntimeTelemetry = {
  pid: 9940,
  version: '0.5.0',
  os: 'linux',
  arch: 'amd64',
  started_at: '2026-11-11T03:44:50Z',
  uptime_seconds: 3725, // 1h 2m 5s
  goroutines: 18,
  gomaxprocs: 16,
  heap_alloc_bytes: 4 * 1024 * 1024, // 4.0 MB
  heap_inuse_bytes: 6 * 1024 * 1024,
  sys_bytes: 16 * 1024 * 1024, // 16.0 MB
  stack_inuse_bytes: 512 * 1024,
  rss_bytes: 28 * 1024 * 1024, // 28.0 MB
  cpu_seconds: 37.25, // 1.0% of 3725s
  go_cpu_user_seconds: 30.0,
  go_cpu_gc_seconds: 2.5,
  go_cpu_total_seconds: 32.5,
  open_fds: 29,
  os_source: 'linux:/proc+getrusage',
  sse_clients: 2,
  active_sessions: 1,
}

describe('HarnessView formatting helpers', () => {
  it('formats bytes accurately across units', () => {
    expect(formatTelemetryBytes(0)).toBe('0 B')
    expect(formatTelemetryBytes(512)).toBe('512 B')
    expect(formatTelemetryBytes(2048)).toBe('2.0 KB')
    expect(formatTelemetryBytes(28 * 1024 * 1024)).toBe('28.0 MB')
  })

  it('formats uptime duration across seconds, minutes, hours, and days', () => {
    expect(formatTelemetryUptime(0)).toBe('0s')
    expect(formatTelemetryUptime(0.25)).toBe('250ms')
    expect(formatTelemetryUptime(45)).toBe('45s')
    expect(formatTelemetryUptime(125)).toBe('2m 5s')
    expect(formatTelemetryUptime(3725)).toBe('1h 2m 5s')
    expect(formatTelemetryUptime(90060)).toBe('1d 1h 1m')
  })

  it('formats CPU utilization with percentage', () => {
    expect(formatCpuUtilization(0, 100)).toBe('0.0s (0.0%)')
    expect(formatCpuUtilization(12.5, 100)).toBe('12.50s (12.5%)')
  })
})

describe('HarnessView component', () => {
  it('fetches and displays live daemon runtime telemetry and toolchains', async () => {
    const onFetchEnv = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        os: 'linux',
        arch: 'amd64',
        num_cpu: 16,
        toolchains: {
          go: '/usr/local/go/bin/go',
          git: '/usr/bin/git',
          node: '/usr/bin/node',
        },
      },
    })
    const onFetchStatus = vi.fn().mockResolvedValue({
      ok: true,
      data: mockTelemetry,
    })

    render(
      <HarnessView
        onFetchEnv={onFetchEnv}
        onFetchStatus={onFetchStatus}
        pollIntervalMs={0}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('telemetry-memory-rss').textContent).toBe('28.0 MB')
    })

    expect(screen.getByTestId('telemetry-memory-heap').textContent).toBe('4.0 MB / 16.0 MB')
    expect(screen.getByTestId('telemetry-cpu-usage').textContent).toBe('37.25s (1.0%)')
    expect(screen.getByTestId('telemetry-workloads').textContent).toBe('2 SSE · 1 Sessions')
    expect(screen.getByTestId('telemetry-open-fds-row').textContent).toContain('29 FDs')
    expect(screen.getByText('PID 9940 · up 1h 2m 5s')).toBeDefined()
    expect(screen.getByText('/usr/local/go/bin/go')).toBeDefined()
  })

  it('hides Open Descriptors row when open_fds is -1 (unsupported platform)', async () => {
    const onFetchStatus = vi.fn().mockResolvedValue({
      ok: true,
      data: { ...mockTelemetry, open_fds: -1 },
    })

    render(<HarnessView onFetchStatus={onFetchStatus} pollIntervalMs={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('telemetry-memory-rss').textContent).toBe('28.0 MB')
    })

    expect(screen.queryByTestId('telemetry-open-fds-row')).toBeNull()
  })

  it('polls onFetchStatus only when isActive is true and refreshes on Audit click', async () => {
    vi.useFakeTimers()
    try {
      const onFetchEnv = vi.fn().mockResolvedValue({ ok: true, data: {} })
      const onFetchStatus = vi.fn().mockResolvedValue({ ok: true, data: mockTelemetry })

      const { rerender } = render(
        <HarnessView
          onFetchEnv={onFetchEnv}
          onFetchStatus={onFetchStatus}
          isActive={false}
          pollIntervalMs={1000}
        />
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(onFetchStatus).toHaveBeenCalledTimes(0)
      expect(onFetchEnv).toHaveBeenCalledTimes(0)

      // Advance time while inactive -> should NOT poll
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(onFetchStatus).toHaveBeenCalledTimes(0)

      // Activate panel -> loads diagnostics immediately and polls every 1000ms
      rerender(
        <HarnessView
          onFetchEnv={onFetchEnv}
          onFetchStatus={onFetchStatus}
          isActive={true}
          pollIntervalMs={1000}
        />
      )
      await act(async () => {
        await Promise.resolve()
      })

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      expect(onFetchStatus).toHaveBeenCalledTimes(3)

      // Clicking Audit triggers both env and status refresh
      await act(async () => {
        fireEvent.click(screen.getByTestId('harness-audit-btn'))
      })
      expect(onFetchEnv).toHaveBeenCalledTimes(2)
      expect(onFetchStatus).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
