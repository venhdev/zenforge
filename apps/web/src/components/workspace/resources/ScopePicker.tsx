import React, { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Plan, Project, Task } from '../../../types/contracts'

export type DropScope = 'GLOBAL' | 'PROJECT' | 'PLAN' | 'TASK'

/** Resolved container for a dropped item. Empty fields mean "not applicable". */
export interface DropTarget {
  scope: DropScope
  projectSlug?: string
  scopeRef?: string
}

interface ScopePickerProps {
  scope: Exclude<DropScope, 'GLOBAL'>
  projects: Project[]
  plans: Plan[]
  tasks: Task[]
  /** Preselected project, usually the active one. */
  defaultProjectSlug?: string | null
  onSelect: (target: DropTarget) => void
  onCancel: () => void
}

interface Candidate {
  id: string
  label: string
  detail: string
  target: DropTarget
}

/**
 * Type-ahead container picker for the PLAN and TASK drop zones. Selecting a task
 * fills its plan (nullable) and project; selecting a plan fills its project.
 */
export const ScopePicker: React.FC<ScopePickerProps> = ({
  scope,
  projects,
  plans,
  tasks,
  defaultProjectSlug,
  onSelect,
  onCancel,
}) => {
  const [query, setQuery] = useState('')

  const candidates = useMemo<Candidate[]>(() => {
    if (scope === 'PROJECT') {
      return projects.map((p) => ({
        id: p.slug,
        label: p.name,
        detail: p.slug,
        target: { scope: 'PROJECT', projectSlug: p.slug },
      }))
    }
    if (scope === 'PLAN') {
      return plans.map((p) => ({
        id: p.slug,
        label: p.title,
        detail: `${p.project_slug} · ${p.slug}`,
        target: { scope: 'PLAN', projectSlug: p.project_slug, scopeRef: p.slug },
      }))
    }
    return tasks.map((t) => ({
      id: t.id,
      label: t.title,
      detail: [t.project_slug, t.plan_slug || 'no plan', t.id].filter(Boolean).join(' · '),
      target: {
        scope: 'TASK',
        projectSlug: t.project_slug || defaultProjectSlug || undefined,
        scopeRef: t.id,
      },
    }))
  }, [scope, projects, plans, tasks, defaultProjectSlug])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return candidates.slice(0, 50)
    return candidates
      .filter((c) => `${c.label} ${c.detail}`.toLowerCase().includes(needle))
      .slice(0, 50)
  }, [candidates, query])

  const placeholder =
    scope === 'PROJECT' ? 'Search projects…' : scope === 'PLAN' ? 'Search plans…' : 'Search tasks…'

  return (
    <div data-testid="scope-picker" className="w-full rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Drop into {scope.toLowerCase()}
        </span>
        <button type="button" data-testid="scope-picker-cancel" onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
        <Search className="h-3 w-3 text-zinc-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
        />
      </div>

      <ul className="max-h-56 overflow-auto">
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-center text-[11px] text-zinc-500">No matches</li>
        )}
        {filtered.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              data-testid={`scope-option-${candidate.id}`}
              onClick={() => onSelect(candidate.target)}
              className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-zinc-800/70"
            >
              <span className="truncate text-xs text-zinc-200">{candidate.label}</span>
              <span className="truncate font-mono text-[10px] text-zinc-500">{candidate.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
