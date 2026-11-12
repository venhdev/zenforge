import { useState, useEffect, useCallback, useRef } from 'react'
import { useSSE } from './useSSE'
import type { EventMessage } from '../types/contracts'

interface UseWorkspaceLiveSyncOptions {
  onRefreshData: () => void | Promise<void>
  onRefreshProjects: () => void | Promise<void>
  onRefreshResources: () => void | Promise<void>
}

export function useWorkspaceLiveSync({
  onRefreshData,
  onRefreshProjects,
  onRefreshResources,
}: UseWorkspaceLiveSyncOptions) {
  const [logTick, setLogTick] = useState(0)
  const refreshTimerRef = useRef<number | null>(null)

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void onRefreshData()
    }, 120)
  }, [onRefreshData])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  const handleSSEEvent = useCallback(
    (event: EventMessage) => {
      const type = event.type
      if (type.startsWith('task.') || type.startsWith('plan.') || type === 'state.changed') {
        scheduleRefresh()
      } else if (type.startsWith('project.')) {
        void onRefreshProjects()
      } else if (type.startsWith('resource.')) {
        void onRefreshResources()
      }
      setLogTick((t) => t + 1)
    },
    [scheduleRefresh, onRefreshProjects, onRefreshResources]
  )

  const { connected } = useSSE({
    onEvent: handleSSEEvent,
  })

  return {
    connected,
    logTick,
    scheduleRefresh,
  }
}
