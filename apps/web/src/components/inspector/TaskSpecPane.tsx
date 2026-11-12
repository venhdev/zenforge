import React, { useState, useMemo, useRef, useEffect, memo } from 'react'
import {
  Terminal,
  Copy,
  Check,
  CheckCircle2,
  GitBranch,
  Clock,
  Layers,
  ExternalLink,
  FileCode,
  FileCheck,
  Loader2,
  BookOpen,
  Sparkles,
  Bot,
  Shield,
  CalendarDays,
  PlayCircle,
  AlertCircle,
  Paperclip,
  ChevronRight,
  Lock,
  FileSpreadsheet,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { Task, ContextPacket, Artifact, Resource } from '../../types/contracts'
import type { ResourceDropPayload } from '../workspace/resources/ResourceDropOverlay'
import type { ApiResult } from '../../hooks/useZenfAPI'
import { getTaskStatusStyle } from '../stage/taskStatusTheme'
import { parseTaskDescription } from '../../lib/taskDescriptionParser'
import { ArtifactPreviewModal } from './ArtifactPreviewModal'

interface TaskSpecPaneProps {
  task: Task | null
  allTasks: Task[]
  artifacts?: Artifact[]
  onSelectTaskId?: (taskId: string) => void
  onEditTask?: (task: Task) => void
  onDeleteTask?: (taskId: string) => void
  isMaximized?: boolean
  onToggleMaximize?: () => void
  fetchTaskPacket?: (taskId: string) => Promise<ApiResult<ContextPacket>>
  onViewArtifacts?: () => void
  /** Resources available for the superseded warning on linked chips. */
  resources?: Resource[]
  /** Drop into the task context lanes: link, create scoped knowledge, upload binary. */
  onTaskContextDrop?: (taskId: string, payload: ResourceDropPayload) => Promise<void>
  onUnlinkResource?: (taskId: string, docRef: string) => Promise<void>
}

export const TaskSpecPaneComponent: React.FC<TaskSpecPaneProps> = ({
  task,
  allTasks,
  artifacts = [],
  onSelectTaskId,
  onEditTask,
  onDeleteTask,
  isMaximized = false,
  onToggleMaximize,
  fetchTaskPacket,
  onViewArtifacts,
  resources = [],
  onTaskContextDrop,
  onUnlinkResource,
}) => {
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [promptLoading, setPromptLoading] = useState(false)
  const [copiedVerify, setCopiedVerify] = useState(false)
  const [copiedTaskId, setCopiedTaskId] = useState(false)
  const [copiedPlanSlug, setCopiedPlanSlug] = useState(false)
  const [copiedDocKey, setCopiedDocKey] = useState<string | null>(null)
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null)
  const [contextDragOver, setContextDragOver] = useState(false)
  const [packet, setPacket] = useState<ContextPacket | null>(null)
  const [packetError, setPacketError] = useState<string | null>(null)
  const [promptModalContent, setPromptModalContent] = useState<string | null>(null)

  // Reset open preview modal when selected task changes
  useEffect(() => {
    setPreviewArtifact(null)
    setPromptModalContent(null)
  }, [task?.id])

  // Fetch packet when task changes
  useEffect(() => {
    setPacket(null)
    setPacketError(null)
    if (!task?.id || !fetchTaskPacket) return
    let active = true
    fetchTaskPacket(task.id)
      .then((res) => {
        if (!active) return
        if (res.ok) {
          setPacket(res.data)
        } else {
          setPacketError(res.error || 'Failed to load task context packet')
        }
      })
      .catch((err) => {
        if (active) {
          setPacketError(err instanceof Error ? err.message : 'Network error loading task context packet')
        }
      })
    return () => {
      active = false
    }
  }, [task?.id, fetchTaskPacket])

  // Timer cleanup on unmount (Resolving Finding #12)
  const timersRef = useRef<number[]>([])
  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => clearTimeout(id))
    }
  }, [])

  const setSafeTimeout = (fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay)
    timersRef.current.push(id)
  }

  const parsedDesc = useMemo(() => parseTaskDescription(task?.description), [task?.description])

  const taskMap = useMemo(() => new Map<string, Task>(allTasks.map((t) => [t.id, t])), [allTasks])

  const inputArtifacts = useMemo(() => artifacts.filter((a) => a.role === 'INPUT'), [artifacts])

  const supersededDocs = useMemo(() => {
    const superseded = new Set(
      resources.filter((r) => r.status === 'SUPERSEDED').map((r) => r.key)
    )
    return superseded
  }, [resources])

  if (!task) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center select-none text-zinc-500">
        <Terminal className="h-8 w-8 text-zinc-600 mb-2" />
        <p className="text-xs font-medium text-zinc-400">No task selected</p>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Select a task from the DAG canvas or sidebar to inspect its specification and status.
        </p>
      </div>
    )
  }

  const handleCopyAgentPrompt = async () => {
    let text = packet?.prompt_markdown
    if (!text && fetchTaskPacket) {
      setPromptLoading(true)
      try {
        const result = await fetchTaskPacket(task.id)
        if (result.ok && result.data?.prompt_markdown) {
          text = result.data.prompt_markdown
          setPacket(result.data)
        }
      } catch {
        // ignore
      } finally {
        setPromptLoading(false)
      }
    }
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
        setCopiedPrompt(true)
        setSafeTimeout(() => setCopiedPrompt(false), 2500)
      } catch {
        // ignore
      }
    }
  }

  const handlePreviewPrompt = async () => {
    let currentPacket = packet
    if (!currentPacket && fetchTaskPacket) {
      setPromptLoading(true)
      try {
        const res = await fetchTaskPacket(task.id)
        if (res.ok && res.data) {
          currentPacket = res.data
          setPacket(res.data)
        }
      } finally {
        setPromptLoading(false)
      }
    }
    if (currentPacket?.prompt_markdown) {
      setPromptModalContent(currentPacket.prompt_markdown)
    }
  }

  const handleCopyVerification = async () => {
    if (!task.verification_commands?.length) return
    try {
      await navigator.clipboard.writeText(task.verification_commands.join('\n'))
      setCopiedVerify(true)
      setSafeTimeout(() => setCopiedVerify(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleCopyTaskId = async () => {
    if (!task?.id) return
    try {
      await navigator.clipboard.writeText(task.id)
      setCopiedTaskId(true)
      setSafeTimeout(() => setCopiedTaskId(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleCopyPlanSlug = async () => {
    if (!task?.plan_slug) return
    try {
      await navigator.clipboard.writeText(task.plan_slug)
      setCopiedPlanSlug(true)
      setSafeTimeout(() => setCopiedPlanSlug(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleCopyDocQuery = async (key: string) => {
    const query = `zenf_find(type="resource", ids=["${key}"])`
    try {
      await navigator.clipboard.writeText(query)
      setCopiedDocKey(key)
      setSafeTimeout(() => setCopiedDocKey(null), 2000)
    } catch {
      // ignore
    }
  }

  const isCompleted = task.status === 'COMPLETED'

  const dispatchContextPayload = (payload: ResourceDropPayload) => {
    if (!task || !onTaskContextDrop) return
    void onTaskContextDrop(task.id, payload)
  }

  const handleContextDragOver = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    const supported =
      types.includes('application/zenf-resource') ||
      types.includes('Files') ||
      types.includes('text/uri-list') ||
      types.includes('text/plain')
    if (!supported) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setContextDragOver(true)
  }

  const handleContextDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setContextDragOver(false)

    const rawResource = event.dataTransfer.getData('application/zenf-resource')
    if (rawResource) {
      try {
        const parsed = JSON.parse(rawResource) as { id?: string; key?: string }
        if (parsed?.id && parsed?.key) {
          dispatchContextPayload({ kind: 'existing', resourceId: parsed.id, resourceKey: parsed.key })
          return
        }
      } catch {
        // fall through
      }
    }
    const file = event.dataTransfer.files?.[0]
    if (file) {
      dispatchContextPayload({ kind: 'file', file })
      return
    }
    const uri = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
    if (uri) {
      dispatchContextPayload(/^https?:\/\//i.test(uri.trim()) ? { kind: 'url', url: uri.trim() } : { kind: 'text', text: uri })
    }
  }

  const handleContextPaste = (event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData('text/plain')
    if (text.trim()) dispatchContextPayload({ kind: 'text', text })
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 font-sans select-none">
      {/* 1. Header Toolbar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3">
        <div className="flex items-center gap-2 overflow-hidden text-xs">
          <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <span className="font-semibold text-zinc-200 truncate">
            Task Specification Hub
          </span>
          <button
            type="button"
            onClick={handleCopyPlanSlug}
            className="flex items-center gap-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition truncate"
            title={`Click to copy plan slug (${task.plan_slug})`}
          >
            <span>[{task.project_slug ? `${task.project_slug} / ` : ''}{task.plan_slug || 'orphan'}]</span>
            {copiedPlanSlug ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5 text-zinc-500" />}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {onEditTask && (
            <button
              onClick={() => onEditTask(task)}
              className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2 py-0.5 text-[11px] font-semibold transition"
              title="Edit Task Specification"
            >
              <Pencil className="h-3 w-3 text-cyan-400" />
              <span>Edit</span>
            </button>
          )}
          {onDeleteTask && (
            <button
              onClick={() => {
                if (window.confirm(`Delete task ${task.id}: "${task.title}"?`)) {
                  onDeleteTask(task.id)
                }
              }}
              className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-700/60 hover:border-rose-500/40 px-2 py-0.5 text-[11px] font-semibold transition"
              title="Delete Task"
            >
              <Trash2 className="h-3 w-3" />
              <span>Delete</span>
            </button>
          )}
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              title={isMaximized ? 'Restore View' : 'Maximize Spec'}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {packetError && (
        <div data-testid="packet-error-banner" className="flex items-center justify-between gap-2 border-b border-rose-900/50 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300">
          <span className="truncate">⚠ Error loading context packet: {packetError}</span>
          <button
            type="button"
            onClick={() => {
              if (task?.id && fetchTaskPacket) {
                setPacketError(null)
                fetchTaskPacket(task.id)
                  .then((res) => {
                    if (res.ok) setPacket(res.data)
                    else setPacketError(res.error || 'Failed to load task context packet')
                  })
                  .catch((err) => setPacketError(err instanceof Error ? err.message : 'Network error'))
              }
            }}
            className="shrink-0 rounded bg-rose-900/40 px-2 py-0.5 text-[10px] font-medium text-rose-200 hover:bg-rose-800/60 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [contain:content] p-4 space-y-4">
        {/* Title, Status & ID */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold text-zinc-100">
                {task.id}
              </span>
              <button
                type="button"
                onClick={handleCopyTaskId}
                className="flex items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:bg-zinc-700 hover:text-white transition"
                title="Copy Task ID"
              >
                {copiedTaskId ? (
                  <>
                    <Check className="h-2.5 w-2.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-2.5 w-2.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${getTaskStatusStyle(
                  task.status
                )}`}
              >
                {task.status}
              </span>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-zinc-200 leading-snug">
            {task.title}
          </h2>

          {/* Phase Stepper Bar (Polymorphic: only rendered if phases exist) */}
          {task.phases && task.phases.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-cyan-400" />
                  <span>
                    Execution Phases ({task.phases.filter((p) => p.status === 'COMPLETED').length}/
                    {task.phases.length})
                  </span>
                </div>
                {task.current_phase && (
                  <span className="font-mono text-cyan-400 text-[10px] lowercase">
                    active: {task.current_phase}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                {task.phases.map((phase, idx) => {
                  const isCurrent = task.current_phase === phase.id
                  const isDone = phase.status === 'COMPLETED'
                  const isFailed = phase.status === 'FAILED'
                  const isSkipped = phase.status === 'SKIPPED'

                  return (
                    <React.Fragment key={phase.id}>
                      <div
                        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-mono shrink-0 transition-colors ${
                          isDone
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                            : isCurrent
                              ? 'border-cyan-500/70 bg-cyan-950/30 text-cyan-300 ring-1 ring-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                              : isFailed
                                ? 'border-rose-500/50 bg-rose-950/30 text-rose-300'
                                : isSkipped
                                  ? 'border-zinc-800 bg-zinc-900/30 text-zinc-500 line-through'
                                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-500'
                        }`}
                        title={phase.notes ? `${phase.title}: ${phase.notes}` : phase.title}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                        ) : isCurrent ? (
                          <PlayCircle className="h-3 w-3 text-cyan-400 animate-spin shrink-0" />
                        ) : isFailed ? (
                          <AlertCircle className="h-3 w-3 text-rose-400 shrink-0" />
                        ) : (
                          <Clock className="h-3 w-3 text-zinc-600 shrink-0" />
                        )}
                        <span className="font-sans font-medium text-[11px] truncate max-w-[130px]">
                          {phase.title}
                        </span>
                      </div>
                      {idx < (task.phases?.length || 0) - 1 && (
                        <ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          )}

          {/* Structured Description Blocks */}
          {parsedDesc.hasStructuredBlocks ? (
            <div className="space-y-3 pt-1">
              {/* Context Card */}
              {parsedDesc.context && (
                <div className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-3 space-y-1 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                    <Layers className="h-3 w-3" />
                    <span>Context</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed select-text whitespace-pre-wrap">
                    {parsedDesc.context}
                  </p>
                </div>
              )}

              {/* Input / Output 2-Column Grid */}
              {(parsedDesc.inputs?.length || parsedDesc.outputs?.length) ? (
                <div className="grid grid-cols-2 gap-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
                  {/* Inputs */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <FileCode className="h-3 w-3 text-cyan-400" />
                      <span>Inputs ({parsedDesc.inputs?.length || 0})</span>
                    </span>
                    <div className="space-y-1">
                      {parsedDesc.inputs && parsedDesc.inputs.length > 0 ? (
                        parsedDesc.inputs.map((inItem, idx) => (
                          <div
                            key={idx}
                            className="rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-cyan-300 border border-zinc-800/80 break-all select-text"
                          >
                            {inItem}
                          </div>
                        ))
                      ) : (
                        <span className="text-[11px] text-zinc-500 italic">None specified</span>
                      )}
                    </div>
                  </div>

                  {/* Outputs */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span>Outputs ({parsedDesc.outputs?.length || 0})</span>
                    </span>
                    <div className="space-y-1">
                      {parsedDesc.outputs && parsedDesc.outputs.length > 0 ? (
                        parsedDesc.outputs.map((outItem, idx) => (
                          <div
                            key={idx}
                            className="rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-emerald-300 border border-zinc-800/80 break-all select-text"
                          >
                            {outItem}
                          </div>
                        ))
                      ) : (
                        <span className="text-[11px] text-zinc-500 italic">None specified</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Condition Guards */}
              {parsedDesc.conditionGuards && parsedDesc.conditionGuards.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-2.5 space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    <Shield className="h-3 w-3" />
                    <span>Condition Guards</span>
                  </span>
                  <div className="space-y-1 font-mono text-[11px]">
                    {parsedDesc.conditionGuards.map((guard, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-black/60 px-2.5 py-1.5 text-amber-300/90 border border-amber-500/20 select-text break-all"
                      >
                        <code>{guard}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Constraints */}
              {parsedDesc.constraints && parsedDesc.constraints.length > 0 && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-950/10 p-2.5 space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                    <Lock className="h-3 w-3" />
                    <span>Constraints</span>
                  </span>
                  <div className="space-y-1">
                    {parsedDesc.constraints.map((c, idx) => (
                      <div key={idx} className="text-xs text-rose-200">
                        • {c}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Blocks */}
              {parsedDesc.customBlocks.map((block) => (
                <div key={block.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {block.label}
                  </span>
                  {block.items && block.items.length > 0 ? (
                    <div className="space-y-1">
                      {block.items.map((it, idx) => (
                        <div key={idx} className="text-xs text-zinc-300">
                          • {it}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap select-text">
                      {block.content}
                    </p>
                  )}
                </div>
              ))}

              {/* Preamble / General Notes */}
              {parsedDesc.generalNotes && (
                <p className="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed select-text">
                  {parsedDesc.generalNotes}
                </p>
              )}
            </div>
          ) : (
            /* Fallback to standard unstructured description */
            task.description && (
              <p className="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed select-text pt-1">
                {task.description}
              </p>
            )
          )}
        </div>

        {/* Triage Badges: Priority, Complexity, Risk */}
        {(task.priority || task.complexity || task.risk_level) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
            {task.priority && (
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                Priority: {task.priority}
              </span>
            )}
            {task.complexity && (
              <span className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-300">
                Complexity: {task.complexity}
              </span>
            )}
            {task.risk_level && (
              <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-300">
                Risk: {task.risk_level}
              </span>
            )}
          </div>
        )}

        {/* Agent Capabilities — required_skills, required_docs, agent_slug */}
        {(task.required_skills?.length || task.required_docs?.length || task.agent_slug) && (
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <Sparkles className="h-3 w-3 text-violet-400" />
              <span>Agent Capabilities</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {task.agent_slug && (
                <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 font-mono">
                  <Bot className="h-2.5 w-2.5 inline mr-1 text-zinc-400" />
                  {task.agent_slug}
                </span>
              )}
              {task.required_skills?.map((skill, idx) => (
                <span key={`skill-${idx}`} className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">
                  {skill}
                </span>
              ))}
              {task.required_docs?.map((docKey, idx) => {
                const isSuperseded = supersededDocs.has(docKey)
                return (
                  <span
                    key={`doc-${idx}`}
                    data-testid={`context-chip-${docKey}`}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
                      isSuperseded
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                    title={isSuperseded ? 'This resource is SUPERSEDED' : docKey}
                  >
                    <BookOpen className="h-2.5 w-2.5" />
                    {docKey}
                    {onUnlinkResource && (
                      <button
                        type="button"
                        data-testid={`context-chip-remove-${docKey}`}
                        onClick={() => void onUnlinkResource(task.id, docKey)}
                        className="text-current/70 hover:text-rose-400"
                        title="Unlink resource"
                      >
                        ×
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Task Context drop lane */}
        {onTaskContextDrop && (
          <div
            data-testid="task-context-dropzone"
            onDragOver={handleContextDragOver}
            onDragLeave={() => setContextDragOver(false)}
            onDrop={handleContextDrop}
            onPaste={handleContextPaste}
            className={`rounded border border-dashed px-2 py-2 text-[10px] transition ${
              contextDragOver
                ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200'
                : 'border-zinc-700 bg-zinc-900/30 text-zinc-500'
            }`}
          >
            Drop a resource, file, link or note here. Knowledge is scoped to this task; binaries become INPUT artifacts.
          </div>
        )}

        {/* Technical Resources & Contracts */}
        {packet?.linked_resources && packet.linked_resources.length > 0 && (
          <div className="space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <BookOpen className="h-3 w-3 text-amber-400" />
              <span>Technical Resources & Contracts ({packet.linked_resources.length})</span>
            </span>
            <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-2.5">
              {packet.linked_resources.map((res) => (
                <div key={res.id || res.key} className="flex items-start justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-950/60 p-2 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-amber-300">{res.key}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
                        {res.type} / {res.scope}
                      </span>
                      {res.version ? (
                        <span className="rounded bg-zinc-800/80 px-1 py-0.5 text-[9px] font-mono text-zinc-500">
                          v{res.version}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-zinc-200 font-medium truncate">{res.title}</div>
                    {res.summary && <div className="text-[11px] text-zinc-400 line-clamp-2">{res.summary}</div>}
                  </div>
                  <button
                    onClick={() => handleCopyDocQuery(res.key)}
                    title={`Copy MCP query: zenf_find(type="resource", ids=["${res.key}"])`}
                    className="flex shrink-0 items-center gap-1 rounded border border-zinc-700/60 bg-zinc-800/60 px-2 py-1 text-[10px] font-mono text-zinc-300 hover:border-amber-500/50 hover:text-amber-200 transition"
                  >
                    {copiedDocKey === res.key ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>zenf_find</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acceptance Criteria */}
        {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
          <div className="space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <FileCheck className="h-3 w-3 text-emerald-400" />
              <span>Acceptance Criteria ({task.acceptance_criteria.length})</span>
            </span>
            <div className="space-y-1 rounded border border-zinc-800 bg-zinc-900/40 p-2.5">
              {task.acceptance_criteria.map((ac, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-zinc-300">
                  {isCompleted ? (
                    <span className="text-emerald-400 font-bold shrink-0">☑</span>
                  ) : (
                    <span className="text-zinc-500 font-mono shrink-0 text-[11px]">◻ {String(idx + 1).padStart(2, '0')}.</span>
                  )}
                  <span>{ac}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Verification Commands */}
        {task.verification_commands && task.verification_commands.length > 0 && (
          <div className="space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                <Terminal className="h-3 w-3 text-emerald-400" />
                <span>Verification Commands ({task.verification_commands.length})</span>
              </span>
              <button
                onClick={handleCopyVerification}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
              >
                {copiedVerify ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy All</span>
                  </>
                )}
              </button>
            </div>
            <div className="space-y-1 font-mono text-[11px]">
              {task.verification_commands.map((cmd, idx) => (
                <div key={idx} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-emerald-300 select-text break-all">
                  <code>$ {cmd}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Target Files */}
        {task.target_files && task.target_files.length > 0 && (
          <div className="space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <FileCode className="h-3 w-3 text-cyan-400" />
              <span>Target Files ({task.target_files.length})</span>
            </span>
            <div className="space-y-1 font-mono text-[11px]">
              {task.target_files.map((tf, idx) => (
                <div key={idx} className="truncate rounded border border-zinc-800 bg-zinc-900/30 px-2 py-1 text-cyan-300">
                  {tf}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input Attachments (Zero-Footprint empty state rule) */}
        {inputArtifacts.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-2 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Paperclip className="h-3 w-3 text-cyan-400" />
                <span>Input Attachments ({inputArtifacts.length})</span>
              </div>
              {onViewArtifacts && (
                <button
                  onClick={onViewArtifacts}
                  className="text-cyan-400 hover:text-cyan-300 font-sans normal-case text-[11px] transition"
                >
                  View All →
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {inputArtifacts.slice(0, 4).map((art) => (
                <div
                  key={art.id}
                  onClick={() => setPreviewArtifact(art)}
                  className="relative h-14 w-14 rounded border border-zinc-800 bg-black/40 overflow-hidden shrink-0 group cursor-pointer hover:border-cyan-500/60 transition"
                  title={art.name}
                >
                  {art.type === 'IMAGE' || art.mime_type.startsWith('image/') ? (
                    <img
                      src={`/api/v1/artifacts/${art.id}`}
                      alt={art.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FileSpreadsheet className="h-5 w-5 text-zinc-500" />
                    </div>
                  )}
                </div>
              ))}
              {inputArtifacts.length > 4 && (
                <button
                  onClick={onViewArtifacts}
                  className="flex h-14 w-14 items-center justify-center rounded border border-zinc-800 bg-zinc-900/80 text-xs font-mono text-zinc-400 hover:text-white shrink-0 transition"
                >
                  +{inputArtifacts.length - 4}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Compiled Claim Packet (Agent Directive & Prompt Hub) */}
        <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3 space-y-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_100px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <div>
                <h4 className="text-xs font-semibold text-zinc-100">Compiled Claim Packet</h4>
                <p className="text-[10px] text-zinc-400">
                  Pre-compiled directive synthesized from SSOT resources, skills & task contracts
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handlePreviewPrompt}
              disabled={promptLoading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-violet-500/40 bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-600/30 hover:border-violet-400 disabled:opacity-50"
              title="Preview compiled markdown prompt in centered floating modal"
            >
              {promptLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading Directive…</span>
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5 text-violet-400" />
                  <span>Preview Prompt</span>
                </>
              )}
            </button>

            <button
              onClick={handleCopyAgentPrompt}
              disabled={promptLoading}
              className="flex items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 hover:text-white disabled:opacity-50"
              title="Copy compiled prompt directly to clipboard"
            >
              {copiedPrompt ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Copy Prompt</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Dependencies Seam */}
        <div className="space-y-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <GitBranch className="h-3 w-3 text-zinc-400" />
            <span>Dependencies ({task.dependencies?.length || 0})</span>
          </span>

          {task.dependencies && task.dependencies.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {task.dependencies.map((depId) => {
                const depTask = taskMap.get(depId)
                const isDepDone = depTask?.status === 'COMPLETED'
                return (
                  <button
                    key={depId}
                    onClick={() => onSelectTaskId && onSelectTaskId(depId)}
                    className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono transition-colors ${
                      isDepDone
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        : 'border-zinc-700 bg-zinc-850 text-zinc-300 hover:border-zinc-600 hover:text-white'
                    }`}
                    title={`Jump and focus on ${depId}`}
                  >
                    <span>{depId}</span>
                    {isDepDone ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <span className="text-[10px] text-zinc-400">({depTask?.status || '?'})</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded border border-zinc-850 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 italic">
              Root task — ready for immediate execution without dependencies.
            </div>
          )}
        </div>

        {/* Metadata Footer */}
        <div className="space-y-2 border-t border-zinc-850 pt-3 text-xs [content-visibility:auto] [contain-intrinsic-size:auto_40px]">
          <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400 pt-1">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Created by: <strong className="text-zinc-300">{task.agent_slug || 'unassigned'}</strong></span>
            </div>
            <div className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              <span>Created: <strong className="text-zinc-300">{task.created_at ? new Date(task.created_at).toLocaleString() : '-'}</strong></span>
            </div>
            <div className="flex items-center gap-1">
              <span>Updated: <strong className="text-zinc-300">{task.updated_at ? new Date(task.updated_at).toLocaleTimeString() : '-'}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {previewArtifact && (
        <ArtifactPreviewModal
          artifact={previewArtifact}
          artifacts={artifacts}
          onClose={() => setPreviewArtifact(null)}
          onSelect={setPreviewArtifact}
        />
      )}

      {promptModalContent && (
        <ArtifactPreviewModal
          artifact={{
            id: `packet-${task.id}`,
            task_id: task.id,
            role: 'INPUT',
            name: `${task.id} Compiled Agent Directive.md`,
            type: 'FILE',
            file_path: 'directive.md',
            mime_type: 'text/markdown',
            byte_size: promptModalContent.length,
            sha256: '',
            created_at: new Date().toISOString(),
          }}
          initialContent={promptModalContent}
          onClose={() => setPromptModalContent(null)}
        />
      )}
    </div>
  )
}

export const TaskSpecPane = memo(TaskSpecPaneComponent)
