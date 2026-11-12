import React, { useState, useEffect, useRef } from 'react'
import { GitFork, X } from 'lucide-react'
import type { Plan, PlanInput, Project } from '../../types/contracts'

export interface PlanModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (input: PlanInput) => Promise<void>
  projects: Project[]
  activeProjectSlug?: string | null
  initialPlan?: Plan | null
  busy?: boolean
}

export const PlanModal: React.FC<PlanModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  projects,
  activeProjectSlug,
  initialPlan,
  busy = false,
}) => {
  const isEditing = Boolean(initialPlan)

  const [slug, setSlug] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState(1)
  const [error, setError] = useState('')

  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      if (initialPlan) {
        setSlug(initialPlan.slug)
        setProjectSlug(initialPlan.project_slug)
        setTitle(initialPlan.title)
        setVersion(initialPlan.version || 1)
      } else {
        setSlug('')
        setProjectSlug(activeProjectSlug || projects[0]?.slug || '')
        setTitle('')
        setVersion(1)
      }
      setError('')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, initialPlan, activeProjectSlug, projects])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedSlug = slug.trim()
    const trimmedTitle = title.trim()

    if (!trimmedSlug || !trimmedTitle || !projectSlug) {
      setError('Slug, Title, and Project are required.')
      return
    }

    try {
      await onSubmit({
        slug: trimmedSlug,
        project_slug: projectSlug,
        title: trimmedTitle,
        version: Number(version) || 1,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/30">
              <GitFork className="h-4 w-4" />
            </div>
            <h3 className="font-bold text-sm text-zinc-100">
              {isEditing ? `Plan: ${initialPlan?.title}` : 'Create Execution Plan'}
            </h3>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Target Project <span className="text-rose-400">*</span>
            </label>
            <select
              value={projectSlug}
              disabled={isEditing || busy}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-violet-500 disabled:opacity-50"
            >
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Plan Slug <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={slug}
              disabled={isEditing || busy}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. plan-v0.5-release"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Plan Title <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Multi-Tool Autonomous DAG Release"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Version
            </label>
            <input
              type="number"
              min={1}
              value={version}
              disabled={busy}
              onChange={(e) => setVersion(parseInt(e.target.value, 10) || 1)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500 disabled:opacity-50"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
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
              className="rounded bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 transition disabled:opacity-50"
            >
              {busy ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
