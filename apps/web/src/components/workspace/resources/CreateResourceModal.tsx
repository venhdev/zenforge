import React, { useEffect, useRef, useState } from 'react'
import { Database, FileCode, FolderGit2, Package, Upload, X } from 'lucide-react'
import type { ResourceScope, Project } from '../../../types/contracts'
import { parseMarkdownContent } from '../../../lib/markdownFrontmatterParser'
import {
  type ResourceForm,
  emptyForm,
  SCOPES,
  RESOURCE_KINDS,
  SEMANTIC_TYPES,
  TYPE_COLORS,
  KIND_COLORS,
  parseTags,
} from './types'

export interface CreateResourceModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (form: ResourceForm) => Promise<void>
  projects: Project[]
  initialProjectSlug?: string
  busy?: boolean
  externalError?: string
}

export const CreateResourceModal: React.FC<CreateResourceModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  projects,
  initialProjectSlug = '',
  busy = false,
  externalError = '',
}) => {
  const [form, setForm] = useState<ResourceForm>(() => emptyForm(initialProjectSlug))
  const [localError, setLocalError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm(initialProjectSlug))
      setLocalError('')
    }
  }, [isOpen, initialProjectSlug])

  if (!isOpen) return null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const rawText = String(event.target?.result || '')
      const parsed = parseMarkdownContent(rawText, file.name)
      setForm((prev) => ({
        ...prev,
        title: parsed.title || prev.title || file.name.replace(/\.[^/.]+$/, ''),
        key: prev.key || parsed.suggestedKey || '',
        slug:
          prev.slug ||
          (parsed.suggestedKey
            ? parsed.suggestedKey.toLowerCase().replace(/_/g, '-')
            : ''),
        summary: parsed.summary || prev.summary,
        tags: parsed.tags ? parsed.tags.join(', ') : prev.tags,
        content: parsed.content,
      }))
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')

    if (!form.key.trim() || !form.title.trim()) {
      setLocalError('Key and Title are required')
      return
    }
    if (!form.isNative && !form.path.trim()) {
      setLocalError('File path is required for file-backed resources')
      return
    }

    try {
      await onSubmit(form)
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to create resource')
    }
  }

  const activeError = externalError || localError

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-sky-400" />
            <h3 className="font-bold text-sm text-zinc-100">
              Create Resource Entry
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Load from File Ingestion Option */}
          <div className="flex items-center justify-between rounded-lg border border-dashed border-sky-500/30 bg-sky-500/5 p-3">
            <div className="flex items-center gap-2.5">
              <Upload className="h-4 w-4 text-sky-400" />
              <div>
                <div className="text-xs font-semibold text-sky-200">
                  Load from Markdown File
                </div>
                <div className="text-[10px] text-zinc-400">
                  Auto-extracts Title, Key, Summary, and Content from any local .md file
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/30 transition cursor-pointer"
            >
              <FileCode className="h-3.5 w-3.5" />
              <span>Choose .md File</span>
            </button>
          </div>

          {/* Resource Kind Selector */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Resource Kind (Taxonomy)
            </label>
            <div className="grid grid-cols-4 gap-2 text-xs">
              {RESOURCE_KINDS.map((k) => {
                const isSelected = form.kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm({ ...form, kind: k })}
                    className={`rounded-md border p-2 text-center transition cursor-pointer uppercase font-mono text-[11px] ${
                      isSelected
                        ? `${KIND_COLORS[k]} ring-1 ring-current font-bold`
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Storage Engine Switch */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Storage Engine
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setForm({ ...form, isNative: true })}
                className={`flex items-center gap-2 rounded-md border p-2.5 text-left transition ${
                  form.isNative
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Database className="h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <div className="font-semibold text-xs">
                    Native SQLite (Recommended)
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Inlined in DB WAL, zero file clutter
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, isNative: false })}
                className={`flex items-center gap-2 rounded-md border p-2.5 text-left transition ${
                  !form.isNative
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FolderGit2 className="h-4 w-4 shrink-0 text-sky-400" />
                <div>
                  <div className="font-semibold text-xs">Git File-Backed</div>
                  <div className="text-[10px] text-zinc-500">
                    Point to existing repository file
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Title & Key */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Title *
              </label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Headless CLI Adaptor Architecture"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Key *
              </label>
              <input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="ARCH_ADAPTOR"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
                required
              />
            </div>
          </div>

          {/* Scope & ScopeRef & Project */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Scope
              </label>
              <select
                value={form.scope}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scope: e.target.value as ResourceScope,
                  })
                }
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-sky-500"
              >
                {SCOPES.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Project
              </label>
              <select
                value={form.project_slug}
                onChange={(e) =>
                  setForm({ ...form, project_slug: e.target.value })
                }
                disabled={form.scope === 'GLOBAL'}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-sky-500 disabled:opacity-50"
              >
                <option value="">(Global / None)</option>
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Scope Ref (Plan / Task ID)
              </label>
              <input
                value={form.scope_ref}
                onChange={(e) =>
                  setForm({ ...form, scope_ref: e.target.value })
                }
                placeholder="e.g. plan-slug or task-id"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Semantic Types Chips */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Semantic Types (Multi-select)
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {SEMANTIC_TYPES.map((t) => {
                const selected = form.types.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const updated = selected
                        ? form.types.filter((item) => item !== t)
                        : [...form.types, t]
                      setForm({ ...form, types: updated })
                    }}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-mono transition ${
                      selected
                        ? `${
                            TYPE_COLORS[t] || 'bg-sky-500/20 text-sky-300'
                          } ring-1 ring-current font-bold`
                        : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    #{t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Path (if file-backed) */}
          {!form.isNative && (
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                File Path (relative to repo or absolute) *
              </label>
              <input
                value={form.path}
                onChange={(e) =>
                  setForm({ ...form, path: e.target.value })
                }
                placeholder="docs/architecture/adaptor.md"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
                required={!form.isNative}
              />
            </div>
          )}

          {/* Summary Abstract */}
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Summary / Abstract
            </label>
            <textarea
              value={form.summary}
              onChange={(e) =>
                setForm({ ...form, summary: e.target.value })
              }
              rows={2}
              placeholder="1-2 sentences summarizing this resource…"
              className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-sky-500"
            />
          </div>

          {/* Content Markdown Editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Content (CommonMark / GFM with Directive Fences)
              </label>
              <span className="text-[10px] font-mono text-zinc-500">
                Supports ```mermaid, ```bash:run, ```json:fixture, ```ascii:wireframe
              </span>
            </div>
            <textarea
              value={form.content}
              onChange={(e) =>
                setForm({ ...form, content: e.target.value })
              }
              rows={8}
              placeholder={`# Title\n\nIntroductory text...\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\``}
              className="w-full rounded border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Tags (comma-separated)
            </label>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="adaptor, headless, ci-cd"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
            />
          </div>

          {/* Error Notice */}
          {activeError && (
            <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300 font-mono">
              {activeError}
            </div>
          )}

          {/* Actions Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-zinc-800 bg-zinc-900 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busy)}
              className="rounded bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-400 disabled:opacity-50 cursor-pointer"
            >
              {busy ? 'Creating…' : 'Create Resource'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
export { parseTags }
