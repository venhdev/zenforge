import React, { useState, useEffect, useRef } from 'react'
import { FolderKanban, X } from 'lucide-react'
import type { Project, ProjectInput, ProjectStatus } from '../../types/contracts'

export interface ProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (slug: string, input: ProjectInput, status?: ProjectStatus) => Promise<void>
  initialProject?: Project | null
  busy?: boolean
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialProject,
  busy = false,
}) => {
  const isEditing = Boolean(initialProject)

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('ACTIVE')
  const [error, setError] = useState('')
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      if (initialProject) {
        setSlug(initialProject.slug)
        setName(initialProject.name)
        setRootPath(initialProject.root_path || '')
        setDescription(initialProject.description || '')
        setStatus(initialProject.status)
      } else {
        setSlug('')
        setName('')
        setRootPath('')
        setDescription('')
        setStatus('ACTIVE')
      }
      setError('')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, initialProject])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedSlug = slug.trim()
    const trimmedName = name.trim()

    if (!trimmedSlug || !trimmedName) {
      setError('Slug and Name are required.')
      return
    }

    try {
      await onSubmit(
        trimmedSlug,
        {
          slug: trimmedSlug,
          name: trimmedName,
          root_path: rootPath.trim(),
          description: description.trim(),
        },
        isEditing ? status : undefined
      )
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
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
              <FolderKanban className="h-4 w-4" />
            </div>
            <h3 className="font-bold text-sm text-zinc-100">
              {isEditing ? `Edit Project: ${initialProject?.name}` : 'Create New Project'}
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
              Project Slug <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={slug}
              disabled={isEditing || busy}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. zenforge"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Project Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ZenForge Autonomous Core"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Root Directory Path
            </label>
            <input
              type="text"
              value={rootPath}
              disabled={busy}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="e.g. /home/dev/src/zenforge"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
            />
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
              placeholder="Brief description of project goals and scope..."
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500 resize-none disabled:opacity-50"
            />
          </div>

          {isEditing && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Status
              </label>
              <select
                value={status}
                disabled={busy}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </div>
          )}

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
              className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
            >
              {busy ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
