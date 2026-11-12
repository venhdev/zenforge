import React, { useState, useEffect, useRef } from 'react'
import { CheckSquare, X, Zap } from 'lucide-react'
import { StringArrayEditor } from './StringArrayEditor'
import type {
  Task,
  TaskInput,
  TaskPatchInput,
  TaskPriority,
  TaskComplexity,
  TaskRisk,
  Agent,
  Resource,
} from '../../types/contracts'
import {
  AUTORUN_TOOLS,
  type AutorunToolId,
  TASK_PRIORITIES,
  TASK_COMPLEXITIES,
  TASK_RISK_LEVELS,
} from './crudOptions'

export interface TaskModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (input: TaskInput | TaskPatchInput, taskId?: string) => Promise<void>
  allTasks: Task[]
  activeProjectSlug?: string | null
  activePlanSlug?: string | null
  initialTask?: Task | null
  agents?: Agent[]
  resources?: Resource[]
  busy?: boolean
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  allTasks,
  activeProjectSlug,
  activePlanSlug,
  initialTask,
  agents = [],
  resources = [],
  busy = false,
}) => {
  const isEditing = Boolean(initialTask)

  const [id, setId] = useState(() => {
    if (initialTask) return initialTask.id
    return `TASK-${Math.floor(100 + Math.random() * 900)}`
  })
  const [title, setTitle] = useState(() => initialTask?.title || '')
  const [description, setDescription] = useState(() => initialTask?.description || '')
  const [priority, setPriority] = useState<TaskPriority>(() => initialTask?.priority || 'P2')
  const [complexity, setComplexity] = useState<TaskComplexity>(() => initialTask?.complexity || 'MEDIUM')
  const [riskLevel, setRiskLevel] = useState<TaskRisk>(() => initialTask?.risk_level || 'LOW')
  const [agentSlug, setAgentSlug] = useState(() => initialTask?.agent_slug || '')
  const [worktreePath, setWorktreePath] = useState(() => initialTask?.worktree_path || '')
  const [autoRun, setAutoRun] = useState(() => Boolean(initialTask?.auto_run))
  const [autoRunTool, setAutoRunTool] = useState<AutorunToolId>('agy')
  const [customRunnerCmd, setCustomRunnerCmd] = useState('')

  const [dependencies, setDependencies] = useState<string[]>(() => initialTask?.dependencies || [])
  const [targetFiles, setTargetFiles] = useState<string[]>(() => initialTask?.target_files || [])
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>(() => initialTask?.acceptance_criteria || [])
  const [verificationCommands, setVerificationCommands] = useState<string[]>(() => initialTask?.verification_commands || [])
  const [requiredDocs, setRequiredDocs] = useState<string[]>(() => initialTask?.required_docs || [])
  const [requiredSkills, setRequiredSkills] = useState<string[]>(() => initialTask?.required_skills || [])

  const [error, setError] = useState('')
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      if (initialTask) {
        setId(initialTask.id)
        setTitle(initialTask.title)
        setDescription(initialTask.description || '')
        setPriority(initialTask.priority || 'P2')
        setComplexity(initialTask.complexity || 'MEDIUM')
        setRiskLevel(initialTask.risk_level || 'LOW')
        setAgentSlug(initialTask.agent_slug || '')
        setWorktreePath(initialTask.worktree_path || '')
        setAutoRun(Boolean(initialTask.auto_run))
        setDependencies(initialTask.dependencies || [])
        setTargetFiles(initialTask.target_files || [])
        setAcceptanceCriteria(initialTask.acceptance_criteria || [])
        setVerificationCommands(initialTask.verification_commands || [])
        setRequiredDocs(initialTask.required_docs || [])
        setRequiredSkills(initialTask.required_skills || [])
      }
      setError('')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, initialTask])

  if (!isOpen) return null

  // Candidates for dependencies: all tasks in the container except the current task itself
  const depCandidates = allTasks.filter((t) => !isEditing || t.id !== initialTask?.id)

  const toggleDependency = (depId: string) => {
    setDependencies((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId]
    )
  }

  const toggleDoc = (docKey: string) => {
    setRequiredDocs((prev) =>
      prev.includes(docKey) ? prev.filter((k) => k !== docKey) : [...prev, docKey]
    )
  }

  const handleToolSelect = (toolId: AutorunToolId) => {
    setAutoRunTool(toolId)
    const selected = AUTORUN_TOOLS.find((t) => t.id === toolId)
    if (selected && selected.template) {
      // If user selected a preset and has verification commands or title, keep template updated
      setCustomRunnerCmd(selected.template)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedId = id.trim()
    const trimmedTitle = title.trim()

    if (!trimmedId || !trimmedTitle) {
      setError('Task ID and Title are required.')
      return
    }

    const payload: TaskInput = {
      id: trimmedId,
      project_slug: activeProjectSlug || undefined,
      plan_slug: activePlanSlug || undefined,
      title: trimmedTitle,
      description: description.trim(),
      dependencies,
      priority,
      complexity,
      risk_level: riskLevel,
      agent_slug: agentSlug.trim() || undefined,
      worktree_path: worktreePath.trim() || undefined,
      auto_run: autoRun,
      target_files: targetFiles,
      acceptance_criteria: acceptanceCriteria,
      verification_commands: verificationCommands,
      required_docs: requiredDocs,
      required_skills: requiredSkills,
    }

    try {
      if (isEditing) {
        await onSubmit(payload, trimmedId)
      } else {
        await onSubmit(payload)
      }
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5 bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/30">
              <CheckSquare className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-zinc-100">
                {isEditing ? `Edit Task: ${initialTask?.id}` : 'Create New Task'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                Scope: {activeProjectSlug || 'orphan'} {activePlanSlug ? `/ ${activePlanSlug}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Core Info */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Task ID <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={id}
                disabled={isEditing || busy}
                onChange={(e) => setId(e.target.value)}
                placeholder="TASK-01"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Task Title <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement headless runner adaptor"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Description
            </label>
            <textarea
              rows={3}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description of implementation details and requirements..."
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500 resize-none disabled:opacity-50"
            />
          </div>

          {/* Triage & Metadata Attributes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Priority
              </label>
              <select
                value={priority}
                disabled={busy}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Complexity
              </label>
              <select
                value={complexity}
                disabled={busy}
                onChange={(e) => setComplexity(e.target.value as TaskComplexity)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                {TASK_COMPLEXITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Risk Level
              </label>
              <select
                value={riskLevel}
                disabled={busy}
                onChange={(e) => setRiskLevel(e.target.value as TaskRisk)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                {TASK_RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assigned Agent & Worktree */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Assigned Agent
              </label>
              <select
                value={agentSlug}
                disabled={busy}
                onChange={(e) => setAgentSlug(e.target.value)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-cyan-500"
              >
                <option value="">(None / Any Worker)</option>
                {agents.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.name} ({a.slug})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Worktree Path
              </label>
              <input
                type="text"
                value={worktreePath}
                disabled={busy}
                onChange={(e) => setWorktreePath(e.target.value)}
                placeholder="(Default project root)"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Auto-Run & Headless Adaptor Integration */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold text-zinc-100">
                  Autonomous Execution (Auto-Run)
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRun}
                  disabled={busy}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {autoRun && (
              <div className="space-y-3 pt-2 border-t border-emerald-500/20">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    Select Autonomous Tool Adaptor
                  </label>
                  <select
                    value={autoRunTool}
                    onChange={(e) => handleToolSelect(e.target.value as AutorunToolId)}
                    className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-emerald-500"
                  >
                    {AUTORUN_TOOLS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {AUTORUN_TOOLS.find((t) => t.id === autoRunTool)?.description}
                  </p>
                </div>

                {autoRunTool === 'custom' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                      Custom Runner Shell Template
                    </label>
                    <input
                      type="text"
                      value={customRunnerCmd}
                      onChange={(e) => setCustomRunnerCmd(e.target.value)}
                      placeholder='my-tool run "{prompt}" --dangerously-skip-permissions'
                      className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* DAG Dependencies Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Prerequisites (Tasks that must complete before this task can run)
              </label>
              <span className="text-[10px] font-mono text-cyan-400">
                {dependencies.length} selected
              </span>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 space-y-1">
              {depCandidates.map((cand) => {
                const isSelected = dependencies.includes(cand.id)
                return (
                  <div
                    key={cand.id}
                    onClick={() => toggleDependency(cand.id)}
                    className={`flex items-center justify-between rounded px-2.5 py-1.5 text-xs cursor-pointer select-none transition ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono font-bold">{cand.id}</span>
                      <span className="truncate text-zinc-300">{cand.title}</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase text-zinc-500">
                      {cand.status}
                    </span>
                  </div>
                )
              })}
              {depCandidates.length === 0 && (
                <div className="p-3 text-center text-xs text-zinc-600">
                  No other tasks in this container
                </div>
              )}
            </div>
          </div>

          {/* Target Files & Acceptance Criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StringArrayEditor
              label="TARGET FILES"
              values={targetFiles}
              onChange={setTargetFiles}
              placeholder="e.g. apps/web/src/App.tsx"
              disabled={busy}
              badgeBgColor="bg-cyan-950/70 border-cyan-800/60 text-cyan-300"
            />

            <StringArrayEditor
              label="ACCEPTANCE CRITERIA"
              values={acceptanceCriteria}
              onChange={setAcceptanceCriteria}
              placeholder="e.g. Unit tests pass"
              disabled={busy}
              badgeBgColor="bg-emerald-950/70 border-emerald-800/60 text-emerald-300"
            />
          </div>

          {/* Verification Commands & Linked Encyclopedia Resources */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StringArrayEditor
              label="VERIFICATION COMMANDS"
              values={verificationCommands}
              onChange={setVerificationCommands}
              placeholder="e.g. pnpm test"
              disabled={busy}
              badgeBgColor="bg-amber-950/70 border-amber-800/60 text-amber-300"
            />

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Linked Encyclopedia Resources
              </label>
              <div className="max-h-24 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-1">
                {resources.map((res) => {
                  const isChecked = requiredDocs.includes(res.key)
                  return (
                    <div
                      key={res.id}
                      onClick={() => toggleDoc(res.key)}
                      className={`flex items-center justify-between rounded px-2 py-1 text-xs cursor-pointer select-none ${
                        isChecked
                          ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                          : 'text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      <span className="font-mono text-[11px] truncate">{res.key}</span>
                      <span className="text-[10px] text-zinc-500 truncate">{res.title}</span>
                    </div>
                  )
                })}
                {resources.length === 0 && (
                  <div className="text-[11px] text-zinc-600 p-1">No resources in project</div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800 sticky bottom-0 bg-zinc-950 pb-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-zinc-800 bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 transition disabled:opacity-50"
            >
              {busy ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
