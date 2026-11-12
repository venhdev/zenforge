export type ProjectStatus = 'ACTIVE' | 'ARCHIVED'
export type PlanStatus = 'ACTIVE' | 'COMPLETED' | 'DRIFTED' | 'ARCHIVED'

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'AWAITING_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED'

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3'
export type TaskComplexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'SPIKE'
export type TaskRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type PhaseStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED'

export interface TaskPhase {
  id: string
  title: string
  status: PhaseStatus
  notes?: string
  started_at?: string
  completed_at?: string
}

export interface Project {
  slug: string
  name: string
  root_path?: string
  description?: string
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export interface ProjectInput {
  slug: string
  name: string
  root_path?: string
  description?: string
}

export interface Plan {
  slug: string
  project_slug: string
  title: string
  status: PlanStatus
  version?: number
  created_at: string
  updated_at: string
}

export interface PlanInput {
  slug: string
  project_slug: string
  title: string
  version?: number
  tasks?: TaskInput[]
}

export interface TaskInput {
  id: string
  project_slug?: string
  plan_slug?: string
  title: string
  description?: string
  dependencies?: string[]
  priority?: TaskPriority
  complexity?: TaskComplexity
  risk_level?: TaskRisk
  agent_slug?: string
  required_skills?: string[]
  required_docs?: string[]
  target_files?: string[]
  acceptance_criteria?: string[]
  verification_commands?: string[]
  worktree_path?: string
  auto_run?: boolean
  phases?: TaskPhase[]
  current_phase?: string
  status?: TaskStatus
}

export interface TaskPatchInput {
  title?: string
  description?: string
  dependencies?: string[]
  priority?: TaskPriority
  complexity?: TaskComplexity
  risk_level?: TaskRisk
  agent_slug?: string
  required_skills?: string[]
  required_docs?: string[]
  target_files?: string[]
  acceptance_criteria?: string[]
  verification_commands?: string[]
  worktree_path?: string
  auto_run?: boolean
  phases?: TaskPhase[]
  current_phase?: string
}

export interface Task {
  id: string
  project_slug?: string
  plan_slug?: string
  title: string
  description?: string
  dependencies: string[]
  priority?: TaskPriority
  complexity?: TaskComplexity
  risk_level?: TaskRisk
  agent_slug?: string
  required_skills?: string[]
  required_docs?: string[]
  target_files?: string[]
  acceptance_criteria?: string[]
  verification_commands?: string[]
  worktree_path?: string
  auto_run?: boolean
  status: TaskStatus
  claimed_by?: string
  claimed_at?: string
  claim_session_id?: string
  notes?: string
  review_reason?: string
  review_details?: string
  review_options?: string[]
  phases?: TaskPhase[]
  current_phase?: string
  created_at: string
  updated_at: string
}

export type ArtifactType = 'IMAGE' | 'MARKDOWN' | 'DOC' | 'FILE'

/** A stored file owned by exactly one entity: a task (execution) or a resource
 *  (knowledge attachment). */
export interface Artifact {
  id: string
  task_id?: string
  resource_id?: string
  role?: 'INPUT' | 'OUTPUT'
  name: string
  type: ArtifactType
  file_path: string
  mime_type: string
  byte_size: number
  sha256: string
  created_at: string
}

export type ResourceKind = 'spec' | 'soul' | 'harness' | 'artifact'

export type ResourceType =
  | 'ARCHITECTURE'
  | 'ADR'
  | 'SPEC'
  | 'RULE'
  | 'GUIDE'
  | 'REFERENCE'
  | 'MEMORY'
  | 'OTHER'

export type ResourceScope = 'GLOBAL' | 'PROJECT' | 'PLAN' | 'TASK'
export type ResourceStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED'

export interface ResourceBlock {
  id: string
  type: string
  format: string
  data: any
  metadata?: Record<string, any>
}

export interface Resource {
  id: string
  project_slug?: string
  key: string
  slug: string
  kind: ResourceKind
  type: ResourceType
  scope: ResourceScope
  scope_ref?: string
  title: string
  format?: string
  types?: string[]
  path: string
  /** External reference link; mutually exclusive with `path`. */
  url?: string
  content_hash: string
  byte_size: number
  status: ResourceStatus
  summary?: string
  content?: string
  blocks?: ResourceBlock[]
  tags?: string[]
  version: number
  created_at: string
  updated_at: string
}

export interface ResourceBrief {
  id: string
  project_slug?: string
  key: string
  slug: string
  kind: ResourceKind
  type: ResourceType
  scope: ResourceScope
  title: string
  summary?: string
  content?: string
  tags?: string[]
  version: number
}

export interface ContextPacket {
  task: Task
  project?: Project
  plan?: Plan
  agent?: Agent
  target_files: string[]
  skill_paths: string[]
  input_attachments: Artifact[]
  linked_resources?: ResourceBrief[]
  verification_commands: string[]
  prompt_markdown: string
}

export interface ResourceInput {
  project_slug?: string
  key: string
  slug?: string
  kind?: ResourceKind
  type?: ResourceType
  types?: string[]
  format?: string
  scope: ResourceScope
  scope_ref?: string
  title: string
  path?: string
  url?: string
  summary?: string
  content?: string
  status?: ResourceStatus
  tags?: string[]
}

export interface ResourceFilter {
  projectSlug?: string
  includeGlobal?: boolean
  kind?: ResourceKind | ''
  type?: ResourceType | ''
  types?: string[]
  format?: string
  scope?: ResourceScope | ''
  scopeRef?: string
  status?: ResourceStatus | ''
  tag?: string
  limit?: number
  version?: string
}

export interface ResourceSearchResult {
  resource: Resource
  snippet: string
}

export type AgentMode = 'HEADLESS' | 'INTERACTIVE'

export interface AgentStartConditions {
  task_status?: TaskStatus
  max_risk_level?: TaskRisk
  max_complexity?: TaskComplexity
  max_concurrency?: number
}

export interface AgentStopConditions {
  on_failure?: 'AWAITING_REVIEW' | 'FAIL'
  timeout_seconds?: number
}

/** A resource key of a `kind=soul` resource; the persona the agent adopts. */
export type SoulKey = string

export interface Agent {
  slug: string
  name: string
  soul_key?: SoulKey
  /** Reserved: no headless/interactive dispatcher consumes this yet. */
  mode: AgentMode
  /** Display-only; never alters the compiled prompt. */
  goal?: string
  start_conditions?: AgentStartConditions
  stop_conditions?: AgentStopConditions
  /** Reserved: no scheduler consumes this yet. */
  schedule?: string
  /** Execution ceiling: restricts which skills a task may load, never adds. */
  skills?: string[]
  runner?: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AgentInput {
  slug: string
  name: string
  soul_key?: SoulKey
  mode: AgentMode
  goal?: string
  start_conditions?: AgentStartConditions
  stop_conditions?: AgentStopConditions
  schedule?: string
  skills?: string[]
  runner?: string
  enabled: boolean
}

export type SessionType = 'MAIN' | 'SUBAGENT' | 'WORKER'
export type SessionStatus = 'ACTIVE' | 'IDLE' | 'DISCONNECTED' | 'TERMINATED'

export interface AgentSession {
  id: string
  agent_slug?: string
  session_type: SessionType
  parent_id?: string
  external_ref?: string
  status: SessionStatus
  started_at: string
  last_seen_at: string
  ended_at?: string
}

export interface SearchResult {
  entity_type: string
  entity_id: string
  title: string
  snippet?: string
  project_slug?: string
}

export interface EventMessage {
  id: number
  project_slug?: string
  plan_slug?: string
  task_id?: string
  entity_type: string
  entity_id: string
  type: string
  actor?: string
  payload: string
  timestamp: string
}

export interface RuntimeTelemetry {
  pid: number
  version: string
  os: string
  arch: string
  started_at: string
  uptime_seconds: number
  goroutines: number
  gomaxprocs: number
  heap_alloc_bytes: number
  heap_inuse_bytes: number
  sys_bytes: number
  stack_inuse_bytes: number
  rss_bytes: number
  cpu_seconds: number
  go_cpu_user_seconds: number
  go_cpu_gc_seconds: number
  go_cpu_total_seconds: number
  open_fds: number
  os_source: string
  sse_clients: number
  active_sessions: number
}
