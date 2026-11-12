import { useCallback, useMemo } from 'react'
import type {
  Agent,
  AgentInput,
  Artifact,
  ContextPacket,
  Resource,
  ResourceFilter,
  ResourceInput,
  ResourceSearchResult,
  ResourceStatus,
  EventMessage,
  Plan,
  PlanInput,
  Project,
  ProjectInput,
  ProjectStatus,
  RuntimeTelemetry,
  SearchResult,
  Task,
  TaskInput,
  TaskPatchInput,
} from '../types/contracts'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status?: number }

async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, init)
    if (!res.ok) {
      const text = await res.text()
      let errorMsg = text.trim() || res.statusText || `HTTP ${res.status}`
      let errorCode: string | undefined
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) {
          errorMsg = parsed.error.message
          errorCode = parsed.error.code
        } else if (typeof parsed?.error === 'string') {
          errorMsg = parsed.error
        }
      } catch {
        // text is plain error
      }
      return {
        ok: false,
        error: errorMsg,
        code: errorCode,
        status: res.status,
      }
    }
    if (res.status === 204) {
      return { ok: true, data: undefined as T }
    }
    const text = await res.text()
    if (!text) {
      return { ok: true, data: undefined as T }
    }
    return { ok: true, data: JSON.parse(text) as T }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function jsonInit(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export function useZenfAPI() {
  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------
  const fetchProjects = useCallback(async (includeArchived = false): Promise<ApiResult<Project[]>> => {
    const result = await apiRequest<{ projects?: Project[] }>(
      `/api/v1/projects${includeArchived ? '?include_archived=true' : ''}`
    )
    return result.ok ? { ok: true, data: result.data?.projects || [] } : result
  }, [])

  const createProject = useCallback(async (input: ProjectInput): Promise<ApiResult<Project>> => {
    return apiRequest<Project>('/api/v1/projects', jsonInit('POST', input))
  }, [])

  const updateProject = useCallback(
    async (
      slug: string,
      patch: Partial<ProjectInput> & { status?: ProjectStatus }
    ): Promise<ApiResult<Project>> => {
      return apiRequest<Project>(`/api/v1/projects/${encodeURIComponent(slug)}`, jsonInit('PATCH', patch))
    },
    []
  )

  const deleteProject = useCallback(async (slug: string): Promise<ApiResult<void>> => {
    return apiRequest<void>(`/api/v1/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  }, [])

  // -------------------------------------------------------------------------
  // Plans and tasks
  // -------------------------------------------------------------------------
  const fetchPlans = useCallback(
    async (projectSlug = '', includeArchived = false): Promise<ApiResult<Plan[]>> => {
      const query = queryString({
        project_slug: projectSlug,
        include_archived: includeArchived,
      })
      const result = await apiRequest<{ plans?: Plan[] }>(`/api/v1/plans${query}`)
      return result.ok ? { ok: true, data: result.data?.plans || [] } : result
    },
    []
  )

  const fetchPlan = useCallback(
    async (slug: string): Promise<ApiResult<{ plan: Plan; tasks: Task[] }>> => {
      return apiRequest<{ plan: Plan; tasks: Task[] }>(`/api/v1/plans/${encodeURIComponent(slug)}`)
    },
    []
  )

  const createPlan = useCallback(async (input: PlanInput): Promise<ApiResult<{ status: string; slug: string; tasks: number }>> => {
    return apiRequest<{ status: string; slug: string; tasks: number }>('/api/v1/plans', jsonInit('POST', input))
  }, [])

  const deletePlan = useCallback(async (slug: string): Promise<ApiResult<void>> => {
    return apiRequest<void>(`/api/v1/plans/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  }, [])

  const createTask = useCallback(async (input: TaskInput): Promise<ApiResult<Task>> => {
    return apiRequest<Task>('/api/v1/tasks', jsonInit('POST', input))
  }, [])

  const updateTask = useCallback(async (id: string, patch: TaskPatchInput): Promise<ApiResult<Task>> => {
    return apiRequest<Task>(`/api/v1/tasks/${encodeURIComponent(id)}`, jsonInit('PATCH', patch))
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<ApiResult<void>> => {
    return apiRequest<void>(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }, [])

  const updateTaskDependencies = useCallback(async (id: string, dependencies: string[]): Promise<ApiResult<{ id: string; dependencies: string[] }>> => {
    return apiRequest<{ id: string; dependencies: string[] }>(`/api/v1/tasks/${encodeURIComponent(id)}/dependencies`, jsonInit('POST', { dependencies }))
  }, [])

  const fetchTasks = useCallback(
    async (filter?: {
      projectSlug?: string
      planSlug?: string
      status?: string
      agentSlug?: string
      orphan?: boolean
    }): Promise<ApiResult<Task[]>> => {
      const query = queryString({
        project_slug: filter?.projectSlug,
        plan_slug: filter?.planSlug,
        status: filter?.status,
        agent_slug: filter?.agentSlug,
        orphan: filter?.orphan,
      })
      const result = await apiRequest<{ tasks?: Task[] } | Task[]>(`/api/v1/tasks${query}`)
      if (!result.ok) return result
      const tasks = Array.isArray(result.data) ? result.data : result.data?.tasks || []
      return { ok: true, data: tasks }
    },
    []
  )

  const fetchTaskArtifacts = useCallback(
    async (taskId: string, role?: string): Promise<ApiResult<Artifact[]>> => {
      const query = role ? `?role=${encodeURIComponent(role)}` : ''
      const result = await apiRequest<{ artifacts?: Artifact[] } | Artifact[]>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts${query}`
      )
      if (!result.ok) return result
      const artifacts = Array.isArray(result.data) ? result.data : result.data?.artifacts || []
      return { ok: true, data: artifacts }
    },
    []
  )

  const fetchTaskPacket = useCallback(
    async (taskId: string): Promise<ApiResult<ContextPacket>> => {
      return apiRequest<ContextPacket>(`/api/v1/tasks/${encodeURIComponent(taskId)}?include_packet=true`)
    },
    []
  )

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  const fetchResources = useCallback(async (filter?: ResourceFilter): Promise<ApiResult<Resource[]>> => {
    const query = queryString({
      project_slug: filter?.projectSlug,
      include_global: filter?.includeGlobal,
      kind: filter?.kind,
      type: filter?.type,
      types: filter?.types?.join(','),
      format: filter?.format,
      scope: filter?.scope,
      scope_ref: filter?.scopeRef,
      status: filter?.status,
      tag: filter?.tag,
      limit: filter?.limit,
    })
    const result = await apiRequest<{ resources?: Resource[] }>(`/api/v1/resources${query}`)
    return result.ok ? { ok: true, data: result.data?.resources || [] } : result
  }, [])

  const fetchResource = useCallback(
    async (id: string, format?: 'blocks'): Promise<ApiResult<Resource>> => {
      const q = format ? `?format=${format}` : ''
      return apiRequest<Resource>(`/api/v1/resources/${encodeURIComponent(id)}${q}`)
    },
    []
  )

  const searchResources = useCallback(
    async (query: string, projectSlug = '', kind = ''): Promise<ApiResult<ResourceSearchResult[]>> => {
      const params = queryString({ project_slug: projectSlug, include_global: true, kind: kind || undefined, limit: 50 })
      const result = await apiRequest<{ results?: ResourceSearchResult[] } | ResourceSearchResult[]>(
        `/api/v1/resources/search${params}${params ? '&' : '?'}query=${encodeURIComponent(query)}`
      )
      if (!result.ok) return result
      const list = Array.isArray(result.data) ? result.data : (result.data?.results || [])
      return { ok: true, data: list }
    },
    []
  )

  const createResource = useCallback(async (input: ResourceInput): Promise<ApiResult<Resource>> => {
    return apiRequest<Resource>('/api/v1/resources', jsonInit('POST', input))
  }, [])

  const updateResource = useCallback(
    async (
      id: string,
      patch: {
        title?: string
        summary?: string
        kind?: string
        status?: ResourceStatus
        path?: string
        format?: string
        types?: string[]
        content?: string
        tags?: string[]
      }
    ): Promise<ApiResult<Resource>> => {
      return apiRequest<Resource>(`/api/v1/resources/${encodeURIComponent(id)}`, jsonInit('PATCH', patch))
    },
    []
  )

  const refreshResource = useCallback(async (id: string): Promise<ApiResult<Resource>> => {
    return apiRequest<Resource>(`/api/v1/resources/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  }, [])

  const deleteResource = useCallback(async (id: string): Promise<ApiResult<void>> => {
    return apiRequest<void>(`/api/v1/resources/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }, [])

  // -------------------------------------------------------------------------
  // Agents and observed sessions
  // -------------------------------------------------------------------------
  const uploadTaskAttachment = useCallback(
    async (taskId: string, file: Blob, name?: string): Promise<ApiResult<Artifact>> => {
      const form = new FormData()
      form.append('file', file, name || (file as File).name || 'attachment')
      if (name) form.append('name', name)
      return apiRequest<Artifact>(`/api/v1/tasks/${encodeURIComponent(taskId)}/attachments`, {
        method: 'POST',
        body: form,
      })
    },
    []
  )

  const fetchResourceFiles = useCallback(async (resourceId: string): Promise<ApiResult<Artifact[]>> => {
    const result = await apiRequest<{ files?: Artifact[] }>(
      `/api/v1/resources/${encodeURIComponent(resourceId)}/files`
    )
    return result.ok ? { ok: true, data: result.data?.files || [] } : result
  }, [])

  const uploadResourceFile = useCallback(
    async (resourceId: string, file: Blob, name?: string): Promise<ApiResult<Artifact>> => {
      const form = new FormData()
      form.append('file', file, name || (file as File).name || 'attachment')
      if (name) form.append('name', name)
      return apiRequest<Artifact>(`/api/v1/resources/${encodeURIComponent(resourceId)}/files`, {
        method: 'POST',
        body: form,
      })
    },
    []
  )

  const deleteResourceFile = useCallback(
    async (resourceId: string, fileId: string): Promise<ApiResult<void>> => {
      return apiRequest<void>(
        `/api/v1/resources/${encodeURIComponent(resourceId)}/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE' }
      )
    },
    []
  )

  const fetchAgents = useCallback(async (includeDisabled = false): Promise<ApiResult<Agent[]>> => {
    const query = includeDisabled ? '?include_disabled=true' : ''
    const result = await apiRequest<{ agents?: Agent[] }>(`/api/v1/agents${query}`)
    return result.ok ? { ok: true, data: result.data?.agents || [] } : result
  }, [])

  const createAgent = useCallback(async (input: AgentInput): Promise<ApiResult<Agent>> => {
    return apiRequest<Agent>('/api/v1/agents', jsonInit('POST', input))
  }, [])

  const updateAgent = useCallback(
    async (slug: string, patch: Partial<AgentInput>): Promise<ApiResult<Agent>> => {
      return apiRequest<Agent>(`/api/v1/agents/${encodeURIComponent(slug)}`, jsonInit('PATCH', patch))
    },
    []
  )

  const deleteAgent = useCallback(async (slug: string): Promise<ApiResult<void>> => {
    return apiRequest<void>(`/api/v1/agents/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  }, [])

  // -------------------------------------------------------------------------
  // Activity and search
  // -------------------------------------------------------------------------
  const fetchEvents = useCallback(
    async (afterId = 0, limit = 200): Promise<ApiResult<EventMessage[]>> => {
      const query = queryString({ after_id: afterId || undefined, limit })
      const result = await apiRequest<{ events?: EventMessage[] } | EventMessage[]>(`/api/v1/events${query}`)
      if (!result.ok) return result
      const list = Array.isArray(result.data) ? result.data : result.data?.events || []
      return { ok: true, data: list }
    },
    []
  )

  const searchAll = useCallback(async (query: string, projectSlug = ''): Promise<ApiResult<SearchResult[]>> => {
    const params = queryString({ q: query, project_slug: projectSlug, limit: 50 })
    const result = await apiRequest<{ results?: SearchResult[] }>(`/api/v1/search${params}`)
    return result.ok ? { ok: true, data: result.data?.results || [] } : result
  }, [])

  const fetchGlobalEnv = useCallback(async (): Promise<ApiResult<Record<string, any>>> => {
    return apiRequest<Record<string, any>>('/api/v1/env/global')
  }, [])

  const fetchRuntimeStatus = useCallback(async (): Promise<ApiResult<RuntimeTelemetry>> => {
    return apiRequest<RuntimeTelemetry>('/api/v1/status')
  }, [])

  return useMemo(
    () => ({
      fetchProjects,
      createProject,
      updateProject,
      deleteProject,
      fetchPlans,
      fetchPlan,
      createPlan,
      deletePlan,
      fetchTasks,
      createTask,
      updateTask,
      deleteTask,
      updateTaskDependencies,
      fetchTaskArtifacts,
      fetchTaskPacket,
      fetchResources,
      fetchResource,
      searchResources,
      createResource,
      updateResource,
      refreshResource,
      deleteResource,
      uploadTaskAttachment,
      fetchResourceFiles,
      uploadResourceFile,
      deleteResourceFile,
      fetchAgents,
      createAgent,
      updateAgent,
      deleteAgent,
      fetchEvents,
      searchAll,
      fetchGlobalEnv,
      fetchRuntimeStatus,
    }),
    [
      fetchProjects,
      createProject,
      updateProject,
      deleteProject,
      fetchPlans,
      fetchPlan,
      createPlan,
      deletePlan,
      fetchTasks,
      createTask,
      updateTask,
      deleteTask,
      updateTaskDependencies,
      fetchTaskArtifacts,
      fetchTaskPacket,
      fetchResources,
      fetchResource,
      searchResources,
      createResource,
      updateResource,
      refreshResource,
      deleteResource,
      uploadTaskAttachment,
      fetchResourceFiles,
      uploadResourceFile,
      deleteResourceFile,
      fetchAgents,
      createAgent,
      updateAgent,
      deleteAgent,
      fetchEvents,
      searchAll,
      fetchGlobalEnv,
      fetchRuntimeStatus,
    ]
  )
}
