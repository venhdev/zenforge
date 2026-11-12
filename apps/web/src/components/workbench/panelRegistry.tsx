import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { WorkspaceTree } from '../sidebar/WorkspaceTree'
import { StageContainer } from '../stage/StageContainer'
import { LiveLog } from '../sidebar/LiveLog'
import { InspectionDock, type DockLens } from '../inspector/InspectionDock'
import { ResourcesSidebar } from '../workspace/resources/ResourcesSidebar'
import { WorkbenchResourceInspector } from '../workspace/resources/WorkbenchResourceInspector'
import {
  ResourceDropOverlay,
  type ResourceDropPayload,
} from '../workspace/resources/ResourceDropOverlay'
import type { DropScope, DropTarget } from '../workspace/resources/ScopePicker'
import { HarnessView } from '../env/HarnessView'
import type {
  Task,
  Artifact,
  ContextPacket,
  Project,
  Plan,
  Resource,
  ResourceKind,
  ResourceScope,
  ResourceStatus,
  ResourceSearchResult,
  RuntimeTelemetry,
} from '../../types/contracts'
import type { ApiResult } from '../../hooks/useZenfAPI'
import { WorkbenchErrorBoundary } from './WorkbenchErrorBoundary'

export type WorkbenchPanelId =
  | 'explorer'
  | 'stage'
  | 'console'
  | 'inspector'
  | 'resources'
  | 'harness'

/**
 * Short tab titles for the 6 dynamic workbench views. The dockview tab strip is
 * narrow, so titles stay single-word; the ActivityBar tooltips and HeaderBar
 * panel menu carry the longer descriptions.
 */
export const WORKBENCH_VIEW_TITLES: Record<WorkbenchPanelId, string> = {
  explorer: 'Hierarchy',
  resources: 'Resources',
  harness: 'Harness',
  console: 'Activity',
  stage: 'Stage',
  inspector: 'Inspector',
}

/**
 * Greedy state preservation mode: keep inactive tabs in the DOM
 * so SSE subscriptions, xterm buffers, and ReactFlow viewport are not reset.
 */
export const DOCKVIEW_PRESERVATION_RENDERER = 'always' as const

export interface WorkbenchState {
  projects?: Project[]
  activeProjectSlug?: string | null
  plans?: Plan[]
  activePlanSlug?: string | null
  tasks: Task[]
  selectedTaskId: string | null
  selectedTask: Task | null
  artifacts: Artifact[]
  resources?: Resource[]
  selectedResourceId?: string | null
  selectedResource?: Resource | null
  hideDoneTasks?: boolean
  /** Views enabled in the Panels menu; the ActivityBar rail and empty zones read this. */
  enabledViews?: WorkbenchPanelId[]
  /** Panels whose canonical home is the zone owned by `groupId`. */
  homeViewsForGroup?: (groupId: string) => WorkbenchPanelId[]
  /** Reset the layout and re-enable every view (used by empty-zone placeholders). */
  onResetWorkbenchLayout?: () => void
  onSelectProject?: (projectSlug: string) => void
  onSelectPlan?: (planSlug: string) => void
  onToggleHideDone?: () => void
  onNewProject?: () => void
  onNewPlan?: () => void
  onSelectTask: (task: Task, source?: 'sidebar' | 'canvas' | 'dock' | 'hud') => void
  onSelectTaskId: (taskId: string) => void
  onDeselectTask?: () => void
  onOpenTerminal?: (task: Task) => void
  onNewTask?: () => void
  onEditTask?: (task: Task) => void
  onDeleteTask?: (taskId: string) => void
  onAddDependency?: (sourceTaskId: string, targetTaskId: string) => Promise<void>
  onDeleteEdge?: (sourceTaskId: string, targetTaskId: string) => Promise<void>
  onAttachResource?: (taskId: string, resourceKey: string) => Promise<void>
  onSelectResource?: (res: Resource) => void
  onDeselectResource?: () => void
  onNewResource?: () => void
  onRefreshResources?: () => void
  onImportResource?: (payload: ResourceDropPayload, target: DropTarget) => Promise<void>
  onTaskContextDrop?: (taskId: string, payload: ResourceDropPayload) => Promise<void>
  onUnlinkResource?: (taskId: string, docRef: string) => Promise<void>
  onFetchEnv?: () => Promise<ApiResult<Record<string, any>>>
  onFetchStatus?: () => Promise<ApiResult<RuntimeTelemetry>>
  focusTarget?: { id: string; timestamp: number } | null
  logTick: number
  fetchTaskPacket?: (taskId: string) => Promise<ApiResult<ContextPacket>>
  dockLens?: DockLens
}

export const defaultWorkbenchState: WorkbenchState = {
  projects: [],
  activeProjectSlug: undefined,
  plans: [],
  activePlanSlug: undefined,
  tasks: [],
  selectedTaskId: null,
  selectedTask: null,
  artifacts: [],
  resources: [],
  selectedResourceId: null,
  selectedResource: null,
  hideDoneTasks: false,
  enabledViews: ['explorer', 'resources', 'harness', 'console', 'stage', 'inspector'],
  homeViewsForGroup: () => [],
  onSelectTask: () => {},
  onSelectTaskId: () => {},
  logTick: 0,
}

export const WorkbenchContext = createContext<WorkbenchState>(defaultWorkbenchState)

export const WorkbenchProvider: React.FC<{
  value: WorkbenchState
  children: React.ReactNode
}> = ({ value, children }) => {
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>
}

export function useWorkbenchContext(): WorkbenchState {
  return useContext(WorkbenchContext) ?? defaultWorkbenchState
}

export interface PanelResizeApi {
  onDidDimensionsChange?: (cb: () => void) => { dispose: () => void } | void
}

export interface PanelVisibilityApi {
  isVisible?: boolean
  onDidVisibilityChange?: (cb: (e: { isVisible: boolean }) => void) => { dispose: () => void } | void
}

/**
 * Hook to track tab visibility within its Dockview group.
 * In greedy preservation mode (renderer='always'), inactive tabs remain mounted in DOM.
 * Applying display: 'none' when !isVisible ensures that WebGL/ReactFlow layers and DOM
 * elements do not bleed through or ghost behind active tabs when tabbed into the same group.
 */
export function usePanelVisibility(api?: PanelVisibilityApi) {
  const [isVisible, setIsVisible] = useState(() => (api?.isVisible !== undefined ? api.isVisible : true))

  useEffect(() => {
    if (!api || typeof api.onDidVisibilityChange !== 'function') return
    const disposable = api.onDidVisibilityChange((e) => {
      setIsVisible(e.isVisible)
      if (e.isVisible) {
        window.dispatchEvent(new Event('resize'))
      }
    })
    return () => {
      disposable?.dispose?.()
    }
  }, [api])

  return isVisible
}

/**
 * Hook to hook into Dockview panel resizing and trigger a window resize event
 * so that ReactFlow WebGL/DOM containers and xterm.js fit properly without state loss.
 */
export function usePanelResizeHandler(api?: PanelResizeApi) {
  useEffect(() => {
    if (!api || typeof api.onDidDimensionsChange !== 'function') return
    const disposable = api.onDidDimensionsChange(() => {
      window.dispatchEvent(new Event('resize'))
    })
    return () => {
      disposable?.dispose?.()
    }
  }, [api])
}

export const ExplorerPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  return (
    <div
      className="h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-explorer"
    >
      <WorkspaceTree
        projects={ctx.projects}
        activeProjectSlug={ctx.activeProjectSlug}
        plans={ctx.plans}
        activePlanSlug={ctx.activePlanSlug}
        tasks={ctx.tasks}
        selectedTaskId={ctx.selectedTaskId}
        hideDoneTasks={ctx.hideDoneTasks}
        onSelectProject={ctx.onSelectProject}
        onSelectPlan={ctx.onSelectPlan}
        onSelectTask={(task) => ctx.onSelectTask(task, 'sidebar')}
        onToggleHideDone={ctx.onToggleHideDone}
        onNewProject={ctx.onNewProject}
        onNewPlan={ctx.onNewPlan}
        onNewTask={ctx.onNewTask}
      />
    </div>
  )
}

export const StagePanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  return (
    <div
      className="h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-stage"
    >
      <StageContainer
        tasks={ctx.tasks}
        selectedTaskId={ctx.selectedTaskId}
        onSelectTask={ctx.onSelectTask}
        onDeselectTask={ctx.onDeselectTask}
        onOpenTerminal={ctx.onOpenTerminal}
        onAttachResource={ctx.onAttachResource}
        onAddDependency={ctx.onAddDependency}
        onDeleteEdge={ctx.onDeleteEdge}
        focusTarget={ctx.focusTarget}
      />
    </div>
  )
}

export const ConsolePanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  return (
    <div
      className="h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-console"
    >
      <LiveLog
        tick={ctx.logTick}
        variant="drawer"
        dockLocation="bottom"
      />
    </div>
  )
}

export const InspectorPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  return (
    <div
      className="h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-inspector"
    >
      {ctx.selectedResource && !ctx.selectedTask ? (
        <WorkbenchResourceInspector
          resource={ctx.selectedResource}
          onResourceUpdated={ctx.onRefreshResources}
          onResourceDeleted={() => {
            ctx.onDeselectResource?.()
            ctx.onRefreshResources?.()
          }}
        />
      ) : (
        <InspectionDock
          selectedTask={ctx.selectedTask}
          allTasks={ctx.tasks}
          artifacts={ctx.artifacts}
          onSelectTaskId={ctx.onSelectTaskId}
          onEditTask={ctx.onEditTask}
          onDeleteTask={ctx.onDeleteTask}
          collapsed={false}
          onToggleCollapse={() => {}}
          fetchTaskPacket={ctx.fetchTaskPacket}
          initialLens={ctx.dockLens}
          resources={ctx.resources}
          onTaskContextDrop={ctx.onTaskContextDrop}
          onUnlinkResource={ctx.onUnlinkResource}
        />
      )}
    </div>
  )
}

export const ResourcesPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ResourceSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [kindFilter, setKindFilter] = useState<ResourceKind | 'ALL'>('ALL')
  const [scopeFilter, setScopeFilter] = useState<ResourceScope | 'ALL'>('ALL')
  const [statusFilter, setStatusFilter] = useState<ResourceStatus | 'ALL'>('ALL')
  const [includeGlobal, setIncludeGlobal] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [pendingScope, setPendingScope] = useState<Exclude<DropScope, 'GLOBAL'> | null>(null)
  const [dropPayload, setDropPayload] = useState<ResourceDropPayload | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(ctx.selectedResourceId || null)

  useEffect(() => {
    if (ctx.selectedResourceId !== undefined) {
      setSelectedId(ctx.selectedResourceId)
    }
  }, [ctx.selectedResourceId])

  const allResources = useMemo(() => ctx.resources || [], [ctx.resources])

  const visibleResources = useMemo(() => {
    return allResources.filter((r) => {
      if (kindFilter !== 'ALL' && r.kind !== kindFilter) return false
      if (scopeFilter !== 'ALL' && r.scope !== scopeFilter) return false
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (!includeGlobal && r.scope === 'GLOBAL') return false
      if (selectedTypes.length > 0) {
        const types = r.types || []
        const hasMatch = selectedTypes.some(
          (st) => types.includes(st) || String(r.type).toLowerCase() === st.toLowerCase()
        )
        if (!hasMatch) return false
      }
      if (query.trim()) {
        const q = query.toLowerCase()
        const matchTitle = r.title?.toLowerCase().includes(q)
        const matchKey = r.key?.toLowerCase().includes(q)
        const matchSummary = r.summary?.toLowerCase().includes(q)
        if (!matchTitle && !matchKey && !matchSummary) return false
      }
      return true
    })
  }, [allResources, kindFilter, scopeFilter, statusFilter, includeGlobal, selectedTypes, query])

  const snippetById = useMemo(() => new Map<string, string>(), [])

  const handleSelectResource = useCallback(
    (res: Resource) => {
      setSelectedId(res.id)
      ctx.onSelectResource?.(res)
    },
    [ctx]
  )

  const readDropPayload = (dataTransfer: DataTransfer): ResourceDropPayload | null => {
    const rawResource = dataTransfer.getData('application/zenf-resource')
    if (rawResource) {
      try {
        const parsed = JSON.parse(rawResource) as { id?: string; key?: string }
        if (parsed?.id && parsed?.key) {
          return { kind: 'existing', resourceId: parsed.id, resourceKey: parsed.key }
        }
      } catch {
        // fall through to file/text handling
      }
    }

    const file = dataTransfer.files?.[0]
    if (file) return { kind: 'file', file }

    const uri = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain')
    if (!uri) return null
    return /^https?:\/\//i.test(uri.trim()) ? { kind: 'url', url: uri.trim() } : { kind: 'text', text: uri }
  }

  const dragSupported = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    return (
      types.includes('application/zenf-resource') ||
      types.includes('Files') ||
      types.includes('text/uri-list') ||
      types.includes('text/plain')
    )
  }

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!dragSupported(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragActive(false)
    setPendingScope(null)
  }, [])

  const handleZoneDrop = useCallback(
    (scope: DropScope, event: React.DragEvent) => {
      const payload = readDropPayload(event.dataTransfer)
      setDragActive(false)
      if (!payload) {
        setPendingScope(null)
        return
      }
      if (scope === 'GLOBAL') {
        void ctx.onImportResource?.(payload, { scope: 'GLOBAL' })
        setPendingScope(null)
        return
      }
      setDropPayload(payload)
      setPendingScope(scope)
    },
    [ctx]
  )

  const handleChooseZone = useCallback(
    (scope: DropScope) => {
      // Paste flow: the payload is already captured, so a click is enough.
      if (!dropPayload) return
      if (scope === 'GLOBAL') {
        void ctx.onImportResource?.(dropPayload, { scope: 'GLOBAL' })
        setDropPayload(null)
        return
      }
      setPendingScope(scope)
    },
    [dropPayload, ctx]
  )

  const handleSelectTarget = useCallback(
    async (target: DropTarget) => {
      const payload = dropPayload
      setDropPayload(null)
      setPendingScope(null)
      setDragActive(false)
      if (payload && ctx.onImportResource) {
        await ctx.onImportResource(payload, target)
      }
    },
    [dropPayload, ctx]
  )

  const handleCancelDrop = useCallback(() => {
    setDragActive(false)
    setPendingScope(null)
    setDropPayload(null)
  }, [])

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text.trim()) return
    setDropPayload({ kind: 'text', text })
    setDragActive(true)
  }, [])

  const handleToggleType = useCallback((typeTag: string) => {
    setSelectedTypes((prev) =>
      prev.includes(typeTag) ? prev.filter((t) => t !== typeTag) : [...prev, typeTag]
    )
  }, [])

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-resources"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
    >
      <ResourceDropOverlay
        open={dragActive || pendingScope !== null}
        pendingScope={pendingScope}
        projects={ctx.projects || []}
        plans={ctx.plans || []}
        tasks={ctx.tasks}
        defaultProjectSlug={ctx.activeProjectSlug}
        onZoneDrop={handleZoneDrop}
        onChooseZone={handleChooseZone}
        onSelectTarget={(target) => void handleSelectTarget(target)}
        onCancel={handleCancelDrop}
        onBack={() => setPendingScope(null)}
      />
      <ResourcesSidebar
        className="w-full flex-1"
        loading={false}
        visibleResources={visibleResources}
        selectedId={selectedId}
        onSelectResource={handleSelectResource}
        onReload={ctx.onRefreshResources || (() => {})}
        onCreateClick={ctx.onNewResource || (() => {})}
        query={query}
        onQueryChange={setQuery}
        onSearch={(e) => {
          e.preventDefault()
          setSearching(false)
        }}
        onResetSearch={() => {
          setQuery('')
          setSearchResults(null)
        }}
        searchResults={searchResults}
        searching={searching}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        scopeFilter={scopeFilter}
        onScopeFilterChange={setScopeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        includeGlobal={includeGlobal}
        onIncludeGlobalChange={setIncludeGlobal}
        selectedTypes={selectedTypes}
        onToggleTypeFilter={handleToggleType}
        onResetTypes={() => setSelectedTypes([])}
        snippetById={snippetById}
        error=""
      />
    </div>
  )
}

export const HarnessPanel: React.FC<IDockviewPanelProps> = ({ api }) => {
  usePanelResizeHandler(api)
  const isVisible = usePanelVisibility(api)
  const ctx = useWorkbenchContext()

  return (
    <div
      className="h-full w-full overflow-hidden bg-zinc-950 flex flex-col"
      style={{ display: isVisible ? 'flex' : 'none' }}
      data-testid="workbench-panel-harness"
    >
      <HarnessView
        onFetchEnv={ctx.onFetchEnv}
        onFetchStatus={ctx.onFetchStatus}
        isActive={isVisible}
      />
    </div>
  )
}

const withPanelBoundary = (
  panelId: WorkbenchPanelId,
  Panel: React.FC<IDockviewPanelProps>
): React.FC<IDockviewPanelProps> => {
  const Bounded: React.FC<IDockviewPanelProps> = (props) => (
    <WorkbenchErrorBoundary panelId={panelId}>
      <Panel {...props} />
    </WorkbenchErrorBoundary>
  )
  Bounded.displayName = `Bounded${panelId[0].toUpperCase()}${panelId.slice(1)}Panel`
  return Bounded
}

export const workbenchComponents = {
  explorer: withPanelBoundary('explorer', ExplorerPanel),
  stage: withPanelBoundary('stage', StagePanel),
  console: withPanelBoundary('console', ConsolePanel),
  inspector: withPanelBoundary('inspector', InspectorPanel),
  resources: withPanelBoundary('resources', ResourcesPanel),
  harness: withPanelBoundary('harness', HarnessPanel),
}
