import { describe, it, expect, vi } from 'vitest'
import {
  isWorkbenchDropAllowed,
  applyGroupConstraints,
  resolveWorkbenchGroupRole,
  WORKBENCH_GROUP_CONSTRAINTS,
  WORKBENCH_HOME_ZONES,
  resolveZoneFallbackAnchor,
  resolvePanelOpenPosition,
  WORKBENCH_PANEL_CONFIGS,
  MIN_HORIZONTAL_SPLIT_WIDTH,
  MIN_VERTICAL_SPLIT_HEIGHT,
} from './dockviewConstraints'

describe('dockviewConstraints', () => {
  describe('WORKBENCH_PANEL_CONFIGS', () => {
    it('defines expected sizing bounds for all 6 workbench panels', () => {
      expect(WORKBENCH_PANEL_CONFIGS.explorer).toEqual({
        initialWidth: 300,
        minimumWidth: 240,
        maximumWidth: 520,
        minimumHeight: 180,
      })
      expect(WORKBENCH_PANEL_CONFIGS.resources).toEqual({
        initialWidth: 320,
        minimumWidth: 240,
        maximumWidth: 560,
        minimumHeight: 180,
      })
      expect(WORKBENCH_PANEL_CONFIGS.harness).toEqual({
        initialWidth: 300,
        minimumWidth: 240,
        maximumWidth: 560,
        minimumHeight: 180,
      })
      expect(WORKBENCH_PANEL_CONFIGS.console).toEqual({
        initialHeight: 180,
        minimumHeight: 110,
        maximumHeight: 480,
      })
      expect(WORKBENCH_PANEL_CONFIGS.stage).toEqual({
        minimumWidth: 360,
        minimumHeight: 220,
      })
      expect(WORKBENCH_PANEL_CONFIGS.inspector).toEqual({
        initialWidth: 440,
        minimumWidth: 320,
        maximumWidth: 680,
        minimumHeight: 180,
      })
    })
  })

  describe('isWorkbenchDropAllowed - Gr-A Left Column (Explorer, Resources, Harness)', () => {
    const explorerGroup = {
      width: 500,
      height: 800,
      panels: [{ id: 'explorer' }, { id: 'resources' }, { id: 'harness' }],
    }

    it('blocks horizontal splits (left and right) on Gr-A Left Column', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          targetGroup: explorerGroup,
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          targetGroup: explorerGroup,
        })
      ).toBe(false)
    })

    it('allows vertical splits (top and bottom) and center tab grouping on Gr-A Left Column', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          targetGroup: explorerGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          targetGroup: explorerGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'center',
          targetGroup: explorerGroup,
        })
      ).toBe(true)
    })

    it('identifies explorer by targetPanel fallback if targetGroup.panels is omitted', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          targetPanel: { id: 'explorer' },
        })
      ).toBe(false)
    })
  })

  describe('isWorkbenchDropAllowed - Gr-C Right Column (Inspector)', () => {
    const inspectorGroup = {
      width: 500,
      height: 800,
      panels: [{ id: 'inspector' }],
    }

    it('blocks horizontal splits (left and right) on inspector', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          targetGroup: inspectorGroup,
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          targetGroup: inspectorGroup,
        })
      ).toBe(false)
    })

    it('allows vertical splits (top and bottom) and center tab grouping on inspector', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          targetGroup: inspectorGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          targetGroup: inspectorGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'center',
          targetGroup: inspectorGroup,
        })
      ).toBe(true)
    })
  })

  describe('isWorkbenchDropAllowed - ActivityView (Console)', () => {
    const consoleGroup = {
      width: 1000,
      height: 400,
      panels: [{ id: 'console' }],
    }

    it('blocks vertical splits (top and bottom) on console drawer', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          targetGroup: consoleGroup,
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          targetGroup: consoleGroup,
        })
      ).toBe(false)
    })

    it('allows horizontal splits (left and right) and center tab grouping on console', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          targetGroup: consoleGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          targetGroup: consoleGroup,
        })
      ).toBe(true)

      expect(
        isWorkbenchDropAllowed({
          position: 'center',
          targetGroup: consoleGroup,
        })
      ).toBe(true)
    })
  })

  describe('isWorkbenchDropAllowed - Gr-B Center Canvas (Stage) Protection & Free Splitting', () => {
    const stageGroup = {
      width: 800,
      height: 600,
      panels: [{ id: 'stage' }],
    }

    it('allows all directions when docking another panel into Gr-B stage', () => {
      const positions: Array<'top' | 'bottom' | 'left' | 'right' | 'center'> = [
        'top',
        'bottom',
        'left',
        'right',
        'center',
      ]

      for (const pos of positions) {
        expect(
          isWorkbenchDropAllowed({
            position: pos,
            targetGroup: stageGroup,
            draggedPanelId: 'inspector',
          })
        ).toBe(true)
      }
    })

    it('blocks dragging stage into explorer, resources, harness, inspector, or console', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'center',
          draggedPanelId: 'stage',
          targetGroup: { panels: [{ id: 'explorer' }] },
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'center',
          draggedPanelId: 'stage',
          targetGroup: { panels: [{ id: 'harness' }] },
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          draggedPanelId: 'stage',
          targetGroup: { panels: [{ id: 'inspector' }], height: 600 },
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          draggedPanelId: 'stage',
          targetGroup: { panels: [{ id: 'console' }], width: 600 },
        })
      ).toBe(false)
    })

    it('blocks dragging stage onto workbench outer edges', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          isEdge: true,
          draggedPanelId: 'stage',
        })
      ).toBe(false)
    })
  })

  describe('isWorkbenchDropAllowed - Outer Workspace Edges', () => {
    it('blocks docking vertical panels to outer top or bottom edge', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          isEdge: true,
          draggedPanelId: 'explorer',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          isEdge: true,
          draggedPanelId: 'inspector',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          isEdge: true,
          draggedPanelId: 'harness',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          isEdge: true,
          draggedPanelId: 'explorer',
        })
      ).toBe(true)
    })

    it('blocks docking horizontal drawer to outer left, right, or top edge, allows bottom edge (Gr-D)', () => {
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          isEdge: true,
          draggedPanelId: 'console',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          isEdge: true,
          draggedPanelId: 'console',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          isEdge: true,
          draggedPanelId: 'console',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          kind: 'edge',
          draggedPanelId: 'console',
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          isEdge: true,
          draggedPanelId: 'console',
        })
      ).toBe(true)
    })
  })

  describe('isWorkbenchDropAllowed - Dimensional Safety Guards', () => {
    it(`blocks horizontal splits when group width is below ${MIN_HORIZONTAL_SPLIT_WIDTH}px`, () => {
      const narrowGroup = {
        width: 380,
        height: 500,
        panels: [{ id: 'custom-view' }],
      }

      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          targetGroup: narrowGroup,
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'right',
          targetGroup: narrowGroup,
        })
      ).toBe(false)

      // Vertical split still allowed if height permits
      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          targetGroup: narrowGroup,
        })
      ).toBe(true)
    })

    it(`blocks vertical splits when group height is below ${MIN_VERTICAL_SPLIT_HEIGHT}px`, () => {
      const shortGroup = {
        width: 600,
        height: 200,
        panels: [{ id: 'custom-view' }],
      }

      expect(
        isWorkbenchDropAllowed({
          position: 'top',
          targetGroup: shortGroup,
        })
      ).toBe(false)

      expect(
        isWorkbenchDropAllowed({
          position: 'bottom',
          targetGroup: shortGroup,
        })
      ).toBe(false)

      // Horizontal split still allowed if width permits
      expect(
        isWorkbenchDropAllowed({
          position: 'left',
          targetGroup: shortGroup,
        })
      ).toBe(true)
    })
  })

  describe('resolveWorkbenchGroupRole', () => {
    it('gives the stage group the uncapped center role', () => {
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'stage' }] })).toBe('center')
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'stage' }, { id: 'console' }] })).toBe('center')
    })

    it('classifies sidebar, inspector, and console groups', () => {
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'explorer' }, { id: 'resources' }] })).toBe('left-top')
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'inspector' }] })).toBe('right')
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'console' }] })).toBe('left-bottom')
      expect(resolveWorkbenchGroupRole({ panels: [{ id: 'unknown' }] })).toBe('center')
      expect(resolveWorkbenchGroupRole({})).toBe('center')
    })
  })

  describe('WORKBENCH_HOME_ZONES', () => {
    it('maps every panel to its canonical zone', () => {
      expect(WORKBENCH_HOME_ZONES).toEqual({
        explorer: 'left-top',
        resources: 'left-top',
        harness: 'left-top',
        console: 'left-bottom',
        stage: 'center',
        inspector: 'right',
      })
    })
  })

  describe('resolveZoneFallbackAnchor', () => {
    it('prefers another home zone group, even when that zone is empty', () => {
      const api = {
        groups: [{ id: 'g-center' }, { id: 'g-left' }],
        getPanel: () => null,
      } as any

      expect(resolveZoneFallbackAnchor(api, 'right', { center: 'g-center', 'left-top': 'g-left' })).toEqual({
        referenceGroup: 'g-center',
        direction: 'right',
      })
      expect(resolveZoneFallbackAnchor(api, 'left-top', { center: 'g-center' })).toEqual({
        referenceGroup: 'g-center',
        direction: 'left',
      })
    })

    it('falls back to the group of a surviving anchor panel', () => {
      const api = {
        groups: [{ id: 'g-left' }],
        getPanel: (id: string) =>
          id === 'explorer' ? { id, group: { id: 'g-left' } } : null,
      } as any

      expect(resolveZoneFallbackAnchor(api, 'center')).toEqual({
        referenceGroup: 'g-left',
        direction: 'right',
      })

      const consoleOnly = {
        groups: [{ id: 'g-console' }],
        getPanel: (id: string) => (id === 'console' ? { id, group: { id: 'g-console' } } : null),
      } as any
      expect(resolveZoneFallbackAnchor(consoleOnly, 'left-bottom')).toEqual({
        referenceGroup: 'g-console',
        direction: 'below',
      })
    })

    it('ignores stale zone ids and returns undefined when nothing is left', () => {
      const api = { groups: [], getPanel: () => null } as any
      expect(resolveZoneFallbackAnchor(api, 'center', { center: 'gone-group' })).toBeUndefined()
    })
  })

  describe('WORKBENCH_GROUP_CONSTRAINTS', () => {
    it('pins all four bounds so no panel constraint can leak into a group', () => {
      for (const role of ['left-top', 'left-bottom', 'right', 'center'] as const) {
        const constraints = WORKBENCH_GROUP_CONSTRAINTS[role]
        expect(typeof constraints.minimumWidth).toBe('number')
        expect(typeof constraints.maximumWidth).toBe('number')
        expect(typeof constraints.minimumHeight).toBe('number')
        expect(typeof constraints.maximumHeight).toBe('number')
      }
      expect(WORKBENCH_GROUP_CONSTRAINTS.center).toEqual({
        minimumWidth: 360,
        maximumWidth: 100_000,
        minimumHeight: 220,
        maximumHeight: 100_000,
      })
    })
  })

  describe('applyGroupConstraints', () => {
    function makeGroup(id: string, panels: string[], location = 'grid') {
      return { id, panels: panels.map((panelId) => ({ id: panelId })), api: { location, setConstraints: vi.fn() } }
    }

    it('pins every grid group with the constraints for its role', () => {
      const left = makeGroup('g-left', ['explorer'])
      const center = makeGroup('g-center', ['stage'])
      const right = makeGroup('g-right', ['inspector'])
      const floating = makeGroup('g-float', ['resources'], 'floating')

      applyGroupConstraints({ groups: [left, center, right, floating] } as any)

      expect(left.api.setConstraints).toHaveBeenCalledWith(WORKBENCH_GROUP_CONSTRAINTS['left-top'])
      expect(center.api.setConstraints).toHaveBeenCalledWith(WORKBENCH_GROUP_CONSTRAINTS.center)
      expect(right.api.setConstraints).toHaveBeenCalledWith(WORKBENCH_GROUP_CONSTRAINTS.right)
      expect(floating.api.setConstraints).not.toHaveBeenCalled()
    })

    it('keeps the center group uncapped when a sidebar view is tabbed into it', () => {
      const center = makeGroup('g-center', ['stage'])
      const api = { groups: [center] } as any

      applyGroupConstraints(api)
      center.panels.push({ id: 'explorer' })
      applyGroupConstraints(api)

      const calls = center.api.setConstraints.mock.calls
      expect(calls[calls.length - 1][0]).toEqual(WORKBENCH_GROUP_CONSTRAINTS.center)
      expect(calls[calls.length - 1][0].maximumWidth).toBe(100_000)
    })

    it('pins an emptied home zone to its stored role', () => {
      const empty = makeGroup('g-empty', [])
      applyGroupConstraints({ groups: [empty] } as any, { 'left-bottom': 'g-empty' })

      expect(empty.api.setConstraints).toHaveBeenCalledWith(
        WORKBENCH_GROUP_CONSTRAINTS['left-bottom']
      )
    })

    it('never throws when groups or setConstraints are unavailable', () => {
      expect(() => applyGroupConstraints({} as any)).not.toThrow()
      expect(() => applyGroupConstraints({ groups: [{ id: 'g' }] } as any)).not.toThrow()
    })
  })

  describe('resolvePanelOpenPosition', () => {
    it('resolves primary anchor for inspector to right of stage', () => {
      const mockApi = {
        getPanel: vi.fn((id: string) => (id === 'stage' ? { id: 'stage' } : null)),
      } as any

      expect(resolvePanelOpenPosition(mockApi, 'inspector')).toEqual({
        referencePanel: 'stage',
        direction: 'right',
      })
    })

    it('falls back to explorer or console for inspector when stage is closed', () => {
      const mockApiWithConsole = {
        getPanel: vi.fn((id: string) => (id === 'console' ? { id: 'console' } : null)),
      } as any

      expect(resolvePanelOpenPosition(mockApiWithConsole, 'inspector')).toEqual({
        referencePanel: 'console',
        direction: 'right',
      })

      const mockApiWithExplorer = {
        getPanel: vi.fn((id: string) => (id === 'explorer' ? { id: 'explorer' } : null)),
      } as any

      expect(resolvePanelOpenPosition(mockApiWithExplorer, 'inspector')).toEqual({
        referencePanel: 'explorer',
        direction: 'right',
      })
    })

    it('resolves primary anchor for explorer to within resources/harness or left of stage', () => {
      const mockApiWithStageOnly = {
        getPanel: vi.fn((id: string) => (id === 'stage' ? { id: 'stage' } : null)),
      } as any

      expect(resolvePanelOpenPosition(mockApiWithStageOnly, 'explorer')).toEqual({
        referencePanel: 'stage',
        direction: 'left',
      })
    })

    it('resolves primary anchor for console (ActivityView) to below explorer (Gr-A Bottom)', () => {
      const mockApi = {
        getPanel: vi.fn((id: string) => (id === 'explorer' ? { id: 'explorer' } : null)),
      } as any

      expect(resolvePanelOpenPosition(mockApi, 'console')).toEqual({
        referencePanel: 'explorer',
        direction: 'below',
      })
    })

    it('returns undefined if all anchor candidate panels are absent', () => {
      const mockApiEmpty = {
        getPanel: vi.fn().mockReturnValue(null),
      } as any

      expect(resolvePanelOpenPosition(mockApiEmpty, 'inspector')).toBeUndefined()
    })
  })
})
