import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClipboardCopy } from './useClipboardCopy'

describe('useClipboardCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets copied state and resets after delay', async () => {
    const { result } = renderHook(() => useClipboardCopy({ resetDelayMs: 1000 }))

    expect(result.current.isCopied()).toBe(false)

    await act(async () => {
      await result.current.copy('test text')
    })

    expect(result.current.isCopied()).toBe(true)
    expect(result.current.copiedKey).toBe('default')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.isCopied()).toBe(false)
    expect(result.current.copiedKey).toBeNull()
  })

  it('supports discriminating keys for multiple copy buttons', async () => {
    const { result } = renderHook(() => useClipboardCopy())

    await act(async () => {
      await result.current.copy('task-123', 'taskId')
    })

    expect(result.current.isCopied('taskId')).toBe(true)
    expect(result.current.isCopied('notes')).toBe(false)
  })

  it('cleans up timeout on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { result, unmount } = renderHook(() => useClipboardCopy())

    await act(async () => {
      await result.current.copy('some text')
    })

    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
