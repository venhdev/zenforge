import React, { useState } from 'react'
import { GitFork, Kanban, Zap } from 'lucide-react'
import { DAGCanvas } from './DAGCanvas'
import { SwimlanesView } from './SwimlanesView'
import type { Task } from '../../types/contracts'

export interface StageContainerProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (task: Task, source?: 'sidebar' | 'canvas' | 'dock') => void
  onDeselectTask?: () => void
  onOpenTerminal?: (task: Task) => void
  onAttachResource?: (taskId: string, resourceKey: string) => void
  onAddDependency?: (sourceTaskId: string, targetTaskId: string) => Promise<void>
  onDeleteEdge?: (sourceTaskId: string, targetTaskId: string) => Promise<void>
  focusTarget?: { id: string; timestamp: number } | null
}

export const StageContainer: React.FC<StageContainerProps> = ({
  tasks,
  selectedTaskId,
  onSelectTask,
  onDeselectTask,
  onOpenTerminal,
  onAttachResource,
  onAddDependency,
  onDeleteEdge,
  focusTarget,
}) => {
  const [viewMode, setViewMode] = useState<'dag' | 'swimlanes'>('dag')
  const [showBlast, setShowBlast] = useState(false)

  return (
    <main className="relative flex flex-1 flex-col h-full w-full min-h-0 overflow-hidden bg-zinc-950">
      {/* Unified Top Toolbar: Switcher between DAG Flow Canvas & Kanban Swimlanes + Controls */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 select-none shrink-0 z-20 backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('dag')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
              viewMode === 'dag'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <GitFork className="h-3.5 w-3.5" />
            <span>DAG Flow Canvas</span>
          </button>
          <button
            onClick={() => setViewMode('swimlanes')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
              viewMode === 'swimlanes'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span>Kanban Swimlanes</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {viewMode === 'dag' && selectedTaskId && (
            <button
              onClick={() => setShowBlast((value) => !value)}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-semibold transition-colors ${
                showBlast
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Show depth-graded downstream blast radius"
            >
              <Zap
                className={`h-3.5 w-3.5 ${
                  showBlast ? 'fill-amber-400 text-amber-400' : 'text-zinc-500'
                }`}
              />
              <span>Blast Radius {showBlast ? 'On' : 'Off'}</span>
            </button>
          )}

          <div className="text-[11px] font-mono text-zinc-500">
            {tasks.length} total tasks
          </div>
        </div>
      </div>

      {/* Stage Body */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        {viewMode === 'dag' ? (
          <DAGCanvas
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            onDeselectTask={onDeselectTask}
            onOpenTerminal={onOpenTerminal}
            onAttachResource={onAttachResource}
            onAddDependency={onAddDependency}
            onDeleteEdge={onDeleteEdge}
            focusTarget={focusTarget}
            showBlast={showBlast}
          />
        ) : (
          <SwimlanesView
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={(task) => onSelectTask(task, 'canvas')}
          />
        )}
      </div>
    </main>
  )
}
