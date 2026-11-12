import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  workbenchComponents,
  DOCKVIEW_PRESERVATION_RENDERER,
  WorkbenchProvider,
  usePanelResizeHandler,
  usePanelVisibility,
  ExplorerPanel,
  StagePanel,
  ConsolePanel,
  InspectorPanel,
  HarnessPanel,
  type WorkbenchState,
} from './panelRegistry'
import type { Task } from '../../types/contracts'

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

const mockTask: Task = {
  id: 'task-101',
  project_slug: 'zenforge',
  plan_slug: 'test-plan',
  title: 'Test Task 101',
  description: 'Test description',
  dependencies: [],
  priority: 'P1',
  complexity: 'LOW',
  risk_level: 'LOW',
  target_files: ['file1.ts'],
  acceptance_criteria: ['Pass unit tests'],
  verification_commands: ['npm test'],
  status: 'READY',
  created_at: '2026-11-08T12:00:00Z',
  updated_at: '2026-11-08T12:00:00Z',
}

const mockState: WorkbenchState = {
  tasks: [mockTask],
  selectedTaskId: 'task-101',
  selectedTask: mockTask,
  artifacts: [],
  onSelectTask: vi.fn(),
  onSelectTaskId: vi.fn(),
  logTick: 1,
}

describe('panelRegistry', () => {
  it('exports greedy state preservation constant', () => {
    expect(DOCKVIEW_PRESERVATION_RENDERER).toBe('always')
  })

  it('contains all 6 standardized panel components in workbenchComponents dictionary', () => {
    expect(workbenchComponents.explorer).toBeDefined()
    expect(workbenchComponents.resources).toBeDefined()
    expect(workbenchComponents.harness).toBeDefined()
    expect(workbenchComponents.stage).toBeDefined()
    expect(workbenchComponents.console).toBeDefined()
    expect(workbenchComponents.inspector).toBeDefined()
  })

  it('renders ExplorerPanel with task data from WorkbenchContext', () => {
    render(
      <WorkbenchProvider value={mockState}>
        <ExplorerPanel api={{} as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-panel-explorer')).toBeDefined()
    expect(screen.getByText('Test Task 101')).toBeDefined()
  })

  it('renders StagePanel within container', () => {
    render(
      <WorkbenchProvider value={mockState}>
        <StagePanel api={{} as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-panel-stage')).toBeDefined()
  })

  it('renders ConsolePanel with LiveLog stream', () => {
    render(
      <WorkbenchProvider value={mockState}>
        <ConsolePanel api={{} as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-panel-console')).toBeDefined()
  })

  it('renders HarnessPanel with runtime and toolchain diagnostics', async () => {
    const onFetchStatus = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(
      <WorkbenchProvider value={{ ...mockState, onFetchStatus }}>
        <HarnessPanel api={{ isVisible: true } as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-panel-harness')).toBeDefined()
    expect(screen.getByText('Harness')).toBeDefined()
    expect(screen.getByTestId('harness-telemetry-section')).toBeDefined()
    await act(async () => {
      await Promise.resolve()
    })
    expect(onFetchStatus).toHaveBeenCalled()
  })

  it('renders InspectorPanel with task inspection view', () => {
    render(
      <WorkbenchProvider value={mockState}>
        <InspectorPanel api={{} as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-panel-inspector')).toBeDefined()
    expect(screen.getByText('Test Task 101')).toBeDefined()
  })

  it('dispatches window resize event when panel dimensions change', () => {
    let resizeCallback: (() => void) | undefined
    const disposeMock = vi.fn()
    const mockApi = {
      onDidDimensionsChange: vi.fn((cb: () => void) => {
        resizeCallback = cb
        return { dispose: disposeMock }
      }),
    }

    const resizeSpy = vi.fn()
    window.addEventListener('resize', resizeSpy)

    function TestComponent() {
      usePanelResizeHandler(mockApi)
      return <div>Test</div>
    }

    const { unmount } = render(<TestComponent />)

    expect(mockApi.onDidDimensionsChange).toHaveBeenCalled()

    // Simulate panel resize
    act(() => {
      resizeCallback?.()
    })

    expect(resizeSpy).toHaveBeenCalled()

    unmount()
    expect(disposeMock).toHaveBeenCalled()

    window.removeEventListener('resize', resizeSpy)
  })

  it('usePanelVisibility updates visibility and toggles display style without unmounting', () => {
    let visibilityCallback: ((e: { isVisible: boolean }) => void) | undefined
    const disposeMock = vi.fn()
    const mockApi = {
      isVisible: true,
      onDidVisibilityChange: vi.fn((cb: (e: { isVisible: boolean }) => void) => {
        visibilityCallback = cb
        return { dispose: disposeMock }
      }),
    }

    const resizeSpy = vi.fn()
    window.addEventListener('resize', resizeSpy)

    render(
      <WorkbenchProvider value={mockState}>
        <StagePanel api={mockApi as any} containerApi={{} as any} params={{}} />
      </WorkbenchProvider>
    )

    const stageEl = screen.getByTestId('workbench-panel-stage')
    expect(stageEl.style.display).toBe('flex')

    // Transition to inactive (hidden tab)
    act(() => {
      visibilityCallback?.({ isVisible: false })
    })

    expect(stageEl.style.display).toBe('none')

    // Transition back to active tab
    act(() => {
      visibilityCallback?.({ isVisible: true })
    })

    expect(stageEl.style.display).toBe('flex')
    expect(resizeSpy).toHaveBeenCalled()

    window.removeEventListener('resize', resizeSpy)
  })

  it('usePanelVisibility hook directly manages visibility state and triggers resize', () => {
    let visibilityCallback: ((e: { isVisible: boolean }) => void) | undefined
    const disposeMock = vi.fn()
    const mockApi = {
      isVisible: true,
      onDidVisibilityChange: vi.fn((cb: (e: { isVisible: boolean }) => void) => {
        visibilityCallback = cb
        return { dispose: disposeMock }
      }),
    }

    function HookTestComponent() {
      const isVisible = usePanelVisibility(mockApi)
      return <div data-testid="hook-probe" data-visible={String(isVisible)} />
    }

    const { unmount } = render(<HookTestComponent />)
    expect(screen.getByTestId('hook-probe').getAttribute('data-visible')).toBe('true')

    act(() => {
      visibilityCallback?.({ isVisible: false })
    })
    expect(screen.getByTestId('hook-probe').getAttribute('data-visible')).toBe('false')

    unmount()
    expect(disposeMock).toHaveBeenCalled()
  })
})
