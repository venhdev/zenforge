import React, { useState, useMemo, useCallback } from 'react'
import {
  Activity,
  Terminal as TerminalIcon,
  Check,
  Copy,
  Clock,
  AlertTriangle,
  FolderGit2,
  Download,
  Maximize2,
  FileText,
  Code,
  FileSpreadsheet,
  Sparkles,
  Bot,
  Radio,
} from 'lucide-react'
import type { Task, Artifact } from '../../types/contracts'
import { getTaskStatusStyle } from '../stage/taskStatusTheme'
import { ArtifactPreviewModal } from './ArtifactPreviewModal'
import { TerminalModal } from './TerminalModal'
import { MarkdownViewer } from '../../lib/markdownRenderer'
import { useClipboardCopy } from '../../hooks/useClipboardCopy'

interface TaskOutputPaneProps {
  task: Task | null
  artifacts?: Artifact[]
}

export const TaskOutputPane: React.FC<TaskOutputPaneProps> = ({
  task,
  artifacts = [],
}) => {
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [showTerminalModal, setShowTerminalModal] = useState(false)
  const { isCopied, copy } = useClipboardCopy()

  const outputArtifacts = useMemo(
    () => artifacts.filter((a) => a.role === 'OUTPUT'),
    [artifacts]
  )

  // Identify raw execution log artifact if present
  const logArtifact = useMemo(() => {
    return (
      outputArtifacts.find(
        (a) =>
          a.name.endsWith('.log') ||
          a.name.toLowerCase().includes('execution log') ||
          a.file_path.endsWith('.log')
      ) || null
    )
  }, [outputArtifacts])

  // Synthetic artifact representation of task.notes for full modal preview
  const previewNotesArtifact = useMemo<Artifact | null>(() => {
    if (!task?.notes) return null
    return {
      id: `notes-${task.id}`,
      task_id: task.id,
      role: 'OUTPUT',
      name: `${task.id} Execution Summary`,
      type: 'FILE',
      file_path: `${task.id}-summary.md`,
      mime_type: 'text/markdown',
      byte_size: new Blob([task.notes]).size,
      sha256: '',
      created_at: task.updated_at || task.created_at,
    }
  }, [task?.id, task?.notes, task?.updated_at, task?.created_at])


  // De-duplicate: exclude the raw execution log from the artifacts grid if task.notes is already displaying it
  const additionalArtifacts = useMemo(() => {
    if (!task?.notes) return outputArtifacts
    return outputArtifacts.filter((a) => a.id !== logArtifact?.id)
  }, [outputArtifacts, task?.notes, logArtifact])

  const handleCopyTaskId = useCallback(async () => {
    if (!task?.id) return
    await copy(task.id, 'taskId')
  }, [task?.id, copy])

  const handleCopyNotes = useCallback(async () => {
    if (!task?.notes) return
    await copy(task.notes, 'notes')
  }, [task?.notes, copy])

  const handleCopyWorktree = useCallback(async () => {
    if (!task?.worktree_path) return
    await copy(task.worktree_path, 'worktree')
  }, [task?.worktree_path, copy])

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-zinc-500">
        <Activity className="h-8 w-8 text-zinc-700 mb-2" />
        <p className="text-xs font-semibold text-zinc-400">No Task Selected</p>
        <p className="mt-1 text-[11px] text-zinc-600 max-w-xs">
          Select a task from the DAG or sidebar to inspect execution output and artifacts.
        </p>
      </div>
    )
  }

  const isRunning = task.status === 'RUNNING'
  const isPendingOrReady = task.status === 'PENDING' || task.status === 'READY'
  const isReview = task.status === 'AWAITING_REVIEW'
  const isDaemonAutoRun = Boolean(task.auto_run && task.claim_session_id)

  return (
    <div className="flex h-full w-full flex-col min-h-0 overflow-y-auto overscroll-contain bg-zinc-950 p-4 space-y-4 select-none font-sans">
      {/* 1. Executive Status Banner */}
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-zinc-200">{task.id}</span>
            <button
              type="button"
              onClick={handleCopyTaskId}
              className="flex items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:bg-zinc-700 hover:text-white transition cursor-pointer"
              title="Copy Task ID"
            >
              {isCopied('taskId') ? (
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
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${getTaskStatusStyle(
                task.status
              )}`}
            >
              {task.status}
            </span>
          </div>

          {task.claimed_by && (
            <span className="font-mono text-[10px] text-zinc-400">
              worker: <strong className="text-violet-300 font-semibold">{task.claimed_by || 'external'}</strong>{' '}
              {task.agent_slug && `for ${task.agent_slug}`}
            </span>
          )}
        </div>

        {/* Worktree Slice */}
        {task.worktree_path && (
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5 truncate">
              <FolderGit2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span className="font-mono text-[11px] text-zinc-300 truncate">{task.worktree_path}</span>
            </div>
            <button
              type="button"
              onClick={handleCopyWorktree}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition shrink-0 ml-2 cursor-pointer"
              title="Copy Worktree Path"
            >
              {isCopied('worktree') ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* 2. State A: Waiting for Dispatch (PENDING / READY) */}
      {isPendingOrReady && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-zinc-850 bg-zinc-900/20">
          <Clock className="h-10 w-10 text-zinc-700 mb-3" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Waiting for Dispatch</h3>
          <p className="mt-1.5 text-xs text-zinc-500 max-w-sm leading-relaxed">
            This task is currently queued in <span className="font-mono text-zinc-400">{task.status}</span>. When claimed by an autonomous agent or runner, a live terminal console stream and generated artifacts will materialize here.
          </p>
        </div>
      )}

      {/* 3a. State B1: In-Flight Daemon Process Stream (Loại 2: Managed Auto-Run PTY) */}
      {isRunning && isDaemonAutoRun && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span>In-Flight Daemon Process Stream</span>
          </div>

          <div
            onClick={() => setShowTerminalModal(true)}
            className="group relative flex flex-col rounded-xl border border-emerald-500/50 bg-emerald-950/20 p-4 hover:border-emerald-400 hover:bg-emerald-950/30 transition-all cursor-pointer shadow-lg"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-4 w-4 text-emerald-400" />
                <span className="font-semibold text-xs text-zinc-100">Live Daemon Console</span>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-900/60 border border-emerald-700/60 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                STREAMING LIVE
              </span>
            </div>

            <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
              Daemon worker <strong className="text-emerald-300">{task.claimed_by || 'auto-runner'}</strong> is actively executing autonomous verification commands. Click to open live interactive terminal stream.
            </p>

            <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Session: {task.claim_session_id ? task.claim_session_id.slice(0, 16) + '…' : 'attached'}</span>
              <span className="text-emerald-400 font-sans group-hover:underline flex items-center gap-1">
                Open Live Terminal ↗
              </span>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 italic text-center">
            Output artifacts and reports will freeze automatically when the worker process finishes.
          </p>
        </div>
      )}

      {/* 3b. State B2: External Agent / CLI Tracking (Loại 1: Main/Subagents via CLI/IDE) */}
      {isRunning && !isDaemonAutoRun && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
            <Radio className="h-3.5 w-3.5 animate-pulse text-cyan-400" />
            <span>Active External Execution · Tracking Only</span>
          </div>

          <div className="flex flex-col rounded-xl border border-cyan-800/60 bg-cyan-950/15 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold text-xs text-zinc-100">External Agent In-Flight</span>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-cyan-900/50 border border-cyan-700/50 px-2.5 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                LIVE TRACKING
              </span>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Task claimed by <strong className="text-cyan-300">{task.claimed_by || 'external caller'}</strong>
              {task.agent_slug ? ` for ${task.agent_slug}` : ''} via MCP client. Execution and terminal output reside in the caller&apos;s CLI / IDE environment.
            </p>

            {task.current_phase && (
              <div className="rounded-lg border border-cyan-900/60 bg-black/40 px-3 py-2 text-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold mb-0.5">
                  Current Milestone / Phase
                </div>
                <div className="font-mono text-zinc-200">{task.current_phase}</div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-zinc-500 border-t border-zinc-850">
              <span>Awaiting checkpoint or completion</span>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 italic text-center">
            ZenForge tracks lifecycle checkpoints and records generated artifacts upon completion.
          </p>
        </div>
      )}

      {/* 4. State C: Architectural Review Requested (AWAITING_REVIEW) */}
      {isReview && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>Architectural Review Requested</span>
          </div>

          {task.review_reason && (
            <div className="text-xs text-amber-200">
              <span className="font-semibold text-amber-300">Reason:</span> {task.review_reason}
            </div>
          )}

          {task.review_details && (
            <div className="rounded bg-black/40 p-2.5 text-[11px] font-mono text-zinc-300 break-words border border-amber-500/20 select-text">
              {task.review_details}
            </div>
          )}

          {task.review_options && task.review_options.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-amber-400 uppercase">Decision Options:</span>
              <ul className="space-y-1 text-xs text-zinc-300">
                {task.review_options.map((opt, i) => (
                  <li key={i} className="flex items-start gap-1.5 font-mono text-[11px]">
                    <span className="text-amber-400 shrink-0 font-bold">[{String.fromCharCode(65 + i)}]</span>
                    <span>{opt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 6. Execution Summary & Report (Rendered whenever task.notes exists on finished tasks) */}
      {task.notes && (task.status === 'COMPLETED' || task.status === 'FAILED') && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden shadow-sm">
          <div className="flex h-9 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 text-xs">
            <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-violet-400" />
              <span>Execution Summary</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyNotes}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition cursor-pointer"
                title="Copy Summary"
              >
                {isCopied('notes') ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              {logArtifact && (
                <a
                  href={`/api/v1/artifacts/${logArtifact.id}`}
                  download={logArtifact.name || `${task.id}-output.log`}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
                  title="Download Raw Execution Log"
                >
                  <Download className="h-3 w-3 text-zinc-400" />
                  <span>Log ({(logArtifact.byte_size / 1024).toFixed(1)} KB)</span>
                </a>
              )}

              {previewNotesArtifact && (
                <button
                  type="button"
                  onClick={() => setSelectedArtifact(previewNotesArtifact)}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
                  title="Expand Fullscreen Modal"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>Expand Modal</span>
                </button>
              )}
            </div>
          </div>
          <div className="p-3 text-xs max-h-96 overflow-y-auto select-text">
            <MarkdownViewer content={task.notes} />
          </div>
        </div>
      )}

      {/* 7. Output Artifacts Hub (Zero-Duplication: only shows files not already embedded in Execution Summary) */}
      {additionalArtifacts.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-violet-400" />
              <span>Generated Artifacts ({additionalArtifacts.length})</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-normal normal-case">Click card to inspect</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {additionalArtifacts.map((art) => {
              const isMarkdown =
                art.mime_type === 'text/markdown' || art.name.endsWith('.md')
              const isJson =
                art.mime_type === 'application/json' || art.name.endsWith('.json')
              const isLog =
                art.name.endsWith('.log') || art.mime_type === 'text/plain'
              const fileUrl = `/api/v1/artifacts/${art.id}`

              return (
                <div
                  key={art.id}
                  onClick={() => setSelectedArtifact(art)}
                  className="group relative flex flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 hover:border-violet-500/60 hover:bg-zinc-900/80 transition cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <div className="rounded p-1.5 bg-zinc-950 border border-zinc-800 shrink-0">
                      {isMarkdown ? (
                        <FileText className="h-4 w-4 text-violet-400" />
                      ) : isJson ? (
                        <Code className="h-4 w-4 text-emerald-400" />
                      ) : isLog ? (
                        <TerminalIcon className="h-4 w-4 text-amber-400" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-zinc-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] font-semibold text-zinc-200 group-hover:text-violet-300 transition" title={art.name}>
                        {art.name || art.id}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        {(art.byte_size / 1024).toFixed(1)} KB · {isMarkdown ? 'markdown' : art.mime_type}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800/60 pt-1.5 text-[10px]">
                    <span className="font-mono text-zinc-500 group-hover:text-zinc-300 transition">
                      View report ↗
                    </span>
                    <a
                      href={fileUrl}
                      download={art.name || art.id}
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-500 hover:text-emerald-400 transition"
                      title="Download file"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 8. Zero Output State (When completed with no notes and no artifacts) */}
      {(task.status === 'COMPLETED' || task.status === 'FAILED') && !task.notes && outputArtifacts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-zinc-850 bg-zinc-900/20 text-zinc-500">
          <Check className="h-8 w-8 text-emerald-500 mb-2" />
          <p className="text-xs font-semibold text-zinc-300">Task Completed</p>
          <p className="mt-1 text-[11px] text-zinc-500 max-w-xs">
            No artifacts or execution logs were generated for this task.
          </p>
        </div>
      )}

      {/* Floating Modals */}
      {selectedArtifact && (
        <ArtifactPreviewModal
          artifact={selectedArtifact}
          artifacts={outputArtifacts}
          initialContent={selectedArtifact.id === previewNotesArtifact?.id ? task.notes : undefined}
          onClose={() => setSelectedArtifact(null)}
          onSelect={setSelectedArtifact}
        />
      )}

      {showTerminalModal && isDaemonAutoRun && task.claim_session_id && (
        <TerminalModal
          sessionId={task.claim_session_id}
          taskTitle={task.title}
          onClose={() => setShowTerminalModal(false)}
        />
      )}
    </div>
  )
}
