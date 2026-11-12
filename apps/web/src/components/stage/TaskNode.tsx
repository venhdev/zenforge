import { memo, useState, useEffect, useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Zap,
  Bot,
  Terminal as TerminalIcon,
  Copy,
  Check,
  FileText,
  BookOpen,
  AlertTriangle,
} from 'lucide-react'
import type { Task, TaskPriority } from '../../types/contracts'
import { TASK_STATUS_CONFIG } from './taskStatusTheme'
import { elapsedLabel } from '../../lib/duration'

export interface TaskNodeData {
  task: Task
  isSelected: boolean
  isFocusNeighbor?: boolean
  isBlastRadius?: boolean
  isDimmed?: boolean
  blastDepth?: number
  onSelect: (task: Task) => void
  onOpenTerminal?: (task: Task) => void
  onAttachResource?: (taskId: string, resourceKey: string) => void
}

function getBlastOpacity(isBlastRadius?: boolean, blastDepth?: number): string {
  if (!isBlastRadius || blastDepth === undefined) return ''
  if (blastDepth <= 2) return 'opacity-80'
  if (blastDepth === 3) return 'opacity-60'
  return 'opacity-40'
}

function getSelectionRing(isSelected?: boolean, isFocusNeighbor?: boolean, isBlastRadius?: boolean): string {
  if (isSelected) return 'ring-2 ring-violet-500 shadow-[0_0_18px_rgba(139,92,246,0.4)]'
  if (isFocusNeighbor) return 'ring-1 ring-violet-500/45 shadow-[0_0_14px_rgba(139,92,246,0.2)]'
  if (isBlastRadius) return 'ring-1 ring-amber-500/80 shadow-[0_0_16px_rgba(245,158,11,0.25)] border-amber-500/50'
  return ''
}

function getPriorityBadgeClass(priority: TaskPriority): string {
  switch (priority) {
    case 'P0':
      return 'border-rose-500/40 bg-rose-500/20 text-rose-300'
    case 'P1':
      return 'border-amber-500/40 bg-amber-500/20 text-amber-300'
    case 'P2':
      return 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
    case 'P3':
      return 'border-zinc-700/60 bg-zinc-800 text-zinc-400'
    default:
      return 'border-zinc-700/60 bg-zinc-800 text-zinc-400'
  }
}

function formatDuration(startIso?: string, endIso?: string): string | null {
  if (!startIso) return null
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null

  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`
}

function getPhaseIndex(task: Task): number {
  if (!task.phases || task.phases.length === 0) return 0
  if (task.status === 'COMPLETED') return task.phases.length
  if (task.current_phase) {
    const idx = task.phases.findIndex((p) => p.id === task.current_phase)
    if (idx >= 0) return idx + 1
  }
  const inProgressIdx = task.phases.findIndex((p) => p.status === 'IN_PROGRESS')
  if (inProgressIdx >= 0) return inProgressIdx + 1
  const completedCount = task.phases.filter((p) => p.status === 'COMPLETED').length
  return Math.min(completedCount + 1, task.phases.length)
}

export const TaskNode = memo(({ data }: { data: TaskNodeData }) => {
  const {
    task,
    isSelected,
    isFocusNeighbor,
    isBlastRadius,
    isDimmed,
    blastDepth,
    onSelect,
  } = data

  const [copied, setCopied] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (task.status !== 'RUNNING' || !task.claimed_at) return
    const interval = setInterval(() => {
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [task.status, task.claimed_at])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(task.id).catch(() => {})
    }
    setCopied(true)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/zenf-resource')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'link'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const raw = e.dataTransfer.getData('application/zenf-resource')
    if (raw && data.onAttachResource) {
      try {
        const payload = JSON.parse(raw) as { key: string }
        if (payload?.key) {
          data.onAttachResource(task.id, payload.key)
        }
      } catch {
        // ignore
      }
    }
  }

  const style = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.PENDING
  const blastOpacity = getBlastOpacity(isBlastRadius, blastDepth)
  const selectionRing = getSelectionRing(isSelected, isFocusNeighbor, isBlastRadius)

  const hasScopeChips = Boolean(
    (task.target_files && task.target_files.length > 0) ||
    (task.acceptance_criteria && task.acceptance_criteria.length > 0) ||
    (task.required_docs && task.required_docs.length > 0) ||
    task.complexity ||
    task.risk_level
  )

  const duration = task.status === 'COMPLETED' ? formatDuration(task.claimed_at, task.updated_at) : null

  return (
    <div
      onClick={() => onSelect(task)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={`task-node-${task.id}`}
      className={`w-72 rounded-lg border p-3 transition-all cursor-pointer select-none backdrop-blur-sm isolate relative ${
        style.border
      } ${style.bg} ${style.glow} ${selectionRing} ${isDimmed ? 'opacity-30' : blastOpacity} ${
        isDragOver ? '!border-cyan-400 !ring-2 !ring-cyan-400 !bg-cyan-950/70 shadow-[0_0_24px_rgba(6,182,212,0.6)]' : ''
      }`}
    >
      {isDragOver && (
        <div data-testid="drop-overlay" className="absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-cyan-950/85 border-2 border-dashed border-cyan-400 backdrop-blur-sm text-cyan-300 font-mono text-xs font-semibold pointer-events-none">
          <span>+ Attach Resource</span>
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-zinc-500"
      />

      {/* Tier 1: Header */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {task.priority && (
            <span
              data-testid="task-priority-badge"
              className={`rounded border px-1 py-0.2 text-[9px] font-mono font-bold shrink-0 ${getPriorityBadgeClass(
                task.priority
              )}`}
              title={`Priority: ${task.priority}`}
            >
              {task.priority}
            </span>
          )}
          <div
            data-testid="task-id-container"
            className="flex items-center gap-1 font-mono text-xs font-bold text-zinc-100 group/id min-w-0 flex-1 truncate cursor-pointer"
            title={`Copy Task ID (${task.id})`}
            onClick={handleCopy}
          >
            <span className="truncate whitespace-nowrap">{task.id}</span>
            <button
              type="button"
              data-testid="copy-task-id"
              onClick={handleCopy}
              className={`p-0.5 rounded shrink-0 transition flex items-center gap-0.5 ${
                copied
                  ? 'text-emerald-400 opacity-100'
                  : 'text-zinc-500 hover:text-zinc-200 opacity-0 group-hover/id:opacity-100'
              }`}
              title={copied ? 'Copied!' : `Copy Task ID (${task.id})`}
            >
              {copied ? (
                <>
                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                  <span className="text-[9px] font-sans font-normal text-emerald-400">Copied!</span>
                </>
              ) : (
                <Copy className="h-2.5 w-2.5" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {task.auto_run && (
            <span
              data-testid="task-autorun-badge"
              className="flex items-center gap-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 px-1 py-0.2 text-[9px] font-mono text-emerald-300"
              title="Auto-run enabled (automatically claimed and executed on READY)"
            >
              <Zap className="h-2.5 w-2.5 text-emerald-400" />
              <span>AUTO</span>
            </span>
          )}
          {isBlastRadius && !isSelected && (
            <span
              className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-300"
              title="Downstream Blast Radius (affected if upstream changes)"
            >
              <Zap className="h-2.5 w-2.5 text-amber-400" />
              <span>RADIUS</span>
            </span>
          )}
          <span
            data-testid="task-status-badge"
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.text}`}
          >
            {task.status}
          </span>
        </div>
      </div>

      {/* Tier 2: Body & Scope */}
      <div
        data-testid="task-title"
        className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-zinc-200"
        title={task.title}
      >
        {task.title}
      </div>

      {hasScopeChips && (
        <div data-testid="task-scope-chips" className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.target_files && task.target_files.length > 0 && (
            <span
              data-testid="chip-files"
              className="inline-flex items-center gap-1 rounded bg-zinc-800/80 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300"
              title={`${task.target_files.length} target files`}
            >
              <FileText className="h-2.5 w-2.5 text-zinc-400 shrink-0" />
              <span>{task.target_files.length} files</span>
            </span>
          )}
          {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
            <span
              data-testid="chip-criteria"
              className="inline-flex items-center gap-1 rounded bg-zinc-800/80 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300"
              title={`${task.acceptance_criteria.length} acceptance criteria`}
            >
              <span className="text-emerald-400">✓</span>
              <span>{task.acceptance_criteria.length} criteria</span>
            </span>
          )}
          {task.complexity && (
            <span
              data-testid="chip-complexity"
              className="inline-flex items-center gap-1 rounded bg-zinc-800/80 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300"
              title={`Complexity: ${task.complexity}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
              <span>{task.complexity}</span>
            </span>
          )}
          {task.risk_level && (
            <span
              data-testid="chip-risk"
              className="inline-flex items-center gap-1 rounded bg-zinc-800/80 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300"
              title={`Risk: ${task.risk_level}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>{task.risk_level}</span>
            </span>
          )}
          {task.required_docs && task.required_docs.length > 0 && (
            <span
              data-testid="chip-docs"
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-mono text-amber-300"
              title={`${task.required_docs.length} linked resources: ${task.required_docs.join(', ')}`}
            >
              <BookOpen className="h-2.5 w-2.5 text-amber-400 shrink-0" />
              <span>{task.required_docs.length} {task.required_docs.length === 1 ? 'doc' : 'docs'}</span>
            </span>
          )}
        </div>
      )}

      {/* Tier 3: Footer by Status */}
      {task.phases && task.phases.length > 0 && (
        <div data-testid="task-phases" className="mt-2 border-t border-zinc-800/80 pt-1.5 space-y-1">
          <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400">
            <span>
              Phase {getPhaseIndex(task)}/{task.phases.length}
            </span>
            {task.current_phase && (
              <span className="truncate max-w-[120px] text-zinc-500">
                {task.phases.find((p) => p.id === task.current_phase)?.title || task.current_phase}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {task.phases.map((phase, idx) => {
              let barColor = 'bg-zinc-700'
              if (phase.status === 'COMPLETED') barColor = 'bg-emerald-500'
              else if (phase.status === 'IN_PROGRESS') barColor = 'bg-violet-500 animate-pulse'
              else if (phase.status === 'FAILED') barColor = 'bg-rose-500'

              return (
                <div
                  key={phase.id || idx}
                  className={`h-1 flex-1 rounded-full ${barColor}`}
                  title={`${phase.title || `Phase ${idx + 1}`}: ${phase.status}`}
                />
              )
            })}
          </div>
        </div>
      )}

      {task.status === 'RUNNING' && (
        <div data-testid="task-running-footer" className="mt-2 space-y-1.5 border-t border-zinc-800/80 pt-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-violet-300 font-mono truncate">
            <Bot className="h-3 w-3 text-violet-400 shrink-0" />
            <span className="truncate">{task.claimed_by || task.agent_slug || 'external'}</span>
            {task.agent_slug && task.claimed_by && task.claimed_by !== task.agent_slug && (
              <span className="rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1 py-0.2 text-[8px] font-mono shrink-0">
                for {task.agent_slug}
              </span>
            )}
            {task.claimed_at && (
              <span className="text-[9px] text-zinc-400 shrink-0">
                · {elapsedLabel(task.claimed_at)}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="terminal-session-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onOpenTerminal?.(task)
            }}
            className="flex w-full items-center justify-center gap-1 rounded bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white px-2 py-0.5 text-[10px] font-mono border border-zinc-700/50 transition cursor-pointer"
            title="Open Live Terminal"
          >
            <TerminalIcon className="h-2.5 w-2.5 text-emerald-400" />
            <span>
              {task.claim_session_id
                ? `>_ Terminal (${task.claim_session_id.slice(0, 6)})`
                : '>_ Terminal'}
            </span>
          </button>
        </div>
      )}

      {task.status === 'COMPLETED' && (
        <div data-testid="task-completed-footer" className="mt-2 flex items-center justify-between gap-1 text-[9px] text-emerald-400/80 font-mono truncate border-t border-zinc-800/80 pt-1.5">
          <span className="truncate">
            ✓ by {task.claimed_by || task.agent_slug || 'external'}
          </span>
          {(duration || task.claimed_at) && (
            <span className="text-zinc-500 shrink-0">
              {duration || elapsedLabel(task.claimed_at)}
            </span>
          )}
        </div>
      )}

      {task.status === 'AWAITING_REVIEW' && (
        <div data-testid="task-review-alert" className="mt-2 rounded border border-orange-500/40 bg-orange-500/10 p-1.5 text-[10px] text-orange-300">
          <div className="flex items-center gap-1 font-semibold uppercase tracking-wider text-[9px] text-orange-400">
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
            <span>Review Required</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-orange-200/90 font-mono text-[9px]" title={task.review_reason || 'Review requested'}>
            {task.review_reason || 'Review requested'}
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-900 !bg-zinc-500"
      />
    </div>
  )
}, (prev, next) => {
  const p = prev.data
  const n = next.data
  return (
    p.isSelected === n.isSelected &&
    p.isFocusNeighbor === n.isFocusNeighbor &&
    p.isBlastRadius === n.isBlastRadius &&
    p.isDimmed === n.isDimmed &&
    p.blastDepth === n.blastDepth &&
    p.task.id === n.task.id &&
    p.task.status === n.task.status &&
    p.task.title === n.task.title &&
    p.task.priority === n.task.priority &&
    p.task.complexity === n.task.complexity &&
    p.task.review_reason === n.task.review_reason &&
    p.task.target_files?.length === n.task.target_files?.length &&
    p.task.acceptance_criteria?.length === n.task.acceptance_criteria?.length &&
    p.task.phases?.length === n.task.phases?.length &&
    p.task.current_phase === n.task.current_phase &&
    p.task.claim_session_id === n.task.claim_session_id &&
    p.task.claimed_by === n.task.claimed_by &&
    p.task.agent_slug === n.task.agent_slug &&
    p.task.auto_run === n.task.auto_run &&
    p.task.claimed_at === n.task.claimed_at &&
    p.task.updated_at === n.task.updated_at
  )
})

TaskNode.displayName = 'TaskNode'
