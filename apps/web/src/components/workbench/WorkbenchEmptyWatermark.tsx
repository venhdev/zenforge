import React from 'react'
import type { IWatermarkPanelProps } from 'dockview-react'
import { RotateCcw, LayoutGrid, FolderTree, GitFork, Terminal, PanelRight, Package, Wrench } from 'lucide-react'
import { createDefaultLayout } from './DockviewWorkbench'
import {
  DOCKVIEW_PRESERVATION_RENDERER,
  WORKBENCH_VIEW_TITLES,
  useWorkbenchContext,
  type WorkbenchPanelId,
} from './panelRegistry'

const VIEW_ICONS: Record<WorkbenchPanelId, React.ReactNode> = {
  stage: <GitFork className="h-3 w-3 text-violet-400" />,
  explorer: <FolderTree className="h-3 w-3 text-emerald-400" />,
  resources: <Package className="h-3 w-3 text-sky-400" />,
  harness: <Wrench className="h-3 w-3 text-violet-400" />,
  console: <Terminal className="h-3 w-3 text-cyan-400" />,
  inspector: <PanelRight className="h-3 w-3 text-amber-400" />,
}

/**
 * Rendered by dockview for an empty dock and for every empty group. An empty
 * zone is a deliberate state now (hiding a view keeps its group alive), so the
 * compact variant explains the state instead of leaving a black rectangle.
 */
export const WorkbenchEmptyWatermark: React.FC<IWatermarkPanelProps> = ({ containerApi, group }) => {
  const ctx = useWorkbenchContext()
  const totalPanels = typeof containerApi.totalPanels === 'number' ? containerApi.totalPanels : 0

  const handleRestoreDefault = () => {
    if (ctx.onResetWorkbenchLayout) {
      ctx.onResetWorkbenchLayout()
      return
    }
    createDefaultLayout(containerApi)
  }

  const openPanel = (id: WorkbenchPanelId) => {
    const existing = containerApi.getPanel(id)
    if (existing) {
      existing.api.setActive()
      return
    }
    containerApi.addPanel({
      id,
      component: id,
      title: WORKBENCH_VIEW_TITLES[id],
      renderer: DOCKVIEW_PRESERVATION_RENDERER,
      ...(group ? { position: { referenceGroup: group.id } } : {}),
    })
  }

  if (totalPanels === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-zinc-950 p-6 select-none"
        data-testid="workbench-empty-watermark"
      >
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-8 text-center shadow-2xl backdrop-blur-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/30 shadow-[0_0_24px_rgba(139,92,246,0.2)] mb-4">
            <LayoutGrid className="h-6 w-6" />
          </div>

          <h3 className="text-base font-semibold text-zinc-100">All Panels Closed</h3>
          <p className="mt-1.5 text-xs text-zinc-400 max-w-xs leading-relaxed">
            Your workbench is currently empty. You can restore the default multi-panel layout or
            reopen any specific view.
          </p>

          <button
            type="button"
            onClick={handleRestoreDefault}
            className="mt-6 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-500 active:scale-95 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Restore Default Layout</span>
          </button>

          <div className="mt-6 w-full border-t border-zinc-800/80 pt-5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Reopen View
            </span>
            <div className="mt-2.5 flex flex-wrap justify-center gap-2">
              {(Object.keys(VIEW_ICONS) as WorkbenchPanelId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openPanel(id)}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer"
                >
                  {VIEW_ICONS[id]}
                  <span>{WORKBENCH_VIEW_TITLES[id]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const zoneViews = group && ctx.homeViewsForGroup ? ctx.homeViewsForGroup(group.id) : []
  const reopenable = zoneViews.filter(
    (id) => !containerApi.getPanel(id) && (!ctx.enabledViews || ctx.enabledViews.includes(id))
  )

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-950/60 p-4 text-center select-none"
      data-testid="workbench-empty-zone"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800">
        <LayoutGrid className="h-3.5 w-3.5" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-zinc-300">View hidden</p>
        <p className="max-w-[16rem] text-[11px] leading-relaxed text-zinc-500">
          This zone keeps its size. Reopen a view here, from the ActivityBar, or with Panels → ON.
        </p>
      </div>
      {reopenable.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {reopenable.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => openPanel(id)}
              className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer"
            >
              {VIEW_ICONS[id]}
              <span>{WORKBENCH_VIEW_TITLES[id]}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={handleRestoreDefault}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300 cursor-pointer"
      >
        <RotateCcw className="h-3 w-3" />
        <span>Reset layout</span>
      </button>
    </div>
  )
}
