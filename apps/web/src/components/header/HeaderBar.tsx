import React, { useState } from 'react'
import {
  Zap,
  Package,
  Copy,
  Check,
  Archive,
  Radio,
  LayoutGrid,
  RotateCcw,
  FolderTree,
  Terminal,
  PanelRight,
  ChevronDown,
  Plus,
  Trash2,
  MoreVertical,
  Wrench,
} from 'lucide-react'
import type { Plan, Project } from '../../types/contracts'
import type { WorkbenchPanelId } from '../workbench/panelRegistry'
import { useClipboardCopy } from '../../hooks/useClipboardCopy'

interface HeaderBarProps {
  connected: boolean
  projects: Project[]
  activeProject: Project | null
  onSelectProject: (slug: string) => void
  activePlan: Plan | null
  plans: Plan[]
  onSelectPlan: (slug: string) => void
  onNewPlan?: () => void
  onDeletePlan?: (slug: string) => void
  onNewProject?: () => void
  showArchived: boolean
  onToggleArchived: () => void
  activeWorkers: number
  daemonVersion?: string
  hudVisible?: boolean
  runningTasksCount?: number
  onToggleHud?: () => void
  onOpenWorkbenchPanel?: (panelId: WorkbenchPanelId) => void
  onResetWorkbenchLayout?: () => void
  onToggleWorkbenchPanel?: (panelId: WorkbenchPanelId) => void
  isInspectorOpen?: boolean
  /** Enabled views (Panels menu ON/OFF), independent of whether they are open. */
  enabledPanels?: Record<string, boolean>
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  connected: _connected,
  projects,
  activeProject,
  onSelectProject,
  activePlan,
  plans,
  onSelectPlan,
  onNewPlan,
  onDeletePlan,
  onNewProject,
  showArchived,
  onToggleArchived,
  activeWorkers: _activeWorkers,
  daemonVersion: _daemonVersion,
  hudVisible = false,
  runningTasksCount = 0,
  onToggleHud,
  onOpenWorkbenchPanel,
  onResetWorkbenchLayout,
  onToggleWorkbenchPanel,
  isInspectorOpen = true,
  enabledPanels,
}) => {
  const { isCopied, copy } = useClipboardCopy()
  const [panelsMenuOpen, setPanelsMenuOpen] = useState(false)
  const [planMenuOpen, setPlanMenuOpen] = useState(false)

  const handleCopyPlanSlug = async () => {
    if (!activePlan?.slug) return
    await copy(activePlan.slug)
  }

  const isPanelEnabled = (panelId: WorkbenchPanelId): boolean => {
    if (enabledPanels && enabledPanels[panelId] !== undefined) {
      return enabledPanels[panelId]
    }
    if (panelId === 'inspector') return isInspectorOpen
    return true
  }

  return (
    <header className="relative z-30 flex h-14 w-full items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 backdrop-blur select-none">
      {/* Brand & Project / Plan Selector */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2 font-mono text-sm font-semibold tracking-wider text-zinc-100">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
            <Zap className="h-4 w-4 fill-emerald-400" />
          </div>
          <span>ZenForge</span>
        </div>

        <div className="h-4 w-[1px] shrink-0 bg-zinc-800" />

        {/* Project Selector */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs text-zinc-400">Project:</span>
          <select
            value={activeProject?.slug || ''}
            onChange={(e) => onSelectProject(e.target.value)}
            className="max-w-[170px] truncate rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-mono font-medium text-zinc-200 outline-none hover:border-zinc-700 focus:border-emerald-500"
          >
            {activeProject && !projects.some((p) => p.slug === activeProject.slug) && (
              <option value={activeProject.slug}>{activeProject.name || activeProject.slug}</option>
            )}
            {projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name || project.slug}
                {project.status === 'ARCHIVED' ? ' (archived)' : ''}
              </option>
            ))}
            {projects.length === 0 && <option value="">(No projects)</option>}
          </select>
          {onNewProject && (
            <button
              type="button"
              onClick={onNewProject}
              title="Create New Project"
              className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] font-semibold text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/10 transition"
            >
              <Plus className="h-3 w-3" />
              <span className="hidden md:inline">Project</span>
            </button>
          )}
        </div>

        {/* Plan Selector & Action Menu */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs text-zinc-400">Plan:</span>
          <select
            value={activePlan?.slug || ''}
            onChange={(e) => onSelectPlan(e.target.value)}
            className="max-w-[240px] truncate rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-mono font-medium text-zinc-200 outline-none hover:border-zinc-700 focus:border-violet-500"
          >
            {activePlan && !plans.some((p) => p.slug === activePlan.slug) && (
              <option value={activePlan.slug}>
                {activePlan.title || activePlan.slug}
                {activePlan.version ? ` (v${activePlan.version})` : ''}
              </option>
            )}
            {plans.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title || p.slug}
                {p.version ? ` (v${p.version})` : ''}
                {p.status === 'ARCHIVED' ? ' (archived)' : ''}
              </option>
            ))}
            {plans.length === 0 && !activePlan && <option value="">(No active plans)</option>}
          </select>

          {onNewPlan && (
            <button
              type="button"
              onClick={onNewPlan}
              title="Create New Plan"
              className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] font-semibold text-violet-400 hover:border-violet-500/50 hover:bg-violet-500/10 transition"
            >
              <Plus className="h-3 w-3" />
              <span className="hidden md:inline">Plan</span>
            </button>
          )}

          {/* Plan Actions Overflow Menu (···) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPlanMenuOpen((prev) => !prev)}
              title="Plan Actions & Display Settings"
              className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>

            {planMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPlanMenuOpen(false)}
                />
                <div className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur font-sans">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                    Plan Options
                  </div>

                  {activePlan && (
                    <button
                      type="button"
                      onClick={() => {
                        handleCopyPlanSlug()
                        setPlanMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/80 hover:text-white transition-colors cursor-pointer"
                    >
                      {isCopied() ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-zinc-400" />
                      )}
                      <span>{isCopied() ? 'Slug Copied' : 'Copy Plan Slug'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      onToggleArchived()
                      setPlanMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/80 hover:text-white transition-colors cursor-pointer"
                  >
                    <Archive className="h-3.5 w-3.5 text-amber-400" />
                    <span>{showArchived ? 'Hide Archived Plans' : 'Show Archived Plans'}</span>
                  </button>

                  {activePlan && onDeletePlan && (
                    <>
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        type="button"
                        onClick={() => {
                          setPlanMenuOpen(false)
                          if (window.confirm(`Delete plan "${activePlan.title || activePlan.slug}" and all its tasks?`)) {
                            onDeletePlan(activePlan.slug)
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Active Plan</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {activePlan && (
            <span className="hidden rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20 xl:inline">
              {activePlan.status}{activePlan.version ? ` · v${activePlan.version}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Panels Manager & Floating HUD */}
      <div className="flex shrink-0 items-center gap-2">
        {(onOpenWorkbenchPanel || onToggleWorkbenchPanel || onResetWorkbenchLayout) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPanelsMenuOpen((prev) => !prev)}
              title="Manage Workbench Panels & Layout"
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono font-medium transition-all ${
                panelsMenuOpen
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-zinc-400" />
              <span>Panels</span>
              <ChevronDown className={`h-3 w-3 text-zinc-500 transition-transform ${panelsMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {panelsMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPanelsMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-zinc-800 bg-zinc-950/98 p-1.5 shadow-2xl backdrop-blur-md">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                    Workbench Panels
                  </div>
                  <div className="space-y-0.5">
                    {[
                      { id: 'stage' as const, label: 'Task Stage', viewName: 'Stage', icon: LayoutGrid, color: 'text-violet-400' },
                      { id: 'explorer' as const, label: 'Task Explorer', viewName: 'Hierarchy', icon: FolderTree, color: 'text-emerald-400' },
                      { id: 'resources' as const, label: 'Resources', viewName: 'Resources', icon: Package, color: 'text-cyan-400' },
                      { id: 'harness' as const, label: 'Harness & Env', viewName: 'Harness', icon: Wrench, color: 'text-fuchsia-400' },
                      { id: 'console' as const, label: 'Activity Console', viewName: 'Activity', icon: Terminal, color: 'text-amber-400' },
                      { id: 'inspector' as const, label: 'Task Inspector', viewName: 'Inspector', icon: PanelRight, color: 'text-sky-400' },
                    ].map((panel) => {
                      const enabled = isPanelEnabled(panel.id)
                      const Icon = panel.icon
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => {
                            if (onToggleWorkbenchPanel) {
                              onToggleWorkbenchPanel(panel.id)
                            } else if (onOpenWorkbenchPanel) {
                              onOpenWorkbenchPanel(panel.id)
                            }
                            // Keep menu open so user can toggle multiple panels without reopening
                          }}
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/80 hover:text-white transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={`h-3.5 w-3.5 ${panel.color}`} />
                            <span>{panel.label}</span>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] font-mono ${
                              enabled
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold'
                                : 'bg-zinc-800 text-zinc-500'
                            }`}
                          >
                            {enabled ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {onToggleHud && (
                    <>
                      <div className="my-1 border-t border-zinc-800" />
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                        Floating Overlays
                      </div>
                      <button
                        type="button"
                        onClick={onToggleHud}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/80 hover:text-white transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Radio className={`h-3.5 w-3.5 ${runningTasksCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-violet-400'}`} />
                          <span>Floating HUD</span>
                          {runningTasksCount > 0 && (
                            <span className="flex items-center justify-center rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300 border border-emerald-500/40">
                              {runningTasksCount}
                            </span>
                          )}
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-mono ${
                            hudVisible
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {hudVisible ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    </>
                  )}

                  {onResetWorkbenchLayout && (
                    <>
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        type="button"
                        onClick={() => {
                          onResetWorkbenchLayout()
                          setPanelsMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-red-400" />
                        <span>Reset Layout</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
