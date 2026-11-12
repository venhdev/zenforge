import { useState, useCallback, useMemo, useRef } from 'react'
import { HeaderBar } from './components/header/HeaderBar'
import type { ResourceDropPayload } from './components/workspace/resources/ResourceDropOverlay'
import type { DropTarget } from './components/workspace/resources/ScopePicker'
import { ActivityBar } from './components/layout/ActivityBar'
import type { DockLens } from './components/inspector/InspectionDock'
import { TerminalModal } from './components/inspector/TerminalModal'
import { FloatingHUD } from './components/hud/FloatingHUD'
import { DockviewWorkbench, type DockviewWorkbenchRef } from './components/workbench/DockviewWorkbench'
import type { WorkbenchState, WorkbenchPanelId } from './components/workbench/panelRegistry'
import { ProjectModal } from './components/modals/ProjectModal'
import { PlanModal } from './components/modals/PlanModal'
import { TaskModal } from './components/modals/TaskModal'
import { CreateResourceModal } from './components/workspace/resources/CreateResourceModal'
import { type ResourceForm, parseTags } from './components/workspace/resources/types'
import { useWorkspaceState } from './hooks/useWorkspaceState'
import { useWorkbenchViews } from './hooks/useWorkbenchViews'
import { useModalState } from './hooks/useModalState'
import type { Task, ProjectInput, PlanInput, Resource, ResourceScope } from './types/contracts'

export default function App() {
  const [dockLens, setDockLens] = useState<DockLens>('input')
  const [terminalTask, setTerminalTask] = useState<Task | null>(null)
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [isCreateResourceOpen, setIsCreateResourceOpen] = useState(false)
  const [createResourceBusy, setCreateResourceBusy] = useState(false)
  const [createResourceError, setCreateResourceError] = useState('')
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({
    explorer: true,
    resources: true,
    harness: true,
    stage: true,
    console: true,
    inspector: false,
  })
  const [activePanels, setActivePanels] = useState<Record<string, boolean>>({
    explorer: true,
    resources: false,
    harness: false,
    stage: true,
    console: true,
    inspector: false,
  })
  const workbenchRef = useRef<DockviewWorkbenchRef>(null)
  const { enabledViews, enabledMap, setViewEnabled, resetViews } = useWorkbenchViews()

  const [hudVisible, setHudVisible] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('zenf_hud_visible')
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  const toggleHud = useCallback(() => {
    setHudVisible((prev) => {
      const next = !prev
      try {
        localStorage.setItem('zenf_hud_visible', String(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const workspace = useWorkspaceState()
  const {
    api,
    connected,
    projects,
    activeProjectSlug,
    setActiveProjectSlug,
    plans,
    showArchived,
    setShowArchived,
    logTick,
    activePlan,
    setActivePlan,
    tasks,
    setTasks,
    selectedTaskId,
    setSelectedTaskId,
    focusTarget,
    setFocusTarget,
    artifacts,
    agents,
    resources,
    daemonVersion,
    refreshData,
    refreshProjects,
  } = workspace

  const {
    createProject,
    createPlan,
    deletePlan,
    createTask,
    updateTask,
    deleteTask,
    updateTaskDependencies,
    fetchPlan,
    fetchTaskPacket,
    fetchGlobalEnv,
    fetchRuntimeStatus,
    createResource,
    uploadResourceFile,
    uploadTaskAttachment,
  } = api

  const modals = useModalState({
    createProject,
    createPlan,
    createTask,
    updateTask,
    onSuccess: refreshData,
  })

  const {
    isProjectModalOpen,
    setIsProjectModalOpen,
    isPlanModalOpen,
    setIsPlanModalOpen,
    isTaskModalOpen,
    setIsTaskModalOpen,
    editingTask,
    modalBusy,
    openNewTask,
    openEditTask,
    handleProjectSubmit,
    handlePlanSubmit,
    handleTaskSubmit,
  } = modals

  const activeProject = useMemo(
    () => projects.find((p) => p.slug === activeProjectSlug) || null,
    [projects, activeProjectSlug]
  )

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  )

  const activeWorkerCount = useMemo(
    () => tasks.filter((t) => t.status === 'RUNNING').length,
    [tasks]
  )

  const runningTasksCount = activeWorkerCount

  const handleSelectProject = useCallback(
    (slug: string) => {
      setActiveProjectSlug(slug)
      setActivePlan(null)
      setTasks([])
      setSelectedTaskId(null)
    },
    [setActiveProjectSlug, setActivePlan, setTasks, setSelectedTaskId]
  )

  const handleSelectPlan = useCallback(
    async (slug: string) => {
      const result = await fetchPlan(slug)
      if (!result.ok) return
      const data = result.data
      setActivePlan(data.plan)
      setTasks(data.tasks || [])
      const firstTask = data.tasks?.[0]
      if (firstTask) {
        setSelectedTaskId(firstTask.id)
        setSelectedResource(null)
        setFocusTarget({ id: firstTask.id, timestamp: Date.now() })
      } else {
        setSelectedTaskId(null)
      }
    },
    [fetchPlan, setActivePlan, setTasks, setSelectedTaskId, setFocusTarget]
  )

  const handleSelectTask = useCallback(
    (task: Task, source: 'sidebar' | 'canvas' | 'dock' | 'hud' = 'sidebar') => {
      setSelectedResource(null)
      setSelectedTaskId(task.id)
      if (source !== 'canvas') {
        setFocusTarget({ id: task.id, timestamp: Date.now() })
      }
      if (workbenchRef.current && !workbenchRef.current.isPanelOpen('inspector')) {
        workbenchRef.current.openPanel('inspector')
      }
    },
    [setSelectedTaskId, setFocusTarget]
  )

  const handleSelectTaskId = useCallback(
    (taskId: string) => {
      const t = tasks.find((x) => x.id === taskId)
      if (t) {
        handleSelectTask(t, 'dock')
      } else {
        setSelectedResource(null)
        setSelectedTaskId(taskId)
        setFocusTarget({ id: taskId, timestamp: Date.now() })
      }
    },
    [tasks, handleSelectTask, setSelectedTaskId, setFocusTarget]
  )

  const handleSelectRunningTask = useCallback(
    (task: Task) => {
      setSelectedResource(null)
      setSelectedTaskId(task.id)
      setFocusTarget({ id: task.id, timestamp: Date.now() })
      setDockLens('output')
    },
    [setSelectedTaskId, setFocusTarget]
  )

  const handleSelectResource = useCallback(
    (res: Resource) => {
      setSelectedTaskId(null)
      setSelectedResource(res)
      if (workbenchRef.current && !workbenchRef.current.isPanelOpen('inspector')) {
        workbenchRef.current.openPanel('inspector')
      }
    },
    [setSelectedTaskId]
  )

  const handleDeselectResource = useCallback(() => {
    setSelectedResource(null)
  }, [])

  const handleOpenTerminal = useCallback(
    (task: Task) => {
      setSelectedResource(null)
      setSelectedTaskId(task.id)
      setDockLens('output')
      if (task.claim_session_id) {
        setTerminalTask(task)
      }
    },
    [setSelectedTaskId]
  )

  const handleDeletePlan = useCallback(
    async (slug: string) => {
      const res = await deletePlan(slug)
      if (!res.ok) {
        alert(`Failed to delete plan: ${res.error}`)
        return
      }
      await refreshData()
    },
    [deletePlan, refreshData]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const res = await deleteTask(taskId)
      if (!res.ok) {
        alert(`Failed to delete task: ${res.error}`)
        return
      }
      await refreshData()
    },
    [deleteTask, refreshData]
  )

  const handleAddDependency = useCallback(
    async (sourceTaskId: string, targetTaskId: string) => {
      const target = tasks.find((t) => t.id === targetTaskId)
      if (!target) return
      const existingDeps = target.dependencies || []
      if (existingDeps.includes(sourceTaskId)) return
      const newDeps = [...existingDeps, sourceTaskId]
      const res = await updateTaskDependencies(targetTaskId, newDeps)
      if (!res.ok) throw new Error(res.error)
      await refreshData()
    },
    [tasks, updateTaskDependencies, refreshData]
  )

  const handleDeleteEdge = useCallback(
    async (sourceTaskId: string, targetTaskId: string) => {
      const target = tasks.find((t) => t.id === targetTaskId)
      if (!target) return
      const existingDeps = target.dependencies || []
      const newDeps = existingDeps.filter((d) => d !== sourceTaskId)
      const res = await updateTaskDependencies(targetTaskId, newDeps)
      if (!res.ok) throw new Error(res.error)
      await refreshData()
    },
    [tasks, updateTaskDependencies, refreshData]
  )

  const onProjectSubmitWrapper = useCallback(
    async (slug: string, input: ProjectInput) => {
      await handleProjectSubmit(input)
      await refreshProjects()
      setActiveProjectSlug(slug)
    },
    [handleProjectSubmit, refreshProjects, setActiveProjectSlug]
  )

  const onPlanSubmitWrapper = useCallback(
    async (input: PlanInput) => {
      await handlePlanSubmit(input)
      setActivePlan({
        slug: input.slug,
        project_slug: input.project_slug,
        title: input.title,
        status: 'ACTIVE',
        version: input.version || 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    },
    [handlePlanSubmit, setActivePlan]
  )

  const handleCreateResourceSubmit = useCallback(
    async (form: ResourceForm) => {
      setCreateResourceBusy(true)
      setCreateResourceError('')
      const tags = parseTags(form.tags)
      const result = await createResource({
        project_slug: form.scope === 'GLOBAL' ? '' : form.project_slug,
        key: form.key.trim(),
        slug:
          form.slug.trim() ||
          form.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        kind: form.kind,
        type: form.type,
        types: form.types.length > 0 ? form.types : [form.type.toLowerCase()],
        format: form.format || 'markdown',
        scope: form.scope,
        scope_ref: form.scope_ref.trim() || undefined,
        title: form.title.trim(),
        path: form.isNative ? '' : form.path.trim(),
        summary: form.summary.trim(),
        content: form.content,
        status: form.status,
        tags,
      })
      setCreateResourceBusy(false)
      if (!result.ok) {
        setCreateResourceError(result.error)
        throw new Error(result.error)
      }
      setIsCreateResourceOpen(false)
      await refreshData()
      if (result.data) {
        handleSelectResource(result.data)
      }
    },
    [createResource, refreshData, handleSelectResource]
  )

  const [hideDoneTasks, setHideDoneTasks] = useState(false)

  const handleAttachResource = useCallback(
    async (taskId: string, resourceKey: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      const currentDocs = task.required_docs || []
      if (currentDocs.includes(resourceKey)) return
      const res = await updateTask(taskId, { required_docs: [...currentDocs, resourceKey] })
      if (!res.ok) {
        console.error('Failed to attach resource:', res.error)
        return
      }
      await refreshData()
    },
    [tasks, updateTask, refreshData]
  )

  const handleImportResource = useCallback(
    async (payload: ResourceDropPayload, target: DropTarget) => {
      if (payload.kind === 'existing') {
        const found = resources.find((r) => r.id === payload.resourceId)
        if (found) handleSelectResource(found)
        return
      }

      const projectSlug = target.scope === 'GLOBAL' ? '' : target.projectSlug || activeProjectSlug || ''
      const scopeRef = target.scope === 'PLAN' || target.scope === 'TASK' ? target.scopeRef : undefined

      const normalize = (raw: string) =>
        raw
          .replace(/\.[^.]+$/, '')
          .replace(/[^A-Za-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase() || 'context'

      const base = {
        project_slug: projectSlug,
        scope: target.scope,
        scope_ref: scopeRef,
        kind: 'spec' as const,
      }

      if (payload.kind === 'url') {
        const slug = normalize(payload.url)
        const result = await createResource({
          ...base,
          key: slug.toUpperCase().slice(0, 48),
          slug,
          type: 'REFERENCE',
          types: ['reference', 'link'],
          title: payload.url,
          summary: payload.url,
          url: payload.url,
        })
        if (result.ok && result.data) handleSelectResource(result.data)
        await refreshData()
        return
      }

      if (payload.kind === 'text') {
        const slug = normalize(payload.text.slice(0, 60))
        const result = await createResource({
          ...base,
          key: slug.toUpperCase().slice(0, 48),
          slug,
          type: 'MEMORY',
          types: ['memory'],
          title: payload.text.split('\n')[0].slice(0, 80) || 'Pasted note',
          content: payload.text,
        })
        if (result.ok && result.data) handleSelectResource(result.data)
        await refreshData()
        return
      }

      const file = payload.file
      const slug = normalize(file.name)
      const isText = /\.(md|markdown|txt|json|ya?ml|xml|csv|log)$/i.test(file.name)
      const content = isText ? await file.text() : ''

      const result = await createResource({
        ...base,
        key: slug.toUpperCase().slice(0, 48),
        slug,
        type: isText ? 'MEMORY' : 'REFERENCE',
        types: [isText ? 'memory' : 'reference'],
        title: file.name,
        content,
      })
      if (result.ok && result.data) {
        if (!isText) {
          await uploadResourceFile(result.data.id, file, file.name)
        }
        handleSelectResource(result.data)
      }
      await refreshData()
    },
    [resources, activeProjectSlug, createResource, uploadResourceFile, handleSelectResource, refreshData]
  )

  const handleUnlinkResource = useCallback(
    async (taskId: string, docRef: string) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      const next = (task.required_docs || []).filter((doc) => doc !== docRef)
      await updateTask(taskId, { required_docs: next })
    },
    [tasks, updateTask]
  )

  const handleTaskContextDrop = useCallback(
    async (taskId: string, payload: ResourceDropPayload) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return

      const link = async (docRef: string) => {
        const current = task.required_docs || []
        if (current.includes(docRef)) return
        await updateTask(taskId, { required_docs: [...current, docRef] })
      }

      if (payload.kind === 'existing') {
        await link(payload.resourceKey)
        return
      }

      const scope: ResourceScope = task.project_slug
        ? 'TASK'
        : activeProjectSlug
          ? 'PROJECT'
          : 'GLOBAL'
      const projectSlug = scope === 'GLOBAL' ? '' : task.project_slug || activeProjectSlug || ''
      const scopeRef = scope === 'TASK' ? task.id : undefined

      const normalize = (raw: string) =>
        raw
          .replace(/\.[^.]+$/, '')
          .replace(/[^A-Za-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase() || 'context'

      const base = {
        project_slug: projectSlug,
        scope,
        scope_ref: scopeRef,
        kind: 'spec' as const,
      }

      if (payload.kind === 'url') {
        const slug = normalize(payload.url)
        const created = await createResource({
          ...base,
          key: slug.toUpperCase().slice(0, 48),
          slug,
          type: 'REFERENCE',
          types: ['reference', 'link'],
          title: payload.url,
          summary: payload.url,
          url: payload.url,
        })
        if (created.ok && created.data) await link(created.data.key)
        await refreshData()
        return
      }

      if (payload.kind === 'text') {
        const slug = normalize(payload.text.slice(0, 60))
        const created = await createResource({
          ...base,
          key: slug.toUpperCase().slice(0, 48),
          slug,
          type: 'MEMORY',
          types: ['memory'],
          title: payload.text.split('\n')[0].slice(0, 80) || 'Pasted note',
          content: payload.text,
        })
        if (created.ok && created.data) await link(created.data.key)
        await refreshData()
        return
      }

      const file = payload.file
      const isText = /\.(md|markdown|txt|json|ya?ml|xml|csv|log)$/i.test(file.name)
      if (!isText) {
        // Binary goes to the task attachment lane, not the knowledge lane.
        await uploadTaskAttachment(taskId, file, file.name)
        await refreshData()
        return
      }

      const slug = normalize(file.name)
      const created = await createResource({
        ...base,
        key: slug.toUpperCase().slice(0, 48),
        slug,
        type: 'MEMORY',
        types: ['memory'],
        title: file.name,
        content: await file.text(),
      })
      if (created.ok && created.data) await link(created.data.key)
      await refreshData()
    },
    [tasks, activeProjectSlug, createResource, updateTask, uploadTaskAttachment, refreshData]
  )

  const handleDeselectTask = useCallback(() => {
    setSelectedTaskId(null)
    setSelectedResource(null)
  }, [setSelectedTaskId])

  // Panels menu ON/OFF owns the `enabled` axis; the layout only owns `open`.
  const handleToggleWorkbenchView = useCallback(
    (panelId: WorkbenchPanelId) => {
      if (enabledMap[panelId]) {
        setViewEnabled(panelId, false)
        workbenchRef.current?.closePanel(panelId)
      } else {
        setViewEnabled(panelId, true)
        workbenchRef.current?.openPanel(panelId)
      }
    },
    [enabledMap, setViewEnabled]
  )

  const handleResetWorkbench = useCallback(() => {
    resetViews()
    workbenchRef.current?.resetLayout()
  }, [resetViews])

  const handleFocusOrOpenPanel = useCallback(
    (panelId: WorkbenchPanelId, shiftKey: boolean) => {
      workbenchRef.current?.focusOrOpenPanel(panelId, shiftKey)
    },
    []
  )

  const workbenchState: WorkbenchState = useMemo(
    () => ({
      projects,
      activeProjectSlug,
      plans,
      activePlanSlug: activePlan?.slug || null,
      tasks,
      selectedTaskId,
      selectedTask,
      artifacts,
      resources,
      selectedResourceId: selectedResource?.id || null,
      selectedResource,
      hideDoneTasks,
      enabledViews,
      onResetWorkbenchLayout: handleResetWorkbench,
      onSelectProject: handleSelectProject,
      onSelectPlan: handleSelectPlan,
      onToggleHideDone: () => setHideDoneTasks((prev) => !prev),
      onNewProject: () => setIsProjectModalOpen(true),
      onNewPlan: () => setIsPlanModalOpen(true),
      onSelectTask: handleSelectTask,
      onSelectTaskId: handleSelectTaskId,
      onDeselectTask: handleDeselectTask,
      onOpenTerminal: handleOpenTerminal,
      onNewTask: openNewTask,
      onEditTask: openEditTask,
      onDeleteTask: handleDeleteTask,
      onAddDependency: handleAddDependency,
      onDeleteEdge: handleDeleteEdge,
      onAttachResource: handleAttachResource,
      onSelectResource: handleSelectResource,
      onDeselectResource: handleDeselectResource,
      onNewResource: () => setIsCreateResourceOpen(true),
      onRefreshResources: refreshData,
      onImportResource: handleImportResource,
      onTaskContextDrop: handleTaskContextDrop,
      onUnlinkResource: handleUnlinkResource,
      onFetchEnv: fetchGlobalEnv,
      onFetchStatus: fetchRuntimeStatus,
      focusTarget,
      logTick,
      fetchTaskPacket,
      dockLens,
    }),
    [
      projects,
      activeProjectSlug,
      plans,
      activePlan?.slug,
      tasks,
      selectedTaskId,
      selectedTask,
      artifacts,
      resources,
      selectedResource,
      hideDoneTasks,
      enabledViews,
      handleResetWorkbench,
      handleSelectProject,
      handleSelectPlan,
      handleSelectTask,
      handleSelectTaskId,
      handleDeselectTask,
      handleOpenTerminal,
      openNewTask,
      openEditTask,
      handleDeleteTask,
      handleAddDependency,
      handleDeleteEdge,
      handleAttachResource,
      handleImportResource,
      handleTaskContextDrop,
      handleUnlinkResource,
      handleSelectResource,
      handleDeselectResource,
      refreshData,
      fetchGlobalEnv,
      fetchRuntimeStatus,
      focusTarget,
      logTick,
      fetchTaskPacket,
      dockLens,
    ]
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 font-sans text-zinc-100">
      <HeaderBar
        connected={connected}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={handleSelectProject}
        activePlan={activePlan}
        plans={plans}
        onSelectPlan={handleSelectPlan}
        onNewPlan={() => setIsPlanModalOpen(true)}
        onDeletePlan={handleDeletePlan}
        onNewProject={() => setIsProjectModalOpen(true)}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        activeWorkers={activeWorkerCount}
        daemonVersion={daemonVersion}
        hudVisible={hudVisible}
        runningTasksCount={runningTasksCount}
        onToggleHud={toggleHud}
        onOpenWorkbenchPanel={(id) => workbenchRef.current?.openPanel(id)}
        onResetWorkbenchLayout={handleResetWorkbench}
        onToggleWorkbenchPanel={handleToggleWorkbenchView}
        isInspectorOpen={isInspectorOpen}
        enabledPanels={enabledMap}
      />

      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Activity rail: focus an open view, or reopen it at its default anchor */}
        <ActivityBar
          onFocusOrOpenPanel={handleFocusOrOpenPanel}
          enabledViews={enabledViews}
          openPanels={openPanels}
          activePanels={activePanels}
          resourcesCount={resources.length}
        />

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <DockviewWorkbench
            ref={workbenchRef}
            state={workbenchState}
            enabledViews={enabledViews}
            onPanelVisibilityChange={(panelId, isOpen) => {
              setOpenPanels((prev) => ({ ...prev, [panelId]: isOpen }))
              if (panelId === 'inspector') {
                setIsInspectorOpen(isOpen)
              }
            }}
            onActivePanelsChange={(activeMap) => {
              setActivePanels(activeMap)
            }}
          />
        </div>
      </div>

      <footer className="flex h-6 items-center justify-between border-t border-zinc-800/80 bg-zinc-900/90 px-3 text-[11px] text-zinc-400 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-500 animate-pulse'}`} />
            {connected ? 'Port 1123 Active' : 'Disconnected'}
          </span>
          <div className="h-3 w-[1px] bg-zinc-800" />
          <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${activeWorkerCount > 0 ? 'bg-violet-400 animate-pulse' : 'bg-zinc-600'}`} />
            Active Workers: {activeWorkerCount}
          </span>
          <div className="h-3 w-[1px] bg-zinc-800" />
          <span className="font-mono text-[10px] text-zinc-500">
            Tasks: {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-zinc-500">
          <button
            type="button"
            onClick={() => workbenchRef.current?.resetLayout()}
            className="flex items-center gap-1 hover:text-zinc-300 transition-colors text-zinc-500 cursor-pointer"
            title="Reset IDE Workbench to Default Layout"
          >
            <span>Reset Layout</span>
          </button>
          <span>ZenForge {daemonVersion ? `v${daemonVersion}` : 'v...'}</span>
        </div>
      </footer>

      {terminalTask && terminalTask.claim_session_id && (
        <TerminalModal
          sessionId={terminalTask.claim_session_id}
          taskTitle={terminalTask.title}
          onClose={() => setTerminalTask(null)}
        />
      )}

      <FloatingHUD
        tasks={tasks}
        visible={hudVisible}
        onClose={toggleHud}
        onSelectTask={handleSelectRunningTask}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        onSubmit={onProjectSubmitWrapper}
        busy={modalBusy}
      />

      <PlanModal
        isOpen={isPlanModalOpen}
        onClose={() => setIsPlanModalOpen(false)}
        onSubmit={onPlanSubmitWrapper}
        projects={projects}
        activeProjectSlug={activeProjectSlug}
        busy={modalBusy}
      />

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false)
        }}
        onSubmit={handleTaskSubmit}
        allTasks={tasks}
        activeProjectSlug={activeProjectSlug}
        activePlanSlug={activePlan?.slug}
        initialTask={editingTask}
        agents={agents}
        resources={resources}
        busy={modalBusy}
      />

      <CreateResourceModal
        isOpen={isCreateResourceOpen}
        onClose={() => setIsCreateResourceOpen(false)}
        onSubmit={handleCreateResourceSubmit}
        projects={projects}
        initialProjectSlug={activeProjectSlug || ''}
        busy={createResourceBusy}
        externalError={createResourceError}
      />
    </div>
  )
}
