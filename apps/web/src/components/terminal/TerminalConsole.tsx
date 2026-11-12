import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  Terminal as TerminalIcon,
  X,
  Trash2,
  Square,
  Lock,
  Radio,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { useTerminalStream, type TerminalStreamStatus } from './useTerminalStream'

export interface TerminalConsoleProps {
  sessionId: string | null
  taskTitle?: string
  mode?: 'HEADLESS' | 'INTERACTIVE'
  onClose?: () => void
  onAbort?: () => void
  isDrawer?: boolean
  className?: string
}

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  sessionId,
  taskTitle,
  mode = 'HEADLESS',
  onClose,
  onAbort,
  isDrawer = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [terminalReady, setTerminalReady] = useState(false)

  // Initialize xterm instance
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: mode === 'INTERACTIVE',
      disableStdin: mode === 'HEADLESS',
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: 1.2,
      convertEol: true,
      theme: {
        background: '#09090b', // zinc-950
        foreground: '#e4e4e7', // zinc-200
        cursor: mode === 'INTERACTIVE' ? '#10b981' : '#71717a', // emerald-500 or zinc-500
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#18181b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#0ea5e9',
        brightWhite: '#ffffff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(containerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon
    setTerminalReady(true)

    try {
      fitAddon.fit()
    } catch {
      // container might have 0 dimensions initially
    }

    const resizeObserver = new ResizeObserver(() => {
      try {
        if (termRef.current && fitAddonRef.current) {
          fitAddonRef.current.fit()
        }
      } catch {
        // ignore layout pass errors
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      setTerminalReady(false)
    }
  }, [mode])

  // Wire WebSocket streaming
  const { status, exitCode, sendResize } = useTerminalStream({
    sessionId,
    terminal: terminalReady ? termRef.current : null,
    mode,
  })

  // Synchronize terminal resize with remote PTY master
  useEffect(() => {
    if (status === 'connected' && termRef.current && mode === 'INTERACTIVE') {
      sendResize(termRef.current.cols, termRef.current.rows)
    }
  }, [status, mode, sendResize])

  const handleClear = useCallback(() => {
    termRef.current?.clear()
  }, [])

  const getStatusBadge = (s: TerminalStreamStatus, exit: number | null) => {
    switch (s) {
      case 'connecting':
        return (
          <span className="flex items-center gap-1.5 text-amber-400 font-medium">
            <Radio className="h-3 w-3 animate-spin" />
            Connecting...
          </span>
        )
      case 'connected':
        return (
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )
      case 'exited':
        return (
          <span className="flex items-center gap-1.5 font-medium">
            {exit === 0 ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Exit (0)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-400">
                <AlertTriangle className="h-3 w-3" />
                Exit ({exit})
              </span>
            )}
          </span>
        )
      case 'disconnected':
        return (
          <span className="flex items-center gap-1.5 text-zinc-500 font-medium">
            <span className="h-2 w-2 rounded-full bg-zinc-600" />
            Disconnected
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-1.5 text-rose-400 font-medium">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Error
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-1.5 text-zinc-500 font-medium">
            <span className="h-2 w-2 rounded-full bg-zinc-600" />
            Idle
          </span>
        )
    }
  }

  return (
    <div
      className={`flex flex-col h-full w-full bg-zinc-950 border-zinc-800 text-zinc-200 select-none ${
        isDrawer ? 'border-t shadow-2xl' : 'border-l'
      } ${className}`}
    >
      {/* Terminal Title Bar */}
      <div className="flex h-9 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-3 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <TerminalIcon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <span className="font-semibold text-zinc-100 truncate">
            {taskTitle ? `Terminal: ${taskTitle}` : 'Worker Terminal'}
          </span>

          {sessionId && (
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 shrink-0">
              {sessionId.slice(0, 8)}
            </span>
          )}

          {/* Mode Pill */}
          <span
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase shrink-0 ${
              mode === 'INTERACTIVE'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                : 'bg-zinc-800/70 text-zinc-400 border border-zinc-700/60'
            }`}
          >
            {mode === 'HEADLESS' && <Lock className="h-2.5 w-2.5" />}
            {mode}
          </span>
        </div>

        {/* Status + Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-[11px]">{getStatusBadge(status, exitCode)}</div>

          <div className="h-3.5 w-[1px] bg-zinc-800" />

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {status === 'connected' && onAbort && (
              <button
                onClick={onAbort}
                className="flex items-center gap-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium transition"
                title="Abort running process"
              >
                <Square className="h-2.5 w-2.5 fill-rose-400" />
                Abort
              </button>
            )}

            <button
              onClick={handleClear}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
              title="Clear terminal screen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                title="Close terminal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Headless Notice Banner */}
      {mode === 'HEADLESS' && (
        <div className="flex items-center gap-1.5 border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1 text-[11px] text-zinc-400">
          <Lock className="h-3 w-3 text-zinc-500 shrink-0" />
          <span>Headless mode: Input is disabled. Watching execution logs live.</span>
        </div>
      )}

      {/* Terminal Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full p-2 overflow-hidden bg-zinc-950 font-mono text-xs focus:outline-none"
      />
    </div>
  )
}
