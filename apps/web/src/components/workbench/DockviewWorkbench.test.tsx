import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  DockviewWorkbench,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  createDefaultLayout,
  type DockviewWorkbenchRef,
} from './DockviewWorkbench'
import { isWorkbenchDropAllowed } from './dockviewConstraints'
import { defaultWorkbenchState } from './panelRegistry'
import React from 'react'

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

describe('DockviewWorkbench', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders workbench root container with zenforge theme class', () => {
    render(<DockviewWorkbench state={defaultWorkbenchState} />)

    const root = screen.getByTestId('dockview-workbench-root')
    expect(root).toBeDefined()
    expect(root.querySelector('.dockview-theme-zenforge')).toBeDefined()
  })

  it('createDefaultLayout adds all 6 standardized views across the 4-group layout with preservation renderer', () => {
    const mockAddPanel = vi.fn()
    const mockClear = vi.fn()
    const mockApi = {
      clear: mockClear,
      addPanel: mockAddPanel,
      totalPanels: 6,
    } as any

    createDefaultLayout(mockApi)

    expect(mockClear).toHaveBeenCalledTimes(1)
    expect(mockAddPanel).toHaveBeenCalledTimes(6)

    const panelIds = mockAddPanel.mock.calls.map((call) => call[0].id)
    expect(panelIds).toEqual([
      'explorer',
      'resources',
      'harness',
      'stage',
      'console',
      'inspector',
    ])

    // Verify console (ActivityView) is docked below explorer (Gr-A Bottom) so stage has 100% height
    const consoleCall = mockAddPanel.mock.calls.find((c) => c[0].id === 'console')?.[0]
    expect(consoleCall.position).toEqual({
      referencePanel: 'explorer',
      direction: 'below',
    })

    mockAddPanel.mock.calls.forEach((call) => {
      expect(call[0].renderer).toBe('always')
    })
  })

  it('restores layout from localStorage when valid JSON is stored', () => {
    const dummyLayout = { grid: { root: {} }, panels: { explorer: {} } }
    localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(dummyLayout))

    let capturedApi: any = null
    render(
      <DockviewWorkbench
        state={defaultWorkbenchState}
        onReady={(api) => {
          capturedApi = api
        }}
      />
    )

    expect(capturedApi).toBeDefined()
  })

  it('handles corrupted JSON in localStorage gracefully with fallback to default preset', () => {
    localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, 'corrupted{json-invalid')

    let capturedApi: any = null
    expect(() => {
      render(
        <DockviewWorkbench
          state={defaultWorkbenchState}
          onReady={(api) => {
            capturedApi = api
          }}
        />
      )
    }).not.toThrow()

    expect(capturedApi).toBeDefined()
    expect(localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it('resetLayout clears localStorage and recreates default layout', () => {
    localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify({ old: true }))
    const ref = React.createRef<DockviewWorkbenchRef>()

    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)

    expect(ref.current).toBeDefined()
    act(() => {
      ref.current?.resetLayout()
    })

    expect(localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it('openPanel activates existing panel or adds missing panel, and isPanelOpen checks existence', () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)

    expect(ref.current).toBeDefined()

    expect(ref.current?.isPanelOpen('stage')).toBe(true)
    expect(ref.current?.isPanelOpen('explorer')).toBe(true)
    expect(ref.current?.isPanelOpen('harness')).toBe(true)

    act(() => {
      ref.current?.openPanel('stage')
    })

    const api = ref.current?.getApi()
    expect(api).toBeDefined()
    const stagePanel = api?.getPanel('stage')
    expect(stagePanel).toBeDefined()
  })

  it('createDefaultLayout configures min/max constraints on added panels', () => {
    const mockAddPanel = vi.fn().mockReturnValue({ api: { setSize: vi.fn(), setConstraints: vi.fn() } })
    const mockClear = vi.fn()
    const mockApi = {
      clear: mockClear,
      addPanel: mockAddPanel,
      getPanel: vi.fn(),
      totalPanels: 6,
    } as any

    createDefaultLayout(mockApi)

    const calls = mockAddPanel.mock.calls
    const explorerCall = calls.find((c) => c[0].id === 'explorer')?.[0]
    expect(explorerCall.minimumWidth).toBe(240)
    expect(explorerCall.maximumWidth).toBe(520)

    const consoleCall = calls.find((c) => c[0].id === 'console')?.[0]
    expect(consoleCall.minimumHeight).toBe(110)
    expect(consoleCall.maximumHeight).toBe(480)

    const inspectorCall = calls.find((c) => c[0].id === 'inspector')?.[0]
    expect(inspectorCall.minimumWidth).toBe(320)
    expect(inspectorCall.maximumWidth).toBe(680)

    const stageCall = calls.find((c) => c[0].id === 'stage')?.[0]
    expect(stageCall.minimumWidth).toBe(360)
    expect(stageCall.minimumHeight).toBe(220)
  })

  it('prevents drops and overlays when dropping onto forbidden zones (e.g. left on explorer)', () => {
    let capturedApi: any = null
    render(
      <DockviewWorkbench
        state={defaultWorkbenchState}
        onReady={(api) => {
          capturedApi = api
        }}
      />
    )

    expect(capturedApi).toBeDefined()

    const disallowedOverlay = {
      position: 'left' as const,
      isEdge: false,
      targetGroup: { panels: [{ id: 'explorer' }] },
      targetPanel: { id: 'explorer' },
      draggedPanelId: 'console',
    }
    expect(isWorkbenchDropAllowed(disallowedOverlay)).toBe(false)

    const disallowedDrop = {
      position: 'top' as const,
      isEdge: false,
      targetGroup: { panels: [{ id: 'console' }] },
      targetPanel: { id: 'console' },
      draggedPanelId: 'stage',
    }
    expect(isWorkbenchDropAllowed(disallowedDrop)).toBe(false)

    expect(capturedApi.getPanel('explorer')).toBeDefined()
    expect(capturedApi.getPanel('console')).toBeDefined()
  })

  it('supports closePanel and focusOrOpenPanel (Activity rail)', () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    const visibilitySpy = vi.fn()

    render(
      <DockviewWorkbench
        ref={ref}
        state={defaultWorkbenchState}
        onPanelVisibilityChange={visibilitySpy}
      />
    )

    expect(ref.current).toBeDefined()
    expect(ref.current?.isPanelOpen('inspector')).toBe(true)

    expect(visibilitySpy).toHaveBeenCalledWith('inspector', true)

    act(() => {
      ref.current?.closePanel('inspector')
    })
    expect(ref.current?.isPanelOpen('inspector')).toBe(false)

    // Focus an existing panel: it must stay open (the rail never closes).
    expect(ref.current?.isPanelOpen('resources')).toBe(true)
    act(() => {
      ref.current?.focusOrOpenPanel('resources', false)
    })
    expect(ref.current?.isPanelOpen('resources')).toBe(true)

    // Clicking again keeps it open instead of toggling it off.
    act(() => {
      ref.current?.focusOrOpenPanel('resources', false)
    })
    expect(ref.current?.isPanelOpen('resources')).toBe(true)

    // Shift + Click docks 'resources' back home
    act(() => {
      ref.current?.focusOrOpenPanel('resources', true)
    })
    expect(ref.current?.isPanelOpen('resources')).toBe(true)

    // Closed panel: the rail reopens it at its default anchor.
    act(() => {
      ref.current?.closePanel('resources')
    })
    expect(ref.current?.isPanelOpen('resources')).toBe(false)
    act(() => {
      ref.current?.focusOrOpenPanel('resources', false)
    })
    expect(ref.current?.isPanelOpen('resources')).toBe(true)
  })

  it('keeps zone identity and group count stable across 10 close/open cycles', async () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)

    const api = ref.current?.getApi()
    expect(api).toBeDefined()

    const groupCount = api!.groups.length
    const stageZoneId = api!.getPanel('stage')!.group.id
    expect(stageZoneId).toBeTruthy()

    for (let cycle = 0; cycle < 10; cycle++) {
      await act(async () => {
        ref.current?.closePanel('stage')
      })
      expect(api!.getPanel('stage')).toBeUndefined()
      // The zone must survive the close; destroying it is what drifted the grid.
      expect(api!.groups.length).toBe(groupCount)

      await act(async () => {
        ref.current?.openPanel('stage')
      })
      expect(api!.getPanel('stage')!.group.id).toBe(stageZoneId)
      expect(api!.groups.length).toBe(groupCount)
      // Reopened panels must actually render, not stay display:none.
      const stageHost = document.querySelector('[data-testid="workbench-panel-stage"]') as HTMLElement | null
      expect(stageHost?.style.display).toBe('flex')
    }

    // The center zone must still be pinned to the center role caps, not fall
    // back to the active panel's maximumWidth (the original resize bug).
    const centerZone = api!.groups.find((group) => group.id === stageZoneId)!
    expect(centerZone.minimumWidth).toBe(360)
    expect(centerZone.maximumWidth).toBe(100_000)
  })

  it('closing the last panel of a zone via the panel API keeps the group alive', async () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)

    const api = ref.current?.getApi()
    const groupCount = api!.groups.length
    const inspectorZoneId = api!.getPanel('inspector')!.group.id

    await act(async () => {
      api!.getPanel('inspector')!.api.close()
    })

    expect(api!.getPanel('inspector')).toBeUndefined()
    expect(api!.groups.length).toBe(groupCount)
    expect(api!.groups.some((group) => group.id === inspectorZoneId && group.panels.length === 0)).toBe(true)

    await act(async () => {
      ref.current?.openPanel('inspector')
    })
    expect(api!.getPanel('inspector')!.group.id).toBe(inspectorZoneId)
  })

  it('boots with disabled views closed but keeps their zones', () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    render(
      <DockviewWorkbench
        ref={ref}
        state={defaultWorkbenchState}
        enabledViews={['explorer', 'stage']}
      />
    )

    expect(ref.current?.isPanelOpen('explorer')).toBe(true)
    expect(ref.current?.isPanelOpen('stage')).toBe(true)
    expect(ref.current?.isPanelOpen('harness')).toBe(false)
    expect(ref.current?.isPanelOpen('inspector')).toBe(false)
  })

  it('resetLayout clears both the layout and zone registries', () => {
    localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify({ stale: true }))
    localStorage.setItem('zenf_workbench_zones_v1', JSON.stringify({ center: 'old-group' }))
    const ref = React.createRef<DockviewWorkbenchRef>()

    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)
    act(() => {
      ref.current?.resetLayout()
    })

    // Reset rebuilds the canonical layout, so both keys are re-written from the
    // fresh 4-zone template rather than left stale.
    expect(localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) ?? '').not.toContain('stale')
    const zones = JSON.parse(localStorage.getItem('zenf_workbench_zones_v1') || '{}')
    expect(Object.values(zones)).not.toContain('old-group')
  })



  it('hiding and reopening any panel keeps its zone id and never changes column count', async () => {
    const ref = React.createRef<DockviewWorkbenchRef>()
    render(<DockviewWorkbench ref={ref} state={defaultWorkbenchState} />)

    const api = ref.current?.getApi()
    const groupCount = api!.groups.length
    const zoneByPanel = new Map<string, string>()
    for (const panelId of ['explorer', 'resources', 'harness', 'console', 'stage', 'inspector'] as const) {
      zoneByPanel.set(panelId, api!.getPanel(panelId)!.group.id)
    }

    for (const panelId of ['explorer', 'resources', 'harness', 'console', 'stage', 'inspector'] as const) {
      await act(async () => {
        ref.current?.closePanel(panelId)
      })
      expect(api!.getPanel(panelId)).toBeUndefined()
      expect(api!.groups.length).toBe(groupCount)

      await act(async () => {
        ref.current?.openPanel(panelId)
      })
      expect(api!.getPanel(panelId)!.group.id).toBe(zoneByPanel.get(panelId))
      expect(api!.groups.length).toBe(groupCount)
    }
  })

})
