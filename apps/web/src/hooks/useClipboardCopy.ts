import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseClipboardCopyOptions {
  resetDelayMs?: number
}

/**
 * Hook to manage clipboard writes and transient "Copied" feedback state
 * with guaranteed unmount cleanup.
 */
export function useClipboardCopy(options: UseClipboardCopyOptions = {}) {
  const { resetDelayMs = 2000 } = options
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  const copy = useCallback(
    async (text: string, key = 'default'): Promise<boolean> => {
      clearTimer()
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text)
        }
        setCopiedKey(key)
        timerRef.current = setTimeout(() => {
          setCopiedKey(null)
          timerRef.current = null
        }, resetDelayMs)
        return true
      } catch {
        return false
      }
    },
    [clearTimer, resetDelayMs]
  )

  const isCopied = useCallback(
    (key = 'default') => copiedKey === key,
    [copiedKey]
  )

  const reset = useCallback(() => {
    clearTimer()
    setCopiedKey(null)
  }, [clearTimer])

  return {
    copiedKey,
    isCopied,
    copy,
    reset,
  }
}
