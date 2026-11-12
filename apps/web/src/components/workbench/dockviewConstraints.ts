import type { DockviewApi } from 'dockview-react'
import type { WorkbenchPanelId } from './panelRegistry'

export interface WorkbenchPanelSizingConfig {
  initialWidth?: number
  initialHeight?: number
  minimumWidth?: number
  maximumWidth?: number
  minimumHeight?: number
  maximumHeight?: number
}

/**
 * Ergonomic size bounds for core workbench panels across the 4-Group Dynamic Zone
 * to prevent crushing or over-expansion during sash resize.
 */
export const WORKBENCH_PANEL_CONFIGS: Record<WorkbenchPanelId, WorkbenchPanelSizingConfig> = {
  explorer: {
    initialWidth: 300,
    minimumWidth: 240,
    maximumWidth: 520,
    minimumHeight: 180,
  },
  resources: {
    initialWidth: 320,
    minimumWidth: 240,
    maximumWidth: 560,
    minimumHeight: 180,
  },
  harness: {
    initialWidth: 300,
    minimumWidth: 240,
    maximumWidth: 560,
    minimumHeight: 180,
  },
  console: {
    initialHeight: 180,
    minimumHeight: 110,
    maximumHeight: 480,
  },
  stage: {
    minimumWidth: 360,
    minimumHeight: 220,
  },
  inspector: {
    initialWidth: 440,
    minimumWidth: 320,
    maximumWidth: 680,
    minimumHeight: 180,
  },
}

/**
 * Thresholds below which horizontal or vertical splits produce squished, unreadable sub-panels.
 */
export const MIN_HORIZONTAL_SPLIT_WIDTH = 400
export const MIN_VERTICAL_SPLIT_HEIGHT = 260

export type DropPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'
export type DockviewDirection = 'left' | 'right' | 'above' | 'below' | 'within'

export interface WorkbenchPanelOpenAnchor {
  referencePanel: WorkbenchPanelId
  direction: DockviewDirection
}

/**
 * Fallback priority list of reference panels and relative directions when reopening a closed panel
 * or docking a panel back to its home group (Gr-A / Gr-B / Gr-C).
 *
 * Default 4-Group Architecture:
 * - Gr-A Top: explorer (HierarchyView), resources (ResourcesView), harness (HarnessView) tabbed within each other
 * - Gr-A Bottom: console (ActivityView) docked below Gr-A Top
 * - Gr-B Center: stage (StageView) occupying 100% height in center
 * - Gr-C Right: inspector (InspectorView) docked right of stage
 * - Gr-D Bottom: hidden by default (only appears when user manually drops below stage)
 */
/**
 * Canonical zone for every workbench panel. Zones own the sizing caps (see
 * `WORKBENCH_GROUP_CONSTRAINTS`) and are the address a closed panel returns to.
 */
export const WORKBENCH_HOME_ZONES: Record<WorkbenchPanelId, WorkbenchGroupRole> = {
  explorer: 'left-top',
  resources: 'left-top',
  harness: 'left-top',
  console: 'left-bottom',
  stage: 'center',
  inspector: 'right',
}

/**
 * Last-resort placement when a zone's group no longer exists (e.g. after a
 * full Reset Layout or a manual group close). Returns `undefined` when the
 * zone's own anchor panel is gone too; callers then fall back to
 * `resolvePanelOpenPosition`.
 */
/**
 * Where a zone recreates itself when its own group no longer exists. Home zones
 * are preferred over panels: a preserved-but-empty center zone is a stable
 * anchor even when its panels are hidden.
 */
const ZONE_GROUP_FALLBACK: Record<
  WorkbenchGroupRole,
  Array<{ role: WorkbenchGroupRole; direction: 'left' | 'right' | 'above' | 'below' }>
> = {
  'left-top': [
    { role: 'center', direction: 'left' },
    { role: 'left-bottom', direction: 'above' },
    { role: 'right', direction: 'left' },
  ],
  'left-bottom': [
    { role: 'left-top', direction: 'below' },
    { role: 'center', direction: 'below' },
  ],
  center: [
    { role: 'left-top', direction: 'right' },
    { role: 'right', direction: 'left' },
    { role: 'left-bottom', direction: 'right' },
  ],
  right: [
    { role: 'center', direction: 'right' },
    { role: 'left-top', direction: 'right' },
  ],
}

export interface WorkbenchZonePlacement {
  referenceGroup: string
  /** Omitted means "join that group as a tab" (dockview default). */
  direction?: 'left' | 'right' | 'above' | 'below'
}

/** Last-resort panel anchors, used only when no home zone group survives. */
const ZONE_PANEL_FALLBACK: Record<WorkbenchGroupRole, WorkbenchPanelOpenAnchor[]> = {
  'left-top': [
    { referencePanel: 'console', direction: 'above' },
    { referencePanel: 'explorer', direction: 'right' },
    { referencePanel: 'stage', direction: 'left' },
  ],
  'left-bottom': [
    { referencePanel: 'explorer', direction: 'below' },
    { referencePanel: 'console', direction: 'below' },
    { referencePanel: 'stage', direction: 'below' },
  ],
  center: [
    { referencePanel: 'explorer', direction: 'right' },
    { referencePanel: 'inspector', direction: 'left' },
    { referencePanel: 'console', direction: 'right' },
  ],
  right: [
    { referencePanel: 'inspector', direction: 'right' },
    { referencePanel: 'stage', direction: 'right' },
    { referencePanel: 'explorer', direction: 'right' },
  ],
}

/**
 * Placement for a missing zone group. Prefers another home zone (whose size is
 * pinned) so a recreated column never nests inside a sibling column.
 */
export function resolveZoneFallbackAnchor(
  api: DockviewApi,
  role: WorkbenchGroupRole,
  homeZones: Partial<Record<WorkbenchGroupRole, string>> = {}
): WorkbenchZonePlacement | WorkbenchPanelOpenAnchor | undefined {
  const liveGroupIds = new Set((api.groups ?? []).map((group) => group.id))

  for (const candidate of ZONE_GROUP_FALLBACK[role]) {
    const groupId = homeZones[candidate.role]
    if (groupId && liveGroupIds.has(groupId)) {
      return { referenceGroup: groupId, direction: candidate.direction }
    }
  }

  for (const anchor of ZONE_PANEL_FALLBACK[role]) {
    const panel = api.getPanel?.(anchor.referencePanel)
    if (panel) {
      return { referenceGroup: panel.group.id, direction: anchor.direction as WorkbenchZonePlacement['direction'] }
    }
  }

  return undefined
}

export const WORKBENCH_PANEL_ANCHOR_PRIORITIES: Record<WorkbenchPanelId, WorkbenchPanelOpenAnchor[]> = {
  explorer: [
    { referencePanel: 'resources', direction: 'within' },
    { referencePanel: 'harness', direction: 'within' },
    { referencePanel: 'console', direction: 'above' },
    { referencePanel: 'stage', direction: 'left' },
    { referencePanel: 'inspector', direction: 'left' },
  ],
  resources: [
    { referencePanel: 'explorer', direction: 'within' },
    { referencePanel: 'harness', direction: 'within' },
    { referencePanel: 'console', direction: 'above' },
    { referencePanel: 'stage', direction: 'left' },
    { referencePanel: 'inspector', direction: 'within' },
  ],
  harness: [
    { referencePanel: 'explorer', direction: 'within' },
    { referencePanel: 'resources', direction: 'within' },
    { referencePanel: 'console', direction: 'above' },
    { referencePanel: 'stage', direction: 'left' },
    { referencePanel: 'inspector', direction: 'within' },
  ],
  console: [
    { referencePanel: 'explorer', direction: 'below' },
    { referencePanel: 'resources', direction: 'below' },
    { referencePanel: 'harness', direction: 'below' },
    { referencePanel: 'stage', direction: 'below' },
    { referencePanel: 'inspector', direction: 'below' },
  ],
  inspector: [
    { referencePanel: 'stage', direction: 'right' },
    { referencePanel: 'explorer', direction: 'right' },
    { referencePanel: 'console', direction: 'right' },
    { referencePanel: 'resources', direction: 'right' },
  ],
  stage: [
    { referencePanel: 'explorer', direction: 'right' },
    { referencePanel: 'resources', direction: 'right' },
    { referencePanel: 'harness', direction: 'right' },
    { referencePanel: 'inspector', direction: 'left' },
    { referencePanel: 'console', direction: 'right' },
  ],
}

/**
 * Resolves the canonical position to anchor a panel when reopening or resetting it to home.
 * Falls back through the priority hierarchy based on which panels are currently present in the layout.
 */
export function resolvePanelOpenPosition(
  api: DockviewApi,
  panelId: WorkbenchPanelId
): { referencePanel: string; direction: DockviewDirection } | undefined {
  const anchors = WORKBENCH_PANEL_ANCHOR_PRIORITIES[panelId] || []
  for (const anchor of anchors) {
    if (api.getPanel?.(anchor.referencePanel)) {
      return {
        referencePanel: anchor.referencePanel,
        direction: anchor.direction,
      }
    }
  }
  return undefined
}

export interface WorkbenchDropValidationParams {
  position: DropPosition
  isEdge?: boolean
  kind?: 'tab' | 'header_space' | 'content' | 'edge'
  draggedPanelId?: string | null
  targetGroup?: {
    width?: number
    height?: number
    panels?: Array<{ id: string }>
    activePanel?: { id: string }
  }
  targetPanel?: { id: string }
}

/**
 * Evaluates whether a drop operation is permissible within the 4-Group Dynamic Workbench.
 *
 * Rules:
 * 1. Strict 4-Group Perimeter Guard (No Root-Spanning Top Banner):
 *    - Outer root-edge drops (`isEdge === true`, `kind === 'edge'`, or missing targetGroup) are
 *      STRICTLY DISALLOWED for `'top'` (prevents creating a 5th full-width top banner above Gr-A/B/C).
 *    - Vertical sidebar panels ('explorer', 'inspector', 'resources', 'harness') cannot dock to outer 'bottom' edge.
 *    - Horizontal drawer ('console') cannot dock to outer 'left' or 'right' edges.
 * 2. Gr-A Left Column ('explorer', 'resources', 'harness'):
 *    - ONLY allow 'top', 'bottom', and 'center' (tab grouping).
 *    - DISALLOW 'left' and 'right' splits (prevents weird sub-140px multi-column navigation).
 * 3. Gr-C Right Column ('inspector'):
 *    - ONLY allow 'top', 'bottom', and 'center' (tab grouping).
 *    - DISALLOW 'left' and 'right' splits (prevents crushing inspector forms into micro-columns).
 * 4. ActivityView ('console'):
 *    - ONLY allow 'left', 'right', and 'center' (tab grouping).
 *    - DISALLOW 'top' and 'bottom' splits on console itself (prevents vertical double-splitting in Gr-A Bottom or Gr-D).
 * 5. Gr-B Center Stage ('stage'):
 *    - Allows ALL directions ('top', 'bottom', 'left', 'right', 'center') when dropping other views into Gr-B.
 *    - Dragging 'stage' itself into sidebar/console groups or outer edges is disallowed to preserve workspace integrity.
 * 6. Dimensional Safety Guards:
 *    - Disallow horizontal split on any target group with width < 400px.
 *    - Disallow vertical split on any target group with height < 260px.
 */
export function isWorkbenchDropAllowed(params: WorkbenchDropValidationParams): boolean {
  const { position, isEdge, kind, draggedPanelId, targetGroup, targetPanel } = params

  const targetPanelIds: string[] = []
  if (targetGroup?.panels && Array.isArray(targetGroup.panels)) {
    for (const p of targetGroup.panels) {
      if (p?.id) targetPanelIds.push(p.id)
    }
  }
  if (targetPanel?.id && !targetPanelIds.includes(targetPanel.id)) {
    targetPanelIds.push(targetPanel.id)
  }

  // Detect whole-layout edge drop (either via isEdge flag, kind === 'edge', or absence of any target group/panel)
  const isRootEdge =
    Boolean(isEdge) || kind === 'edge' || (targetPanelIds.length === 0 && !targetGroup && !targetPanel)

  // Preserve Stage integrity: the central workspace cannot be moved into sidebars or outer edges
  if (draggedPanelId === 'stage') {
    if (isRootEdge) {
      return false
    }
    if (
      targetPanelIds.includes('explorer') ||
      targetPanelIds.includes('inspector') ||
      targetPanelIds.includes('resources') ||
      targetPanelIds.includes('harness') ||
      targetPanelIds.includes('console')
    ) {
      return false
    }
  }

  // Handle outer edge drops (perimeter of entire workbench)
  if (isRootEdge) {
    // STRICT 4-GROUP INVARIANT: Never allow any panel to dock to the outer TOP edge
    // (which would create a full-width banner above Gr-A, Gr-B, and Gr-C).
    if (position === 'top') {
      return false
    }

    if (
      draggedPanelId === 'explorer' ||
      draggedPanelId === 'inspector' ||
      draggedPanelId === 'resources' ||
      draggedPanelId === 'harness'
    ) {
      if (position === 'bottom') {
        return false
      }
    }
    if (draggedPanelId === 'console') {
      if (position === 'left' || position === 'right') {
        return false
      }
    }
    return true
  }

  // Center drops (tab grouping) within existing groups are always permitted
  if (position === 'center') {
    return true
  }

  // If the target group contains 'stage' (Gr-B Center), allow free splitting subject to dimensional guards
  const isTargetGrBCenter = targetPanelIds.includes('stage')

  if (!isTargetGrBCenter) {
    // Rule 2: Gr-A Left Column panels ('explorer', 'resources', 'harness') - only top/bottom splits allowed, no left/right
    if (
      targetPanelIds.includes('explorer') ||
      targetPanelIds.includes('resources') ||
      targetPanelIds.includes('harness')
    ) {
      if (position === 'left' || position === 'right') {
        return false
      }
    }

    // Rule 3: Gr-C Right Column ('inspector') - only top/bottom splits allowed, no left/right
    if (targetPanelIds.includes('inspector')) {
      if (position === 'left' || position === 'right') {
        return false
      }
    }

    // Rule 4: ActivityView ('console') - only left/right splits allowed, no top/bottom
    if (targetPanelIds.includes('console')) {
      if (position === 'top' || position === 'bottom') {
        return false
      }
    }
  }

  // Rule 6: Dimensional safety guards
  if ((position === 'left' || position === 'right') && typeof targetGroup?.width === 'number') {
    if (targetGroup.width > 0 && targetGroup.width < MIN_HORIZONTAL_SPLIT_WIDTH) {
      return false
    }
  }

  if ((position === 'top' || position === 'bottom') && typeof targetGroup?.height === 'number') {
    if (targetGroup.height > 0 && targetGroup.height < MIN_VERTICAL_SPLIT_HEIGHT) {
      return false
    }
  }

  return true
}

/**
 * Applies resize constraints (minimum & maximum dimensions) to all recognized
 * workbench panels across the Dockview layout.
 */
/**
 * Column roles carry the sizing caps instead of individual panels.
 *
 * Dockview resolves a group's constraints from its **active panel** when the
 * group has no explicit constraints. Panel-level caps therefore changed the
 * group's size whenever a tab was dragged in and became active: dropping the
 * 520px-wide Hierarchy view into the Center group shrank the whole stage to
 * 520px. Explicit group constraints are stable across tab changes, so every
 * group gets a role with all four bounds pinned.
 */
export type WorkbenchGroupRole = 'left-top' | 'left-bottom' | 'right' | 'center'

/** Effectively "no cap": the dockview grid clamps to the container anyway. */
const UNBOUNDED = 100_000

export const WORKBENCH_GROUP_CONSTRAINTS: Record<
  WorkbenchGroupRole,
  { minimumWidth: number; maximumWidth: number; minimumHeight: number; maximumHeight: number }
> = {
  'left-top': { minimumWidth: 240, maximumWidth: 560, minimumHeight: 180, maximumHeight: UNBOUNDED },
  'left-bottom': { minimumWidth: 240, maximumWidth: 560, minimumHeight: 110, maximumHeight: 480 },
  right: { minimumWidth: 320, maximumWidth: 680, minimumHeight: 180, maximumHeight: UNBOUNDED },
  center: { minimumWidth: 360, maximumWidth: UNBOUNDED, minimumHeight: 220, maximumHeight: UNBOUNDED },
}

interface GroupLike {
  id?: string
  panels?: Array<{ id?: string }>
}

/**
 * Resolves a group's role from its members. `stage` wins because it is the
 * flexible workspace anchor: a group holding the stage must never be capped.
 */
export function resolveWorkbenchGroupRole(group: GroupLike): WorkbenchGroupRole {
  const ids = new Set((group.panels ?? []).map((panel) => panel.id).filter(Boolean) as string[])
  if (ids.has('stage')) return 'center'
  if (ids.has('inspector')) return 'right'
  if (ids.has('explorer')) return 'left-top'
  if (ids.has('console')) return 'left-bottom'
  return 'center'
}

/**
 * Pins explicit constraints on every grid group so group sizes survive tab
 * drags. Idempotent: re-applying the same bounds is a no-op in dockview.
 */
export function applyGroupConstraints(
  api: DockviewApi,
  homeZones: Partial<Record<WorkbenchGroupRole, string>> = {}
): void {
  const groups = (api as any)?.groups
  if (!Array.isArray(groups)) return

  const roleByGroupId = new Map<string, WorkbenchGroupRole>()
  for (const [role, groupId] of Object.entries(homeZones)) {
    if (groupId) roleByGroupId.set(groupId, role as WorkbenchGroupRole)
  }

  for (const group of groups) {
    // `location` is an object ({ type: 'grid' | 'floating' | 'popout' }) on
    // dockview 8.x; older builds exposed a plain string.
    const location = (group as any)?.api?.location
    const locationType = typeof location === 'string' ? location : location?.type
    if (locationType && locationType !== 'grid') continue
    // An emptied home zone has no panels to infer from, so trust the zone map.
    const pinnedRole = (group as any)?.id ? roleByGroupId.get((group as any).id) : undefined
    const role = pinnedRole ?? resolveWorkbenchGroupRole(group)
    try {
      ;(group as any)?.api?.setConstraints?.(WORKBENCH_GROUP_CONSTRAINTS[role])
    } catch {
      // Ignored in headless testing environments
    }
  }
}
