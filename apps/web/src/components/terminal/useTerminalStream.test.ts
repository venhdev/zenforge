import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTerminalStream, OPCODES } from './useTerminalStream'
import type { Terminal } from '@xterm/xterm'

describe('useTerminalStream', () => {
  let mockWebSocketInstances: any[] = []
  let originalWebSocket: any

  beforeEach(() => {
    mockWebSocketInstances = []
    originalWebSocket = globalThis.WebSocket

    // Mock WebSocket implementation
    class MockWebSocket {
      url: string
      binaryType: string = 'blob'
      readyState: number = 0 // CONNECTING
      onopen: (() => void) | null = null
      onmessage: ((event: { data: any }) => void) | null = null
      onerror: ((event: any) => void) | null = null
      onclose: (() => void) | null = null
      sentMessages: any[] = []

      static OPEN = 1
      static CLOSED = 3

      constructor(url: string) {
        this.url = url
        mockWebSocketInstances.push(this)
      }

      send(data: any) {
        this.sentMessages.push(data)
      }

      close() {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
      }
    }

    // @ts-ignore
    global.WebSocket = MockWebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('remains idle when sessionId or terminal is null', () => {
    const { result } = renderHook(() =>
      useTerminalStream({
        sessionId: null,
        terminal: null,
        mode: 'HEADLESS',
      })
    )

    expect(result.current.status).toBe('idle')
    expect(mockWebSocketInstances.length).toBe(0)
  })

  it('connects to session WebSocket and delivers data frames to terminal', () => {
    const writtenChunks: any[] = []
    const mockTerminal = {
      cols: 80,
      rows: 24,
      write: vi.fn((data: any, cb?: () => void) => {
        writtenChunks.push(data)
        cb?.()
      }),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as Terminal

    const { result } = renderHook(() =>
      useTerminalStream({
        sessionId: 'session-xyz',
        terminal: mockTerminal,
        mode: 'HEADLESS',
      })
    )

    expect(mockWebSocketInstances.length).toBe(1)
    const ws = mockWebSocketInstances[0]
    expect(ws.url).toContain('/api/v1/sessions/session-xyz/terminal')

    // Simulate connection open
    act(() => {
      ws.readyState = 1 // OPEN
      ws.onopen?.()
    })
    expect(result.current.status).toBe('connected')

    // Simulate incoming data frame [0x00, 'H', 'i']
    const dataPayload = new Uint8Array([OPCODES.DATA, 72, 105]).buffer
    act(() => {
      ws.onmessage?.({ data: dataPayload })
    })

    expect(mockTerminal.write).toHaveBeenCalled()
    expect(writtenChunks.length).toBe(1)
    expect(new TextDecoder().decode(writtenChunks[0])).toBe('Hi')
  })

  it('handles exit code opcode and updates status', () => {
    const onExit = vi.fn()
    const mockTerminal = {
      cols: 80,
      rows: 24,
      write: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as Terminal

    const { result } = renderHook(() =>
      useTerminalStream({
        sessionId: 'session-exit-test',
        terminal: mockTerminal,
        mode: 'HEADLESS',
        onExit,
      })
    )

    const ws = mockWebSocketInstances[0]

    // Simulate exit frame [0x05, 0]
    const exitPayload = new Uint8Array([OPCODES.EXIT, 0]).buffer
    act(() => {
      ws.onmessage?.({ data: exitPayload })
    })

    expect(result.current.status).toBe('exited')
    expect(result.current.exitCode).toBe(0)
    expect(onExit).toHaveBeenCalledWith(0)
  })

  it('sends resize and input when in INTERACTIVE mode', () => {
    let dataListener: (data: string) => void = () => {}
    const mockTerminal = {
      cols: 120,
      rows: 40,
      write: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        dataListener = listener
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal

    renderHook(() =>
      useTerminalStream({
        sessionId: 'session-interactive',
        terminal: mockTerminal,
        mode: 'INTERACTIVE',
      })
    )

    const ws = mockWebSocketInstances[0]
    act(() => {
      ws.readyState = 1
      ws.onopen?.()
    })

    // Should have sent resize frame on open: [0x01, cols_hi, cols_lo, rows_hi, rows_lo]
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1)
    const resizeMsg = ws.sentMessages[0]
    expect(resizeMsg[0]).toBe(OPCODES.RESIZE)

    // Simulate typing in terminal
    act(() => {
      dataListener('ls -la\n')
    })

    // Should forward input with 0x00 opcode
    const lastMsg = ws.sentMessages[ws.sentMessages.length - 1]
    expect(lastMsg[0]).toBe(OPCODES.DATA)
    expect(new TextDecoder().decode(lastMsg.subarray(1))).toBe('ls -la\n')
  })

  it('ignores typing in HEADLESS mode', () => {
    let dataListener: (data: string) => void = () => {}
    const mockTerminal = {
      cols: 80,
      rows: 24,
      write: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        dataListener = listener
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal

    renderHook(() =>
      useTerminalStream({
        sessionId: 'session-headless',
        terminal: mockTerminal,
        mode: 'HEADLESS',
      })
    )

    const ws = mockWebSocketInstances[0]
    act(() => {
      ws.readyState = 1
      ws.onopen?.()
    })

    // Typing should not produce any sent messages in headless mode
    const msgCountBefore = ws.sentMessages.length
    act(() => {
      dataListener('rm -rf /\n')
    })
    expect(ws.sentMessages.length).toBe(msgCountBefore)
  })
})
