import React from 'react'
import { GitBranch, Package, Wrench, ScrollText } from 'lucide-react'
import type { WorkbenchPanelId } from '../workbench/panelRegistry'

export interface ActivityBarProps {
  /** Legacy prop for backward compatibility */
  currentView?: string
  /** Legacy callback for backward compatibility */
  onSelectView?: (view: any) => void
  /** Focus an already-open view, or reopen it at its default anchor when closed */
  onFocusOrOpenPanel?: (panelId: WorkbenchPanelId, shiftKey: boolean) => void
  /** Views enabled in the Panels menu; disabled views disappear from the rail. */
  enabledViews?: WorkbenchPanelId[]
  /** Map of which panels are currently open anywhere in the 4-group layout */
  openPanels?: Record<string, boolean>
  /** Map of which panels are currently the active tab in their respective group */
  activePanels?: Record<string, boolean>
  resourcesCount?: number
  agentCount?: number
}

interface ActivityBarItem {
  panelId: WorkbenchPanelId
  legacyId: string
  label: string
  viewName: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  currentView,
  onSelectView,
  onFocusOrOpenPanel,
  enabledViews,
  openPanels,
  activePanels,
  resourcesCount,
}) => {
  const items: ActivityBarItem[] = [
    {
      panelId: 'explorer',
      legacyId: 'dag',
      label: 'Hierarchy',
      viewName: 'Hierarchy',
      icon: GitBranch,
    },
    {
      panelId: 'resources',
      legacyId: 'resources',
      label: 'Resources',
      viewName: 'Resources',
      icon: Package,
      badge: resourcesCount,
    },
    {
      panelId: 'harness',
      legacyId: 'env',
      label: 'Harness',
      viewName: 'Harness',
      icon: Wrench,
    },
    {
      panelId: 'console',
      legacyId: 'activity',
      label: 'Activity',
      viewName: 'Activity',
      icon: ScrollText,
    },
  ]

  // OFF in the HeaderBar "Panels" menu removes the panel from the rail. Closing
  // a tab only hides the view, so its icon stays (dimmed) and click reopens it.
  const visibleItems = enabledViews
    ? items.filter((item) => enabledViews.includes(item.panelId))
    : items

  const handleClick = (item: ActivityBarItem, e: React.MouseEvent) => {
    if (onFocusOrOpenPanel) {
      onFocusOrOpenPanel(item.panelId, e.shiftKey)
    }
    if (onSelectView) {
      onSelectView(item.legacyId)
    }
  }

  return (
    <aside
      className="flex w-12 flex-col items-center justify-between border-r border-zinc-800/80 bg-zinc-950 py-2 select-none shrink-0 z-20"
      data-testid="activity-bar"
      aria-label="Activity Bar"
    >
      <div className="flex flex-col items-center gap-1.5 w-full">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isFocused = activePanels
            ? Boolean(activePanels[item.panelId])
            : currentView === item.legacyId
          const isOpen = openPanels ? openPanels[item.panelId] !== false : true

          return (
            <button
              key={item.panelId}
              type="button"
              onClick={(e) => handleClick(item, e)}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                isFocused
                  ? 'bg-zinc-800/90 text-cyan-400 shadow-sm'
                  : isOpen
                    ? 'text-zinc-300 hover:bg-zinc-900/60 hover:text-white'
                    : 'text-zinc-600 hover:bg-zinc-900/60 hover:text-zinc-300'
              }`}
              title={`${item.viewName} — ${
                isOpen ? 'Click: Focus' : 'Hidden — Click: Reopen'
              } · Shift+Click: Dock Home (Gr-A)`}
              aria-label={item.label}
              aria-pressed={isFocused}
            >
              {/* Active View Indicator Bar */}
              {isFocused && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-cyan-400" />
              )}

              <Icon className="h-5 w-5 transition-transform group-hover:scale-105" />

              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-500/20 px-1 text-[9px] font-mono font-semibold text-cyan-300 border border-cyan-500/30">
                  {item.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
