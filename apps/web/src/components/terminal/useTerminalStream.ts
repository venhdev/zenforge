import { useEffect, useRef, useState, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'

export const OPCODES = {
  DATA: 0x00,
  RESIZE: 0x01,
  PAUSE: 0x02,
  RESUME: 0x03,
  PING: 0x04,
  EXIT: 0x05,
} as const

export type TerminalStreamStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'exited'

export interface UseTerminalStreamOptions {
  sessionId: string | null
  terminal: Terminal | null
  mode?: 'HEADLESS' | 'INTERACTIVE'
  onExit?: (code: number) => void
  onStatusChange?: (status: TerminalStreamStatus) => void
}

export interface UseTerminalStreamReturn {
  status: TerminalStreamStatus
  exitCode: number | null
  sendInput: (data: string | Uint8Array) => void
  sendResize: (cols: number, rows: number) => void
}

const HIGH_WATERMARK = 1024 * 1024 // 1 MB
const LOW_WATERMARK = 256 * 1024   // 256 KB

export function useTerminalStream({
  sessionId,
  terminal,
  mode = 'HEADLESS',
  onExit,
  onStatusChange,
}: UseTerminalStreamOptions): UseTerminalStreamReturn {
  const [status, setStatus] = useState<TerminalStreamStatus>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const pendingBytesRef = useRef<number>(0)
  const isPausedRef = useRef<boolean>(false)

  // Status reporter helper
  const updateStatus = useCallback(
    (newStatus: TerminalStreamStatus) => {
      setStatus(newStatus)
      onStatusChange?.(newStatus)
    },
    [onStatusChange]
  )

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (mode !== 'INTERACTIVE') return

      const frame = new Uint8Array(5)
      frame[0] = OPCODES.RESIZE
      const view = new DataView(frame.buffer)
      view.setUint16(1, cols, false)
      view.setUint16(3, rows, false)
      ws.send(frame)
    },
    [mode]
  )

  const sendInput = useCallback(
    (data: string | Uint8Array) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (mode !== 'INTERACTIVE') return

      const encoder = new TextEncoder()
      const rawBytes = typeof data === 'string' ? encoder.encode(data) : data
      const frame = new Uint8Array(1 + rawBytes.byteLength)
      frame[0] = OPCODES.DATA
      frame.set(rawBytes, 1)
      ws.send(frame)
    },
    [mode]
  )

  useEffect(() => {
    if (!sessionId || !terminal) {
      updateStatus('idle')
      return
    }

    updateStatus('connecting')
    setExitCode(null)
    pendingBytesRef.current = 0
    isPausedRef.current = false

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/api/v1/sessions/${sessionId}/terminal`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const sendFlowControl = (opcode: number) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new Uint8Array([opcode]))
      }
    }

    ws.onopen = () => {
      updateStatus('connected')
      // Send initial terminal dimensions if interactive
      if (mode === 'INTERACTIVE' && terminal.cols && terminal.rows) {
        sendResize(terminal.cols, terminal.rows)
      }
    }

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return

      const view = new Uint8Array(event.data)
      if (view.length === 0) return

      const opcode = view[0]
      const payload = view.subarray(1)

      switch (opcode) {
        case OPCODES.DATA: {
          const byteLen = payload.byteLength
          pendingBytesRef.current += byteLen

          if (pendingBytesRef.current > HIGH_WATERMARK && !isPausedRef.current) {
            isPausedRef.current = true
            sendFlowControl(OPCODES.PAUSE)
          }

          terminal.write(payload, () => {
            pendingBytesRef.current -= byteLen
            if (pendingBytesRef.current < LOW_WATERMARK && isPausedRef.current) {
              isPausedRef.current = false
              sendFlowControl(OPCODES.RESUME)
            }
          })
          break
        }
        case OPCODES.EXIT: {
          const code = payload.length > 0 ? payload[0] : 0
          setExitCode(code)
          updateStatus('exited')
          onExit?.(code)
          break
        }
        case OPCODES.PING:
          // Echo keepalive if needed
          break
      }
    }

    ws.onerror = () => {
      updateStatus('error')
    }

    ws.onclose = () => {
      setStatus((prev) => (prev === 'exited' ? 'exited' : 'disconnected'))
    }

    // Attach keystroke handler for interactive mode
    const dataDisposable = terminal.onData((data: string) => {
      if (mode === 'INTERACTIVE') {
        sendInput(data)
      }
    })

    return () => {
      dataDisposable.dispose()
      ws.close()
      wsRef.current = null
    }
  }, [sessionId, terminal, mode, sendInput, sendResize, updateStatus, onExit])

  return {
    status,
    exitCode,
    sendInput,
    sendResize,
  }
}
