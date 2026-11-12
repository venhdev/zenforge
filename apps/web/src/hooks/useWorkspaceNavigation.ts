import { useState, useEffect } from 'react'

const PROJECT_STORAGE_KEY = 'zenf_active_project'
const PLAN_STORAGE_KEY = 'zenf_active_plan'
const TASK_STORAGE_KEY = 'zenf_selected_task'

export function getInitialURLParam(key: string, storageKey: string): string | null {
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = params.get(key)
      if (fromUrl) return fromUrl
      const fromStorage = localStorage.getItem(storageKey)
      if (fromStorage) return fromStorage
    }
  } catch {
    // ignore
  }
  return null
}

export interface FocusTarget {
  id: string
  timestamp: number
}

export interface NavigationResolution {
  /** The project list has loaded, so `project` can be validated. */
  project?: boolean
  /** The active plan and its tasks have loaded, so `plan` and `task` can be validated. */
  selection?: boolean
}

/**
 * Keeps the workspace selection in sync with the URL.
 *
 * A value that exists is always written to the URL. A value that is absent is
 * only *removed* once the corresponding data has loaded (`resolution`), so a
 * deep link survives the first render and a stale link left behind by a reset
 * database does not outlive the session.
 */
export function useWorkspaceNavigation(
  activePlanSlug?: string | null,
  resolution: NavigationResolution = {}
) {
  const projectResolved = resolution.project === true
  const selectionResolved = resolution.selection === true

  const [activeProjectSlug, setActiveProjectSlug] = useState<string | null>(() =>
    getInitialURLParam('project', PROJECT_STORAGE_KEY)
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    getInitialURLParam('task', TASK_STORAGE_KEY)
  )
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)

  // LocalStorage synchronizations
  useEffect(() => {
    try {
      if (activeProjectSlug) {
        localStorage.setItem(PROJECT_STORAGE_KEY, activeProjectSlug)
      } else if (projectResolved) {
        localStorage.removeItem(PROJECT_STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }, [activeProjectSlug, projectResolved])

  useEffect(() => {
    try {
      if (activePlanSlug) {
        localStorage.setItem(PLAN_STORAGE_KEY, activePlanSlug)
      } else if (selectionResolved) {
        localStorage.removeItem(PLAN_STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }, [activePlanSlug, selectionResolved])

  useEffect(() => {
    try {
      if (selectedTaskId) {
        localStorage.setItem(TASK_STORAGE_KEY, selectedTaskId)
      } else if (selectionResolved) {
        localStorage.removeItem(TASK_STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }, [selectedTaskId, selectionResolved])

  // Sync active state to URL search parameters without page reload
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    let changed = false

    const sync = (key: string, value: string | null, resolved: boolean) => {
      if (value) {
        if (params.get(key) !== value) {
          params.set(key, value)
          changed = true
        }
        return
      }
      if (resolved && params.has(key)) {
        params.delete(key)
        changed = true
      }
    }

    sync('project', activeProjectSlug, projectResolved)
    sync('plan', activePlanSlug || null, selectionResolved)
    sync('task', selectedTaskId, selectionResolved)

    if (changed) {
      const newQuery = params.toString()
      const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', newUrl)
    }
  }, [activeProjectSlug, activePlanSlug, selectedTaskId, projectResolved, selectionResolved])

  return {
    activeProjectSlug,
    setActiveProjectSlug,
    selectedTaskId,
    setSelectedTaskId,
    focusTarget,
    setFocusTarget,
  }
}
