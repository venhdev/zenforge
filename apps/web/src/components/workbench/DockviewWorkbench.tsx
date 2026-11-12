import React, { useRef, useCallback, useMemo } from 'react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type DockviewWillShowOverlayLocationEvent,
  type DockviewWillDropEvent,
} from 'dockview-react'
import {
  workbenchComponents,
  WorkbenchProvider,
  DOCKVIEW_PRESERVATION_RENDERER,
  WORKBENCH_VIEW_TITLES,
  type WorkbenchState,
  type WorkbenchPanelId,
} from './panelRegistry'
import { WorkbenchEmptyWatermark } from './WorkbenchEmptyWatermark'
import {
  WORKBENCH_PANEL_CONFIGS,
  WORKBENCH_HOME_ZONES,
  isWorkbenchDropAllowed,
  applyGroupConstraints,
  resolvePanelOpenPosition,
  resolveZoneFallbackAnchor,
  type WorkbenchGroupRole,
  type WorkbenchZonePlacement,
} from './dockviewConstraints'
import './dockviewTheme.css'

export const WORKBENCH_LAYOUT_STORAGE_KEY = 'zenf_workbench_layout_v3'
export const WORKBENCH_ZONE_STORAGE_KEY = 'zenf_workbench_zones_v1'
export const WORKBENCH_THEME_CLASS = 'dockview-theme-zenforge'

export const ALL_WORKBENCH_PANEL_IDS: WorkbenchPanelId[] = [
  'explorer',
  'resources',
  'harness',
  'console',
  'stage',
  'inspector',
]

/**
 * Creates the canonical 4-Group Dynamic Workbench Layout:
 * - Gr-A Top (Left Column, ~75% height): Tabbed group with HierarchyView ('explorer'), ResourcesView ('resources'), HarnessView ('harness')
 * - Gr-A Bottom (Left Column, ~25% height): ActivityView ('console') docked below Gr-A Top
 * - Gr-B Center Stage (100% height): StageView ('stage') docked right of Gr-A
 * - Gr-C Right Column: InspectorView ('inspector') docked right of Gr-B
 * - Gr-D Bottom Dock: Hidden by default (0px)
 */
export function createDefaultLayout(api: DockviewApi) {
  api.clear()

  // Reset root gridview orientation to HORIZONTAL in case Dockview mutated it to VERTICAL
  // when the last remaining group before clearing was a vertically split column (Gr-A Top/Bottom).
  try {
    const gridview = (api as any).component?.gridview
    if (gridview && gridview.orientation === 'VERTICAL') {
      gridview.orientation = 'HORIZONTAL'
    }
  } catch {
    // Gracefully handled in headless test environment
  }

  // 1. Gr-A Top: HierarchyView (Explorer)
  const explorer = api.addPanel({
    id: 'explorer',
    component: 'explorer',
    title: WORKBENCH_VIEW_TITLES.explorer,
    initialWidth: WORKBENCH_PANEL_CONFIGS.explorer.initialWidth,
    minimumWidth: WORKBENCH_PANEL_CONFIGS.explorer.minimumWidth,
    maximumWidth: WORKBENCH_PANEL_CONFIGS.explorer.maximumWidth,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.explorer.minimumHeight,
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // 2. Gr-A Top (Tab 2): ResourcesView
  api.addPanel({
    id: 'resources',
    component: 'resources',
    title: WORKBENCH_VIEW_TITLES.resources,
    initialWidth: WORKBENCH_PANEL_CONFIGS.resources.initialWidth,
    minimumWidth: WORKBENCH_PANEL_CONFIGS.resources.minimumWidth,
    maximumWidth: WORKBENCH_PANEL_CONFIGS.resources.maximumWidth,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.resources.minimumHeight,
    position: {
      referencePanel: 'explorer',
      direction: 'within',
    },
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // 3. Gr-A Top (Tab 3): HarnessView
  api.addPanel({
    id: 'harness',
    component: 'harness',
    title: WORKBENCH_VIEW_TITLES.harness,
    initialWidth: WORKBENCH_PANEL_CONFIGS.harness.initialWidth,
    minimumWidth: WORKBENCH_PANEL_CONFIGS.harness.minimumWidth,
    maximumWidth: WORKBENCH_PANEL_CONFIGS.harness.maximumWidth,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.harness.minimumHeight,
    position: {
      referencePanel: 'explorer',
      direction: 'within',
    },
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // 4. Gr-B Center Stage (100% vertical height): StageView
  const stagePanel = api.addPanel({
    id: 'stage',
    component: 'stage',
    title: WORKBENCH_VIEW_TITLES.stage,
    minimumWidth: WORKBENCH_PANEL_CONFIGS.stage.minimumWidth,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.stage.minimumHeight,
    position: {
      referencePanel: 'explorer',
      direction: 'right',
    },
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // 5. Gr-A Bottom (~25% height under Gr-A Top): ActivityView (Console)
  const consolePanel = api.addPanel({
    id: 'console',
    component: 'console',
    title: WORKBENCH_VIEW_TITLES.console,
    initialHeight: WORKBENCH_PANEL_CONFIGS.console.initialHeight,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.console.minimumHeight,
    maximumHeight: WORKBENCH_PANEL_CONFIGS.console.maximumHeight,
    position: {
      referencePanel: 'explorer',
      direction: 'below',
    },
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // 6. Gr-C Right Column: InspectorView
  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: WORKBENCH_VIEW_TITLES.inspector,
    initialWidth: WORKBENCH_PANEL_CONFIGS.inspector.initialWidth,
    minimumWidth: WORKBENCH_PANEL_CONFIGS.inspector.minimumWidth,
    maximumWidth: WORKBENCH_PANEL_CONFIGS.inspector.maximumWidth,
    minimumHeight: WORKBENCH_PANEL_CONFIGS.inspector.minimumHeight,
    position: {
      referencePanel: 'stage',
      direction: 'right',
    },
    renderer: DOCKVIEW_PRESERVATION_RENDERER,
  })

  // Ensure HierarchyView ('explorer') is the initially active tab in Gr-A Top
  try {
    explorer?.api?.setActive?.()
  } catch {
    // Gracefully handled in headless test environment
  }

  // Apply explicit panel group sizing so the 3 columns fill 100% of the viewport width
  try {
    const leftWidth = WORKBENCH_PANEL_CONFIGS.explorer.initialWidth ?? 300
    const rightWidth = WORKBENCH_PANEL_CONFIGS.inspector.initialWidth ?? 440
    const totalWidth = typeof api.width === 'number' && api.width > 0 ? api.width : 0
    const stageMinWidth = WORKBENCH_PANEL_CONFIGS.stage.minimumWidth ?? 360

    if (totalWidth > leftWidth + rightWidth) {
      const stageWidth = Math.max(stageMinWidth, totalWidth - leftWidth - rightWidth)
      stagePanel?.api?.setSize?.({ width: stageWidth })
    }
    explorer?.api?.setSize?.({ width: leftWidth })
    inspector?.api?.setSize?.({ width: rightWidth })
    consolePanel?.api?.setSize?.({ height: WORKBENCH_PANEL_CONFIGS.console.initialHeight ?? 180 })
  } catch {
    // Gracefully handled in headless test environment
  }

  // Pin group constraints so tab drags cannot resize a column. Zone capture
  // happens in the workbench after the layout exists.
  applyGroupConstraints(api)
}

export interface DockviewWorkbenchProps {
  state: WorkbenchState
  className?: string
  /** Enabled views; disabled panels are closed after boot and on change. */
  enabledViews?: WorkbenchPanelId[]
  onReady?: (api: DockviewApi) => void
  onResetLayout?: () => void
  onPanelVisibilityChange?: (panelId: WorkbenchPanelId, isOpen: boolean) => void
  onActivePanelsChange?: (activePanels: Record<WorkbenchPanelId, boolean>) => void
}

export interface DockviewWorkbenchRef {
  resetLayout: () => void
  getApi: () => DockviewApi | null
  openPanel: (panelId: WorkbenchPanelId) => void
  closePanel: (panelId: WorkbenchPanelId) => void
  focusOrOpenPanel: (panelId: WorkbenchPanelId, shiftKey?: boolean) => void
  resetPanelToHome: (panelId: WorkbenchPanelId) => void
  isPanelOpen: (panelId: WorkbenchPanelId) => boolean
  isPanelActiveInGroup: (panelId: WorkbenchPanelId) => boolean
}

export const DockviewWorkbench = React.forwardRef<DockviewWorkbenchRef, DockviewWorkbenchProps>(
  (
    {
      state,
      className,
      enabledViews,
      onReady,
      onResetLayout,
      onPanelVisibilityChange,
      onActivePanelsChange,
    },
    ref
  ) => {
    const apiRef = useRef<DockviewApi | null>(null)
    const isRestoringRef = useRef(false)
    const isPruningRef = useRef(false)
    const isSyncQueuedRef = useRef(false)
    const homeZonesRef = useRef<Partial<Record<WorkbenchGroupRole, string>>>({})

    const readHomeZones = useCallback((): Partial<Record<WorkbenchGroupRole, string>> => {
      try {
        const raw = localStorage.getItem(WORKBENCH_ZONE_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }, [])

    const persistHomeZones = useCallback((zones: Partial<Record<WorkbenchGroupRole, string>>) => {
      homeZonesRef.current = zones
      try {
        localStorage.setItem(WORKBENCH_ZONE_STORAGE_KEY, JSON.stringify(zones))
      } catch {
        // Layout persistence is best-effort.
      }
    }, [])

    /**
     * Records which live group owns each canonical zone. Roles whose panels are
     * all closed are preserved from storage because an empty group has no
     * members to infer a role from, and losing the role would let the zone
     * adopt the wrong size caps.
     */
    const captureHomeZones = useCallback(
      (api: DockviewApi) => {
        const stored = readHomeZones()
        const liveIds = new Set(api.groups.map((group) => group.id))
        const next: Partial<Record<WorkbenchGroupRole, string>> = {}
        for (const [role, groupId] of Object.entries(stored)) {
          if (groupId && liveIds.has(groupId)) next[role as WorkbenchGroupRole] = groupId
        }
        for (const group of api.groups) {
          for (const panel of group.panels ?? []) {
            const role = WORKBENCH_HOME_ZONES[panel.id as WorkbenchPanelId]
            if (role && !next[role]) next[role] = group.id
          }
        }
        persistHomeZones(next)
      },
      [persistHomeZones, readHomeZones]
    )

    /** Closes empty groups created by drag-splits; canonical zones are kept. */
    const pruneTransientEmptyGroups = useCallback((api: DockviewApi) => {
      const homeIds = new Set(Object.values(homeZonesRef.current).filter(Boolean) as string[])
      const empties = api.groups.filter((group) => {
        const location = (group as any)?.api?.location
        const locationType = typeof location === 'string' ? location : location?.type
        if (locationType && locationType !== 'grid') return false
        return (group.panels?.length ?? 0) === 0 && !homeIds.has(group.id)
      })
      if (empties.length === 0) return

      isPruningRef.current = true
      try {
        for (const group of empties) {
          try {
            group.api.close()
          } catch {
            // Already disposed.
          }
        }
      } finally {
        isPruningRef.current = false
      }
    }, [])

    /**
     * Runs after any structural layout mutation. Constraints are re-applied in a
     * microtask so dockview finishes its own grid mutation first.
     */
    const syncStructure = useCallback(
      (api: DockviewApi) => {
        if (isRestoringRef.current || isPruningRef.current) return
        // Structural events fire *inside* dockview's own mutation frames. Defer
        // every follow-up mutation (prune/close, setConstraints) so the grid is
        // never mutated re-entrantly, which corrupts the layout tree.
        if (isSyncQueuedRef.current) return
        isSyncQueuedRef.current = true
        queueMicrotask(() => {
          isSyncQueuedRef.current = false
          if (apiRef.current !== api) return
          captureHomeZones(api)
          pruneTransientEmptyGroups(api)
          applyGroupConstraints(api, homeZonesRef.current)
        })
      },
      [captureHomeZones, pruneTransientEmptyGroups]
    )

    const notifyVisibility = useCallback(
      (api: DockviewApi) => {
        if (onPanelVisibilityChange) {
          for (const id of ALL_WORKBENCH_PANEL_IDS) {
            onPanelVisibilityChange(id, Boolean(api.getPanel(id)))
          }
        }
        if (onActivePanelsChange) {
          const activeMap = {} as Record<WorkbenchPanelId, boolean>
          for (const id of ALL_WORKBENCH_PANEL_IDS) {
            const p = api.getPanel(id) as any
            activeMap[id] = Boolean(
              p && (p.group?.activePanel?.id === id || p.api?.isActive || p.api?.isVisible)
            )
          }
          onActivePanelsChange(activeMap)
        }
      },
      [onPanelVisibilityChange, onActivePanelsChange]
    )

    const resetLayout = useCallback(() => {
      if (!apiRef.current) return
      try {
        localStorage.removeItem(WORKBENCH_LAYOUT_STORAGE_KEY)
        localStorage.removeItem(WORKBENCH_ZONE_STORAGE_KEY)
      } catch {
        // ignore
      }
      homeZonesRef.current = {}
      createDefaultLayout(apiRef.current)
      captureHomeZones(apiRef.current)
      applyGroupConstraints(apiRef.current, homeZonesRef.current)
      notifyVisibility(apiRef.current)
      onResetLayout?.()
    }, [captureHomeZones, onResetLayout, notifyVisibility])

    const openPanel = useCallback(
      (panelId: WorkbenchPanelId) => {
        const api = apiRef.current
        if (!api) return
        const existing = api.getPanel(panelId)
        if (existing) {
          existing.api.setActive()
          notifyVisibility(api)
          return
        }
        const config = WORKBENCH_PANEL_CONFIGS[panelId]
        const zone = WORKBENCH_HOME_ZONES[panelId]
        const zoneGroupId = zone ? homeZonesRef.current[zone] : undefined
        const zoneGroup = zoneGroupId
          ? api.groups.find((group) => group.id === zoneGroupId)
          : undefined
        // A live zone group keeps the panel at its home size; otherwise fall
        // back to the zone anchor, then to the generic anchor table.
        const position:
          | WorkbenchZonePlacement
          | ReturnType<typeof resolvePanelOpenPosition>
          | undefined = zoneGroup
          ? { referenceGroup: zoneGroup.id }
          : zone
            ? resolveZoneFallbackAnchor(api, zone, homeZonesRef.current) ??
              resolvePanelOpenPosition(api, panelId)
            : resolvePanelOpenPosition(api, panelId)

        api.addPanel({
          id: panelId,
          component: panelId,
          title: WORKBENCH_VIEW_TITLES[panelId] || panelId,
          renderer: DOCKVIEW_PRESERVATION_RENDERER,
          ...(position ? { position } : {}),
          // Initial sizing matters only when a brand-new group is created.
          ...(config?.initialWidth && !zoneGroup ? { initialWidth: config.initialWidth } : {}),
          ...(config?.initialHeight && !zoneGroup ? { initialHeight: config.initialHeight } : {}),
        })
        notifyVisibility(api)
        if (!zoneGroup) syncStructure(api)
      },
      [notifyVisibility, syncStructure]
    )

    const isPanelOpen = useCallback((panelId: WorkbenchPanelId) => {
      return Boolean(apiRef.current?.getPanel(panelId))
    }, [])

    const isPanelActiveInGroup = useCallback((panelId: WorkbenchPanelId) => {
      const panel = apiRef.current?.getPanel(panelId) as any
      if (!panel) return false
      if (panel.group?.activePanel) {
        return panel.group.activePanel.id === panelId
      }
      if (panel.api?.isActive !== undefined) {
        return Boolean(panel.api.isActive)
      }
      return true
    }, [])

    /**
     * Hides a panel without touching the layout: the zone keeps its size, so
     * hiding a view never resizes its neighbours. Only Reset Layout rebuilds.
     */
    const closePanel = useCallback(
      (panelId: WorkbenchPanelId) => {
        const api = apiRef.current
        if (!api) return
        const panel = api.getPanel(panelId)
        if (panel) {
          api.removePanel(panel, { removeEmptyGroup: false })
          notifyVisibility(api)
        }
      },
      [notifyVisibility]
    )

    const resetPanelToHome = useCallback(
      (panelId: WorkbenchPanelId) => {
        const api = apiRef.current
        if (!api) return
        const existing = api.getPanel(panelId)
        if (existing) {
          api.removePanel(existing, { removeEmptyGroup: false })
        }
        openPanel(panelId)
      },
      [openPanel]
    )

    /**
     * ActivityBar focus/open semantics. The rail never closes a panel: closing
     * is the job of the tab's close button or the HeaderBar "Panels" menu (OFF),
     * which also removes the icon from the rail.
     * 1. Shift + Click -> Dock Home (resetPanelToHome)
     * 2. Closed -> Open at its default anchor and focus
     * 3. Open -> Focus/activate it, wherever it currently lives
     */
    const focusOrOpenPanel = useCallback(
      (panelId: WorkbenchPanelId, shiftKey = false) => {
        const api = apiRef.current
        if (!api) return

        if (shiftKey) {
          resetPanelToHome(panelId)
          return
        }

        const panel = api.getPanel(panelId)
        if (!panel) {
          openPanel(panelId)
          return
        }

        panel.api.setActive()
        notifyVisibility(api)
      },
      [resetPanelToHome, openPanel, notifyVisibility]
    )

    React.useImperativeHandle(
      ref,
      () => ({
        resetLayout,
        getApi: () => apiRef.current,
        openPanel,
        closePanel,
        focusOrOpenPanel,
        resetPanelToHome,
        isPanelOpen,
        isPanelActiveInGroup,
      }),
      [
        resetLayout,
        openPanel,
        closePanel,
        focusOrOpenPanel,
        resetPanelToHome,
        isPanelOpen,
        isPanelActiveInGroup,
      ]
    )

    const homeViewsForGroup = useCallback((groupId: string): WorkbenchPanelId[] => {
      const entry = Object.entries(homeZonesRef.current).find(([, id]) => id === groupId)
      if (!entry) return []
      const role = entry[0] as WorkbenchGroupRole
      return ALL_WORKBENCH_PANEL_IDS.filter((id) => WORKBENCH_HOME_ZONES[id] === role)
    }, [])

    const providerValue = useMemo(
      () => ({ ...state, homeViewsForGroup }),
      [state, homeViewsForGroup]
    )

    const handleWillDrop = useCallback((dropEvent: DockviewWillDropEvent) => {
      const allowed = isWorkbenchDropAllowed({
        position: dropEvent.position,
        isEdge: Boolean((dropEvent as any).edgeGroup || dropEvent.kind === 'edge'),
        kind: dropEvent.kind,
        draggedPanelId: dropEvent.getData?.()?.panelId,
        targetGroup: dropEvent.group,
        targetPanel: dropEvent.panel,
      })
      if (!allowed) {
        dropEvent.preventDefault()
      }
    }, [])

    const handleReady = useCallback(
      (event: DockviewReadyEvent) => {
        const api = event.api
        apiRef.current = api

        let layoutRestored = false
        isRestoringRef.current = true

        try {
          const raw = localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)
          if (raw) {
            const parsed = JSON.parse(raw)
            const rootType = parsed?.grid?.root?.type
            // Validate before mutating: a failed fromJSON leaves dockview's
            // mutation frame open and every later addPanel fails.
            if (rootType !== 'branch' && rootType !== 'leaf') {
              throw new Error('invalid serialized layout')
            }
            api.fromJSON(parsed)
            if (api.totalPanels > 0) {
              layoutRestored = true
            }
          }
        } catch (err) {
          console.warn(
            '[DockviewWorkbench] Failed to load saved layout, falling back to default:',
            err
          )
          try {
            localStorage.removeItem(WORKBENCH_LAYOUT_STORAGE_KEY)
          } catch {
            // ignore
          }
        } finally {
          isRestoringRef.current = false
        }

        if (!layoutRestored) {
          createDefaultLayout(api)
        }

        // Zone ids survive serialization; header/constraint state does not, so
        // capture the zones and re-pin constraints on every boot.
        captureHomeZones(api)

        // A restored layout may contain views the user disabled in a previous
        // session. Close them (zone preserved) instead of re-enabling them.
        if (enabledViews) {
          for (const panelId of ALL_WORKBENCH_PANEL_IDS) {
            if (enabledViews.includes(panelId)) continue
            const panel = api.getPanel(panelId)
            if (panel) api.removePanel(panel, { removeEmptyGroup: false })
          }
        }

        pruneTransientEmptyGroups(api)
        applyGroupConstraints(api, homeZonesRef.current)
        notifyVisibility(api)

        // Auto-persist layout changes to localStorage
        const layoutChangeDisposable = api.onDidLayoutChange(() => {
          notifyVisibility(api)
          if (isRestoringRef.current) return
          try {
            const serialized = api.toJSON()
            localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(serialized))
          } catch (err) {
            console.warn('[DockviewWorkbench] Failed to persist layout to localStorage:', err)
          }
        })

        const activePanelDisposable = (api as any).onDidActivePanelChange?.(() => {
          notifyVisibility(api)
        })

        // Structural changes can move panels between zones. Re-capture the zone
        // registry, drop transient empty groups, and re-pin constraints after
        // dockview finishes the mutation.
        const structureDisposables = [
          (api as any).onDidAddPanel?.(() => syncStructure(api)),
          (api as any).onDidRemovePanel?.(() => syncStructure(api)),
          (api as any).onDidMovePanel?.(() => syncStructure(api)),
          (api as any).onDidAddGroup?.(() => syncStructure(api)),
          (api as any).onDidRemoveGroup?.(() => syncStructure(api)),
        ]

        // Directional drag-and-drop validation: block awkward splits & root-spanning edge drops
        const overlayDisposable = api.onWillShowOverlay?.(
          (overlayEvent: DockviewWillShowOverlayLocationEvent) => {
            const allowed = isWorkbenchDropAllowed({
              position: overlayEvent.position,
              isEdge: Boolean(
                overlayEvent.edge || overlayEvent.edgeGroup || overlayEvent.kind === 'edge'
              ),
              kind: overlayEvent.kind,
              draggedPanelId: overlayEvent.getData?.()?.panelId,
              targetGroup: overlayEvent.group,
              targetPanel: overlayEvent.panel,
            })
            if (!allowed) {
              overlayEvent.preventDefault()
            }
          }
        )

        const willDropDisposable = api.onWillDrop?.((dropEvent: DockviewWillDropEvent) => {
          const allowed = isWorkbenchDropAllowed({
            position: dropEvent.position,
            isEdge: Boolean((dropEvent as any).edgeGroup || dropEvent.kind === 'edge'),
            kind: dropEvent.kind,
            draggedPanelId: dropEvent.getData?.()?.panelId,
            targetGroup: dropEvent.group,
            targetPanel: dropEvent.panel,
          })
          if (!allowed) {
            dropEvent.preventDefault()
          }
        })

        onReady?.(api)

        return () => {
          layoutChangeDisposable.dispose()
          activePanelDisposable?.dispose?.()
          structureDisposables.forEach((disposable) => disposable?.dispose?.())
          overlayDisposable?.dispose()
          willDropDisposable?.dispose()
        }
      },
      [captureHomeZones, enabledViews, notifyVisibility, onReady, pruneTransientEmptyGroups, syncStructure]
    )

    return (
      <WorkbenchProvider value={providerValue}>
        <div
          className={`relative h-full w-full overflow-hidden bg-zinc-950 ${className || ''}`}
          data-testid="dockview-workbench-root"
        >
          <DockviewReact
            className={WORKBENCH_THEME_CLASS}
            components={workbenchComponents}
            watermarkComponent={WorkbenchEmptyWatermark}
            defaultRenderer={DOCKVIEW_PRESERVATION_RENDERER}
            // Hiding a view must keep its zone (and size) alive.
            closeEmptyGroups={false}
            dndEdges={false}
            disableFloatingGroups={true}
            onReady={handleReady}
            onWillDrop={handleWillDrop}
          />
        </div>
      </WorkbenchProvider>
    )
  }
)

DockviewWorkbench.displayName = 'DockviewWorkbench'
