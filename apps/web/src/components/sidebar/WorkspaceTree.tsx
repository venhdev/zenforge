import React, { useState, useMemo } from 'react'
import {
  FolderGit2,
  Folder,
  FileCode,
  Search,
  Plus,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { Task, Project, Plan } from '../../types/contracts'
import { TASK_STATUS_CONFIG } from '../stage/taskStatusTheme'

export interface WorkspaceTreeProps {
  projects?: Project[]
  activeProjectSlug?: string | null
  plans?: Plan[]
  activePlanSlug?: string | null
  tasks: Task[]
  selectedTaskId: string | null
  hideDoneTasks?: boolean
  onSelectProject?: (projectSlug: string) => void
  onSelectPlan?: (planSlug: string) => void
  onSelectTask: (task: Task, source?: 'sidebar') => void
  onToggleHideDone?: () => void
  onNewProject?: () => void
  onNewPlan?: () => void
  onNewTask?: () => void
}

export const WorkspaceTree: React.FC<WorkspaceTreeProps> = ({
  projects = [],
  activeProjectSlug,
  plans = [],
  activePlanSlug,
  tasks,
  selectedTaskId,
  hideDoneTasks = false,
  onSelectProject,
  onSelectPlan,
  onSelectTask,
  onToggleHideDone,
  onNewProject,
  onNewPlan,
  onNewTask,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    if (activeProjectSlug) init[activeProjectSlug] = true
    return init
  })
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    if (activePlanSlug) init[activePlanSlug] = true
    return init
  })

  // Auto-expand active project & plan if changed
  React.useEffect(() => {
    if (activeProjectSlug) {
      setExpandedProjects((prev) => ({ ...prev, [activeProjectSlug]: true }))
    }
  }, [activeProjectSlug])

  React.useEffect(() => {
    if (activePlanSlug) {
      setExpandedPlans((prev) => ({ ...prev, [activePlanSlug]: true }))
    }
  }, [activePlanSlug])

  const toggleProject = (slug: string) => {
    setExpandedProjects((prev) => ({ ...prev, [slug]: !prev[slug] }))
  }

  const togglePlan = (slug: string) => {
    setExpandedPlans((prev) => ({ ...prev, [slug]: !prev[slug] }))
  }

  // Filter tasks based on search term and hideDone
  const displayedTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (hideDoneTasks && t.status === 'COMPLETED') return false
      if (!searchTerm) return true
      const term = searchTerm.toLowerCase()
      return (
        t.id.toLowerCase().includes(term) ||
        t.title.toLowerCase().includes(term) ||
        (t.plan_slug && t.plan_slug.toLowerCase().includes(term))
      )
    })
  }, [tasks, searchTerm, hideDoneTasks])

  // Count done tasks
  const doneCount = useMemo(() => {
    return tasks.filter((t) => t.status === 'COMPLETED').length
  }, [tasks])

  return (
    <aside
      className="flex w-full h-full flex-1 flex-col bg-zinc-950 select-none overflow-hidden text-xs text-zinc-300"
      data-testid="workspace-tree"
    >
      {/* Top Header */}
      <div className="flex h-9 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 shrink-0">
        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-zinc-400">
          <FolderGit2 className="h-3.5 w-3.5 text-cyan-400" />
          <span className="truncate">Hierarchy</span>
          <span className="rounded bg-zinc-800 px-1 py-0.2 text-[10px] text-zinc-400 font-mono">
            {displayedTasks.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Hide Done Toggle */}
          {onToggleHideDone && (
            <button
              onClick={onToggleHideDone}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                hideDoneTasks
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
              title={hideDoneTasks ? 'Show Completed Tasks' : `Hide ${doneCount} Completed Tasks`}
              aria-label="Toggle Hide Done"
            >
              {hideDoneTasks ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span className="hidden sm:inline">{hideDoneTasks ? 'Hidden' : 'Hide Done'}</span>
            </button>
          )}

          {/* Quick Actions */}
          {onNewProject && (
            <button
              onClick={onNewProject}
              className="p-1 rounded text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800 transition"
              title="New Project"
              aria-label="New Project"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}

          {onNewTask && (
            <button
              onClick={onNewTask}
              className="flex items-center gap-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-semibold transition"
              title="Create New Task"
              aria-label="New Task"
            >
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline">Task</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input */}
      <div className="border-b border-zinc-800/80 p-2 shrink-0 bg-zinc-950">
        <div className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-300 focus-within:border-cyan-500/50">
          <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            placeholder="Search hierarchy..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none placeholder:text-zinc-600 font-mono text-[11px]"
            aria-label="Filter tasks by ID or name"
          />
        </div>
      </div>

      {/* Hierarchy Tree Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-0.5 font-mono">
        {/* Render Projects */}
        {projects.length > 0 ? (
          projects.map((proj) => {
            const isProjActive = proj.slug === activeProjectSlug
            const isProjExpanded = !!expandedProjects[proj.slug]
            const projPlans = plans.filter((p) => p.project_slug === proj.slug)

            return (
              <div key={proj.slug} className="group/proj">
                {/* Project Header Row */}
                <div
                  className={`flex items-center justify-between rounded px-1.5 py-1 text-[11px] cursor-pointer transition-colors ${
                    isProjActive
                      ? 'bg-zinc-800/90 text-cyan-300 font-medium'
                      : 'hover:bg-zinc-900 text-zinc-300'
                  }`}
                  onClick={() => {
                    toggleProject(proj.slug)
                    onSelectProject?.(proj.slug)
                  }}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-zinc-500">
                      {isProjExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </span>
                    <Folder className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">{proj.name || proj.slug}</span>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover/proj:opacity-100 transition-opacity">
                    {onNewPlan && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectProject?.(proj.slug)
                          onNewPlan()
                        }}
                        className="p-0.5 text-zinc-400 hover:text-white rounded"
                        title="Add Plan to Project"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Plans inside Project */}
                {isProjExpanded && (
                  <div className="ml-3 pl-1.5 border-l border-zinc-800/80 space-y-0.5 mt-0.5">
                    {projPlans.length > 0 ? (
                      projPlans.map((plan) => {
                        const isPlanActive = plan.slug === activePlanSlug
                        const isPlanExpanded = !!expandedPlans[plan.slug]
                        const planTasks = displayedTasks.filter((t) => t.plan_slug === plan.slug)

                        return (
                          <div key={plan.slug} className="group/plan">
                            {/* Plan Header Row */}
                            <div
                              className={`flex items-center justify-between rounded px-1.5 py-0.5 text-[11px] cursor-pointer transition-colors ${
                                isPlanActive
                                  ? 'bg-cyan-950/40 text-cyan-300 font-medium border border-cyan-800/40'
                                  : 'hover:bg-zinc-900 text-zinc-400'
                              }`}
                              onClick={() => {
                                togglePlan(plan.slug)
                                onSelectPlan?.(plan.slug)
                              }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-zinc-500">
                                  {isPlanExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </span>
                                <FileCode className="h-3 w-3 text-cyan-500 shrink-0" />
                                <span className="truncate">{plan.title || plan.slug}</span>
                              </div>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                ({planTasks.length})
                              </span>
                            </div>

                            {/* Tasks under Plan */}
                            {isPlanExpanded && (
                              <div className="ml-3 pl-1.5 border-l border-zinc-800/60 space-y-0.5 mt-0.5">
                                {planTasks.length > 0 ? (
                                  planTasks.map((t) => {
                                    const isTaskActive = t.id === selectedTaskId
                                    return (
                                      <div
                                        key={t.id}
                                        onClick={() => onSelectTask(t, 'sidebar')}
                                        className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] cursor-pointer transition-colors ${
                                          isTaskActive
                                            ? 'bg-violet-600/30 text-white font-medium border border-violet-500/40'
                                            : 'hover:bg-zinc-900 text-zinc-300'
                                        }`}
                                      >
                                        <span className="shrink-0">
                                          {TASK_STATUS_CONFIG[t.status]?.icon || (
                                            <div className="h-2 w-2 rounded-full bg-zinc-600" />
                                          )}
                                        </span>
                                        <span className="truncate">{t.id}</span>
                                        <span className="truncate text-zinc-500 font-sans text-[10px]">
                                          {t.title}
                                        </span>
                                      </div>
                                    )
                                  })
                                ) : (
                                  <div className="py-1 text-[10px] text-zinc-600 italic px-1">
                                    No tasks in this plan
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="py-1 text-[10px] text-zinc-600 italic px-1">
                        No active plans
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          /* Fallback: Flat Task list if no projects are configured */
          <div className="space-y-0.5">
            {displayedTasks.map((t) => {
              const isTaskActive = t.id === selectedTaskId
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t, 'sidebar')}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] cursor-pointer transition-colors ${
                    isTaskActive
                      ? 'bg-violet-600/30 text-white font-medium border border-violet-500/40'
                      : 'hover:bg-zinc-900 text-zinc-300'
                  }`}
                >
                  <span className="shrink-0">
                    {TASK_STATUS_CONFIG[t.status]?.icon || (
                      <div className="h-2 w-2 rounded-full bg-zinc-600" />
                    )}
                  </span>
                  <span className="font-mono">{t.id}</span>
                  <span className="truncate text-zinc-400 font-sans text-[10px]">{t.title}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
