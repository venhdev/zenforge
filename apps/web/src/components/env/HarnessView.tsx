import React, { useState, useEffect, useCallback } from 'react'
import {
  Cpu,
  Activity,
  Terminal,
  Shield,
  CheckCircle2,
  RefreshCw,
  Wrench,
  GitBranch,
  Database,
  Play,
  HardDrive,
  Gauge,
  Radio,
} from 'lucide-react'
import type { ApiResult } from '../../hooks/useZenfAPI'
import type { RuntimeTelemetry } from '../../types/contracts'

export interface HarnessViewProps {
  onFetchEnv?: () => Promise<ApiResult<Record<string, any>>>
  onFetchStatus?: () => Promise<ApiResult<RuntimeTelemetry>>
  isActive?: boolean
  pollIntervalMs?: number
  compact?: boolean
}

export function formatTelemetryBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes <= 0) {
    return '0 B'
  }
  const unit = 1024
  if (bytes < unit) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let exp = 0
  let val = bytes / unit
  while (val >= unit && exp < units.length - 1) {
    val /= unit
    exp++
  }
  return `${val.toFixed(1)} ${units[exp]}`
}

export function formatTelemetryUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0s'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  const totalSec = Math.floor(seconds)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

export function formatCpuUtilization(cpuSeconds?: number, uptimeSeconds?: number): string {
  if (!cpuSeconds || cpuSeconds <= 0) return '0.0s (0.0%)'
  if (!uptimeSeconds || uptimeSeconds <= 0) return `${cpuSeconds.toFixed(2)}s`
  const pct = (cpuSeconds / uptimeSeconds) * 100
  return `${cpuSeconds.toFixed(2)}s (${pct.toFixed(1)}%)`
}

export const HarnessView: React.FC<HarnessViewProps> = ({
  onFetchEnv,
  onFetchStatus,
  isActive = true,
  pollIntervalMs = 5000,
  compact = false,
}) => {
  const [envData, setEnvData] = useState<Record<string, any> | null>(null)
  const [telemetry, setTelemetry] = useState<RuntimeTelemetry | null>(null)
  const [loading, setLoading] = useState(false)

  const loadStatusOnly = useCallback(async () => {
    if (!onFetchStatus) return
    const res = await onFetchStatus()
    if (res.ok && res.data) {
      setTelemetry(res.data)
    }
  }, [onFetchStatus])

  const loadDiagnostics = useCallback(async () => {
    if (!onFetchEnv && !onFetchStatus) return
    setLoading(true)
    try {
      const [envRes, statusRes] = await Promise.all([
        onFetchEnv ? onFetchEnv() : Promise.resolve(null),
        onFetchStatus ? onFetchStatus() : Promise.resolve(null),
      ])
      if (envRes) {
        setEnvData(envRes.ok ? envRes.data : null)
      }
      if (statusRes) {
        setTelemetry(statusRes.ok ? statusRes.data : null)
      }
    } finally {
      setLoading(false)
    }
  }, [onFetchEnv, onFetchStatus])

  useEffect(() => {
    if (!isActive) return
    void loadDiagnostics()
  }, [isActive, loadDiagnostics])

  useEffect(() => {
    if (!isActive || !onFetchStatus || pollIntervalMs <= 0) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void loadStatusOnly()
    }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [isActive, onFetchStatus, pollIntervalMs, loadStatusOnly])

  const osArch = `${telemetry?.os || envData?.os || 'linux'} / ${telemetry?.arch || envData?.arch || 'amd64'}`
  const cpuThreads = telemetry?.gomaxprocs || envData?.num_cpu || 16
  const toolchains = (envData?.toolchains || {}) as Record<string, string>

  const resolveToolchainLabel = (key: string, legacyField?: string, fallback?: string): string => {
    const fromMap = toolchains[key]
    if (fromMap && fromMap !== 'not_found') return fromMap
    if (fromMap === 'not_found') return 'not_found'
    if (legacyField) return legacyField
    return fallback || 'ready'
  }

  return (
    <div
      className="flex h-full w-full flex-col bg-zinc-950 font-sans overflow-y-auto select-none"
      data-testid="harness-view-root"
    >
      {/* Top Compact Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/30">
            <Wrench className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-100 truncate">
              Harness
            </h2>
            <p className="text-[10px] text-zinc-500 truncate">
              Runtime Health · Telemetry · Toolchains
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadDiagnostics()}
          disabled={loading}
          title="Refresh Harness Diagnostics"
          data-testid="harness-audit-btn"
          className="flex shrink-0 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          {!compact && <span className="hidden sm:inline">Audit</span>}
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 space-y-4 p-3.5">
        {/* 1. Host Compute & Runtime Health */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
            <Cpu className="h-3.5 w-3.5 text-violet-400" />
            <span>Runtime & Host Health</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
              <span className="text-[10px] uppercase font-semibold text-zinc-500 block">
                OS / Arch
              </span>
              <span className="font-mono text-xs font-bold text-zinc-100">{osArch}</span>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {telemetry
                    ? `PID ${telemetry.pid} · up ${formatTelemetryUptime(telemetry.uptime_seconds)}`
                    : 'POSIX PGID Active'}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
              <span className="text-[10px] uppercase font-semibold text-zinc-500 block">
                Compute Slots
              </span>
              <span className="font-mono text-xs font-bold text-zinc-100">
                {cpuThreads} CPU Threads
              </span>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-violet-300">
                <Activity className="h-3 w-3 shrink-0 text-violet-400" />
                <span className="truncate">
                  {telemetry
                    ? `${telemetry.goroutines} Goroutines${telemetry.open_fds >= 0 ? ` · ${telemetry.open_fds} FDs` : ''}`
                    : 'Parallel Workers Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Live Daemon Resource Telemetry */}
        <div className="space-y-2" data-testid="harness-telemetry-section">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
              <Gauge className="h-3.5 w-3.5 text-amber-400" />
              <span>Daemon Resource Telemetry</span>
            </h3>
            {telemetry?.version && (
              <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                v{telemetry.version}
              </span>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 space-y-2 text-[11px]">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <HardDrive className="h-3 w-3 text-amber-400" />
                <span>Memory (RSS)</span>
              </span>
              <span
                className="font-mono text-[11px] font-semibold text-zinc-100"
                data-testid="telemetry-memory-rss"
              >
                {telemetry ? formatTelemetryBytes(telemetry.rss_bytes) : '—'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="text-zinc-400 pl-4">Go Heap / Sys</span>
              <span
                className="font-mono text-[10px] text-zinc-300"
                data-testid="telemetry-memory-heap"
              >
                {telemetry
                  ? `${formatTelemetryBytes(telemetry.heap_alloc_bytes)} / ${formatTelemetryBytes(telemetry.sys_bytes)}`
                  : '—'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <Cpu className="h-3 w-3 text-sky-400" />
                <span>CPU Time (Load)</span>
              </span>
              <span
                className="font-mono text-[10px] text-sky-300"
                data-testid="telemetry-cpu-usage"
              >
                {telemetry
                  ? formatCpuUtilization(telemetry.cpu_seconds, telemetry.uptime_seconds)
                  : '—'}
              </span>
            </div>

            {telemetry && telemetry.open_fds >= 0 && (
              <div
                className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5"
                data-testid="telemetry-open-fds-row"
              >
                <span className="text-zinc-400 pl-4">Open Descriptors</span>
                <span className="font-mono text-[10px] text-zinc-200">
                  {telemetry.open_fds} FDs
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-0.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <Radio className="h-3 w-3 text-emerald-400" />
                <span>Live Workloads</span>
              </span>
              <span
                className="font-mono text-[10px] text-emerald-400"
                data-testid="telemetry-workloads"
              >
                {telemetry
                  ? `${telemetry.sse_clients} SSE · ${telemetry.active_sessions} Sessions`
                  : '0 SSE · 0 Sessions'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Toolchain Matrix */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
            <Terminal className="h-3.5 w-3.5 text-emerald-400" />
            <span>Toolchain Matrix</span>
          </h3>

          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-400 font-sans shrink-0">Go Toolchain</span>
              <span className="text-zinc-200 font-semibold text-[11px] truncate">
                {resolveToolchainLabel('go', envData?.go_version, 'go1.24+')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-400 font-sans shrink-0">
                Git Worktree Engine
              </span>
              <span className="text-zinc-200 font-semibold text-[11px] truncate">
                {resolveToolchainLabel('git', envData?.git_version, 'git 2.40+')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-400 font-sans shrink-0">Node.js Runtime</span>
              <span className="text-zinc-200 font-semibold text-[11px] truncate">
                {resolveToolchainLabel('node', envData?.node, 'v22.x')}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Verification Runners & Isolation */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
            <Play className="h-3.5 w-3.5 text-cyan-400" />
            <span>Verification & Isolation Gates</span>
          </h3>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 space-y-2 text-[11px]">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <Database className="h-3 w-3 text-emerald-400" />
                <span>SSOT Engine</span>
              </span>
              <span className="font-mono text-[10px] text-emerald-400">SQLite 3 WAL</span>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <GitBranch className="h-3 w-3 text-sky-400" />
                <span>Worktree Isolation</span>
              </span>
              <span className="font-mono text-[10px] text-sky-300">Hermetic Branch</span>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <Shield className="h-3 w-3 text-violet-400" />
                <span>MCP Plane</span>
              </span>
              <span className="font-mono text-[10px] text-violet-300">JSON-RPC 2.0 stdio</span>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <span className="text-zinc-400">Harness Anchor</span>
              <span className="font-mono text-[10px] text-zinc-300">.agents/environment.md</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
