import React, { useState, useEffect, useCallback, useRef, memo } from 'react'
import { ChevronRight, ChevronLeft, Layers, Activity } from 'lucide-react'
import { TaskSpecPane } from './TaskSpecPane'
import { TaskOutputPane } from './TaskOutputPane'
import type { Task, Artifact, ContextPacket, Resource } from '../../types/contracts'
import type { ResourceDropPayload } from '../workspace/resources/ResourceDropOverlay'
import type { ApiResult } from '../../hooks/useZenfAPI'

export type DockLens = 'input' | 'output'

interface InspectionDockProps {
  selectedTask: Task | null
  allTasks: Task[]
  artifacts: Artifact[]
  onSelectTaskId?: (taskId: string) => void
  onEditTask?: (task: Task) => void
  onDeleteTask?: (taskId: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  fetchTaskPacket?: (taskId: string) => Promise<ApiResult<ContextPacket>>
  initialLens?: DockLens
  resources?: Resource[]
  onTaskContextDrop?: (taskId: string, payload: ResourceDropPayload) => Promise<void>
  onUnlinkResource?: (taskId: string, docRef: string) => Promise<void>
}

function computeDefaultLens(task: Task | null): DockLens {
  if (
    task &&
    (task.status === 'RUNNING' ||
      task.status === 'COMPLETED' ||
      task.status === 'FAILED' ||
      task.status === 'AWAITING_REVIEW')
  ) {
    return 'output'
  }
  return 'input'
}

export const InspectionDockComponent: React.FC<InspectionDockProps> = ({
  selectedTask,
  allTasks,
  artifacts,
  onSelectTaskId,
  onEditTask,
  onDeleteTask,
  collapsed,
  onToggleCollapse,
  fetchTaskPacket,
  initialLens,
  resources,
  onTaskContextDrop,
  onUnlinkResource,
}) => {
  const [activeLens, setActiveLens] = useState<DockLens>(() => {
    if (initialLens) return initialLens
    return computeDefaultLens(selectedTask)
  })

  // Retain caller's active tab across task selection (do not override user's active lens)
  const prevTaskIdRef = useRef<string | null>(selectedTask?.id || null)
  useEffect(() => {
    if (selectedTask?.id) {
      if (!prevTaskIdRef.current && !initialLens) {
        setActiveLens(computeDefaultLens(selectedTask))
      }
      prevTaskIdRef.current = selectedTask.id
    } else {
      prevTaskIdRef.current = null
    }
  }, [selectedTask?.id, initialLens])

  useEffect(() => {
    if (initialLens) {
      setActiveLens(initialLens)
    }
  }, [initialLens])

  const handleViewArtifacts = useCallback(() => setActiveLens('output'), [])

  if (collapsed) {
    return (
      <aside className="flex w-10 flex-col items-center border-l border-zinc-800 bg-zinc-900/60 py-3 select-none">
        <button
          onClick={onToggleCollapse}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
          title="Expand Inspection Dock"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  const lenses: { key: DockLens; label: string; icon: React.ReactNode }[] = [
    { key: 'input', label: 'Input & Spec', icon: <Layers className="h-3 w-3 text-cyan-400" /> },
    { key: 'output', label: 'Output & Artifacts', icon: <Activity className="h-3 w-3 text-emerald-400" /> },
  ]

  return (
    <aside
      className="relative flex h-full w-full flex-1 flex-col bg-zinc-950 select-none overflow-hidden"
    >
      {/* Dock Top Lens Bar */}
      <div className="flex h-9 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 text-xs text-zinc-400">
        <div className="flex items-center gap-1 overflow-hidden">
          {lenses.map((lens) => (
            <button
              key={lens.key}
              onClick={() => setActiveLens(lens.key)}
              title={lens.label}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold transition-colors shrink-0 ${
                activeLens === lens.key
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
              }`}
            >
              {lens.icon}
              <span className="hidden sm:inline truncate max-w-[110px]">{lens.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onToggleCollapse}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition shrink-0 ml-1"
          title="Collapse Inspector Dock"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Pane Content */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {activeLens === 'input' && (
          <div className="h-full overflow-hidden">
            <TaskSpecPane
              task={selectedTask}
              allTasks={allTasks}
              artifacts={artifacts}
              onSelectTaskId={onSelectTaskId}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              fetchTaskPacket={fetchTaskPacket}
              onViewArtifacts={handleViewArtifacts}
              resources={resources}
              onTaskContextDrop={onTaskContextDrop}
              onUnlinkResource={onUnlinkResource}
            />
          </div>
        )}

        {activeLens === 'output' && (
          <div className="h-full overflow-hidden">
            <TaskOutputPane task={selectedTask} artifacts={artifacts} />
          </div>
        )}
      </div>
    </aside>
  )
}

export const InspectionDock = memo(InspectionDockComponent)
