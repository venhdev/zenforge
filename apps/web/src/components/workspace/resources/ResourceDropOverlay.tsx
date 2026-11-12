import React, { useEffect } from 'react'
import { Globe2, FolderGit2, Layers, ListChecks } from 'lucide-react'
import type { Plan, Project, Task } from '../../../types/contracts'
import { ScopePicker, type DropScope, type DropTarget } from './ScopePicker'

/** What the user dragged in. Resolved to a resource once a scope is chosen. */
export type ResourceDropPayload =
  | { kind: 'existing'; resourceId: string; resourceKey: string }
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string }

interface ResourceDropOverlayProps {
  /** Shown while a drag hovers the panel, or while a pasted payload awaits a scope. */
  open: boolean
  /** When set, the picker replaces the zone grid. */
  pendingScope: Exclude<DropScope, 'GLOBAL'> | null
  projects: Project[]
  plans: Plan[]
  tasks: Task[]
  defaultProjectSlug?: string | null
  /** Drop landed on a zone. GLOBAL resolves immediately in the caller. */
  onZoneDrop: (scope: DropScope, event: React.DragEvent) => void
  /** Zone clicked (paste flow, where no drag event exists). */
  onChooseZone: (scope: DropScope) => void
  onSelectTarget: (target: DropTarget) => void
  onCancel: () => void
  onBack: () => void
}

const ZONES: Array<{ scope: DropScope; label: string; hint: string; Icon: typeof Globe2 }> = [
  { scope: 'GLOBAL', label: 'Global', hint: 'Shared across every project', Icon: Globe2 },
  { scope: 'PROJECT', label: 'Project', hint: 'Visible to one project', Icon: FolderGit2 },
  { scope: 'PLAN', label: 'Plan', hint: 'Injected into every task of a plan', Icon: Layers },
  { scope: 'TASK', label: 'Task', hint: 'Context for a single task', Icon: ListChecks },
]

/**
 * Scope chooser shown while an item hovers ResourcesView. GLOBAL resolves on
 * drop; the other zones open the type-ahead picker so the caller never has to
 * name the container twice.
 */
export const ResourceDropOverlay: React.FC<ResourceDropOverlayProps> = ({
  open,
  pendingScope,
  projects,
  plans,
  tasks,
  defaultProjectSlug,
  onZoneDrop,
  onChooseZone,
  onSelectTarget,
  onCancel,
  onBack,
}) => {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (pendingScope) {
        onBack()
        return
      }
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pendingScope, onCancel, onBack])

  if (!open) return null

  return (
    <div
      data-testid="resource-drop-overlay"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
    >
      {pendingScope ? (
        <div className="w-full max-w-sm">
          <ScopePicker
            scope={pendingScope}
            projects={projects}
            plans={plans}
            tasks={tasks}
            defaultProjectSlug={defaultProjectSlug}
            onSelect={onSelectTarget}
            onCancel={onBack}
          />
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            Choose a scope for the dropped item
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ZONES.map(({ scope, label, hint, Icon }) => (
              <button
                key={scope}
                type="button"
                data-testid={`drop-zone-${scope.toLowerCase()}`}
                onClick={() => onChooseZone(scope)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onZoneDrop(scope, event)
                }}
                className="flex flex-col items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-4 text-center transition hover:border-cyan-400 hover:bg-cyan-950/40"
              >
                <Icon className="h-4 w-4 text-cyan-300" />
                <span className="text-xs font-semibold text-zinc-200">{label}</span>
                <span className="text-[9px] leading-tight text-zinc-500">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
