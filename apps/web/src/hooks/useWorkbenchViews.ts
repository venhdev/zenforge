import { useCallback, useMemo, useState } from 'react'
import type { WorkbenchPanelId } from '../components/workbench/panelRegistry'

/** Persisted set of views the user has enabled in the HeaderBar "Panels" menu. */
export const WORKBENCH_VIEWS_STORAGE_KEY = 'zenf_workbench_views_v1'

export const ALL_WORKBENCH_VIEW_IDS: WorkbenchPanelId[] = [
  'explorer',
  'resources',
  'harness',
  'console',
  'stage',
  'inspector',
]

function readEnabledViews(): WorkbenchPanelId[] {
  try {
    const raw = localStorage.getItem(WORKBENCH_VIEWS_STORAGE_KEY)
    if (!raw) return [...ALL_WORKBENCH_VIEW_IDS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...ALL_WORKBENCH_VIEW_IDS]
    const known = new Set<string>(ALL_WORKBENCH_VIEW_IDS)
    const filtered = parsed.filter((id): id is WorkbenchPanelId => typeof id === 'string' && known.has(id))
    // An unreadable or emptied payload must never leave the cockpit with no views.
    return filtered.length > 0 ? filtered : [...ALL_WORKBENCH_VIEW_IDS]
  } catch {
    return [...ALL_WORKBENCH_VIEW_IDS]
  }
}

function persistEnabledViews(views: WorkbenchPanelId[]): void {
  try {
    localStorage.setItem(WORKBENCH_VIEWS_STORAGE_KEY, JSON.stringify(views))
  } catch {
    // UI preference persistence is best-effort.
  }
}

export interface WorkbenchViewsState {
  enabledViews: WorkbenchPanelId[]
  enabledMap: Record<WorkbenchPanelId, boolean>
  setViewEnabled: (panelId: WorkbenchPanelId, enabled: boolean) => void
  resetViews: () => void
}

/**
 * Owns the enabled/disabled axis of the workbench views, which is deliberately
 * separate from whether a panel is currently open in the layout:
 * - disabled => removed from the Panels menu list and from the ActivityBar rail
 * - enabled but closed => rail icon stays, dimmed; clicking reopens the panel
 */
export function useWorkbenchViews(): WorkbenchViewsState {
  const [enabledViews, setEnabledViews] = useState<WorkbenchPanelId[]>(() => readEnabledViews())

  const setViewEnabled = useCallback((panelId: WorkbenchPanelId, enabled: boolean) => {
    setEnabledViews((prev) => {
      if (enabled === prev.includes(panelId)) return prev
      const next = enabled
        ? [...prev.filter((id) => id !== panelId), panelId]
        : prev.filter((id) => id !== panelId)
      persistEnabledViews(next)
      return next
    })
  }, [])

  const resetViews = useCallback(() => {
    const next = [...ALL_WORKBENCH_VIEW_IDS]
    persistEnabledViews(next)
    setEnabledViews(next)
  }, [])

  const enabledMap = useMemo(() => {
    const map = {} as Record<WorkbenchPanelId, boolean>
    for (const id of ALL_WORKBENCH_VIEW_IDS) map[id] = enabledViews.includes(id)
    return map
  }, [enabledViews])

  return { enabledViews, enabledMap, setViewEnabled, resetViews }
}
