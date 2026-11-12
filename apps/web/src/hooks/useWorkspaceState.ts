import { useState, useEffect, useCallback, useRef } from 'react'
import { useZenfAPI } from './useZenfAPI'
import { useWorkspaceNavigation, getInitialURLParam } from './useWorkspaceNavigation'
import { useWorkspaceLiveSync } from './useWorkspaceLiveSync'
import type { Project, Plan, Task, Artifact, Agent, Resource } from '../types/contracts'

export function useWorkspaceState() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsReady, setProjectsReady] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [activePlan, setActivePlan] = useState<Plan | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [daemonVersion, setDaemonVersion] = useState<string>('')
  // True once the active plan and its tasks have been resolved, so a `plan` or
  // `task` URL parameter can be safely dropped when it no longer matches.
  const [selectionResolved, setSelectionResolved] = useState(false)

  const activePlanRef = useRef<Plan | null>(null)
  activePlanRef.current = activePlan
  const refreshSeqRef = useRef(0)

  const {
    activeProjectSlug,
    setActiveProjectSlug,
    selectedTaskId,
    setSelectedTaskId,
    focusTarget,
    setFocusTarget,
  } = useWorkspaceNavigation(activePlan?.slug, {
    project: projectsReady,
    selection: selectionResolved,
  })

  const api = useZenfAPI()
  const {
    fetchProjects,
    fetchPlans,
    fetchPlan,
    fetchTasks,
    fetchTaskArtifacts,
    fetchAgents,
    fetchResources,
    fetchGlobalEnv,
  } = api

  const refreshArtifacts = useCallback(
    async (taskId: string | null) => {
      if (!taskId) {
        setArtifacts([])
        return
      }
      const artsRes = await fetchTaskArtifacts(taskId)
      setArtifacts(artsRes.ok ? artsRes.data : [])
    },
    [fetchTaskArtifacts]
  )

  useEffect(() => {
    refreshArtifacts(selectedTaskId)
  }, [selectedTaskId, refreshArtifacts])

  const refreshProjects = useCallback(async () => {
    const result = await fetchProjects(false)
    if (!result.ok) return
    setProjects(result.data)
    setActiveProjectSlug((current) => {
      if (current && result.data.some((project) => project.slug === current)) {
        return current
      }
      const initialFromUrlOrStorage = getInitialURLParam('project', 'zenf_active_project')
      if (initialFromUrlOrStorage && result.data.some((p) => p.slug === initialFromUrlOrStorage)) {
        return initialFromUrlOrStorage
      }
      return result.data.find((project) => project.status === 'ACTIVE')?.slug || result.data[0]?.slug || null
    })
    setProjectsReady(true)
  }, [fetchProjects, setActiveProjectSlug])

  const refreshData = useCallback(async () => {
    if (!projectsReady) return

    const seq = ++refreshSeqRef.current

    const plansResult = await fetchPlans(activeProjectSlug || '', showArchived)
    if (!plansResult.ok) return
    if (seq !== refreshSeqRef.current) return

    const availablePlans = plansResult.data
    setPlans(availablePlans)
    const availableSlugs = new Set(availablePlans.map((p) => p.slug))

    let targetPlanSlug = activePlanRef.current?.slug
    const initialPlanFromUrlOrStorage = getInitialURLParam('plan', 'zenf_active_plan')
    if (!targetPlanSlug && initialPlanFromUrlOrStorage && availableSlugs.has(initialPlanFromUrlOrStorage)) {
      targetPlanSlug = initialPlanFromUrlOrStorage
    }
    if (!targetPlanSlug || !availableSlugs.has(targetPlanSlug)) {
      const taskRes = await fetchTasks(activeProjectSlug ? { projectSlug: activeProjectSlug } : undefined)
      if (!taskRes.ok) return
      if (seq !== refreshSeqRef.current) return
      const taskList = taskRes.data
      targetPlanSlug = taskList.find((t) => t.plan_slug && availableSlugs.has(t.plan_slug))?.plan_slug
      targetPlanSlug = targetPlanSlug || availablePlans[0]?.slug
    }

    if (!targetPlanSlug) {
      setTasks([])
      setActivePlan(null)
      setSelectedTaskId(null)
      setArtifacts([])
      setSelectionResolved(true)
      return
    }

    const planResult = await fetchPlan(targetPlanSlug)
    if (seq !== refreshSeqRef.current) return

    if (!planResult.ok) {
      if (planResult.status === 404) {
        setActivePlan(null)
        setTasks([])
        setSelectedTaskId(null)
        setArtifacts([])
        setSelectionResolved(true)
      }
      return
    }

    const planData = planResult.data
    setActivePlan(planData.plan)
    const planTasks = planData.tasks || []
    setTasks(planTasks)

    setSelectedTaskId((prev) => {
      if (prev && planTasks.some((t) => t.id === prev)) {
        return prev
      }
      const initialTaskFromUrlOrStorage = getInitialURLParam('task', 'zenf_selected_task')
      if (initialTaskFromUrlOrStorage && planTasks.some((t) => t.id === initialTaskFromUrlOrStorage)) {
        return initialTaskFromUrlOrStorage
      }
      return planTasks[0]?.id || null
    })
    setSelectionResolved(true)
  }, [
    activeProjectSlug,
    fetchTasks,
    fetchPlans,
    fetchPlan,
    projectsReady,
    showArchived,
    setSelectedTaskId,
  ])

  const refreshResourcesCallback = useCallback(async () => {
    const res = await fetchResources({ includeGlobal: true })
    if (res.ok) setResources(res.data)
  }, [fetchResources])

  const { connected, logTick } = useWorkspaceLiveSync({
    onRefreshData: refreshData,
    onRefreshProjects: refreshProjects,
    onRefreshResources: refreshResourcesCallback,
  })

  useEffect(() => {
    void refreshProjects()
    void fetchAgents(true).then((res) => {
      if (res.ok) setAgents(res.data)
    })
    void refreshResourcesCallback()
    void fetchGlobalEnv().then((res) => {
      if (res.ok && typeof res.data === 'object' && res.data !== null) {
        const payload = res.data as { version?: string }
        if (payload.version) {
          setDaemonVersion(payload.version)
        }
      }
    })
  }, [refreshProjects, fetchAgents, refreshResourcesCallback, fetchGlobalEnv])

  useEffect(() => {
    refreshSeqRef.current++
    setSelectionResolved(false)
  }, [activeProjectSlug])

  useEffect(() => {
    if (!projectsReady) return
    void refreshData()
  }, [projectsReady, refreshData])

  useEffect(() => {
    const onFocus = () => {
      void refreshData()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshData])

  return {
    api,
    connected,
    projects,
    projectsReady,
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
    selectionResolved,
    artifacts,
    agents,
    resources,
    daemonVersion,
    refreshData,
    refreshProjects,
    refreshArtifacts,
  }
}
