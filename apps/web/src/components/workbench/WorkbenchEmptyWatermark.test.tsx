import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkbenchEmptyWatermark } from './WorkbenchEmptyWatermark'
import { WorkbenchProvider, defaultWorkbenchState } from './panelRegistry'

function fullDockApi(overrides: Record<string, any> = {}) {
  return {
    clear: vi.fn(),
    addPanel: vi.fn(),
    getPanel: vi.fn().mockReturnValue(null),
    totalPanels: 0,
    ...overrides,
  } as any
}

describe('WorkbenchEmptyWatermark', () => {
  it('renders the full empty-dock state with restore button and quick view buttons', () => {
    render(<WorkbenchEmptyWatermark containerApi={fullDockApi()} />)

    expect(screen.getByTestId('workbench-empty-watermark')).toBeDefined()
    expect(screen.getByText('All Panels Closed')).toBeDefined()
    expect(screen.getByText('Restore Default Layout')).toBeDefined()
  })

  it('clicking Restore Default Layout falls back to rebuilding the default layout', () => {
    const api = fullDockApi({ addPanel: vi.fn().mockReturnValue({ api: { setSize: vi.fn() } }) })
    render(<WorkbenchEmptyWatermark containerApi={api} />)

    fireEvent.click(screen.getByText('Restore Default Layout'))

    expect(api.clear).toHaveBeenCalledTimes(1)
    expect(api.addPanel).toHaveBeenCalled()
  })

  it('prefers the workbench reset callback so enabled state is reset too', () => {
    const onResetWorkbenchLayout = vi.fn()
    const api = fullDockApi()

    render(
      <WorkbenchProvider value={{ ...defaultWorkbenchState, onResetWorkbenchLayout }}>
        <WorkbenchEmptyWatermark containerApi={api} />
      </WorkbenchProvider>
    )

    fireEvent.click(screen.getByText('Restore Default Layout'))

    expect(onResetWorkbenchLayout).toHaveBeenCalledTimes(1)
    expect(api.clear).not.toHaveBeenCalled()
  })

  it('renders a compact placeholder for an empty zone and reopens into that group', () => {
    const api = fullDockApi({ totalPanels: 4 })
    const group = { id: 'group-left-top' } as any

    render(
      <WorkbenchProvider
        value={{
          ...defaultWorkbenchState,
          enabledViews: ['explorer'],
          homeViewsForGroup: () => ['explorer'],
        }}
      >
        <WorkbenchEmptyWatermark containerApi={api} group={group} />
      </WorkbenchProvider>
    )

    expect(screen.getByTestId('workbench-empty-zone')).toBeDefined()
    expect(screen.getByText('View hidden')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Hierarchy/i }))
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'explorer',
        component: 'explorer',
        title: 'Hierarchy',
        position: { referenceGroup: 'group-left-top' },
      })
    )
  })

  it('does not offer chips for views disabled in the Panels menu', () => {
    const api = fullDockApi({ totalPanels: 4 })

    render(
      <WorkbenchProvider
        value={{
          ...defaultWorkbenchState,
          enabledViews: [],
          homeViewsForGroup: () => ['explorer'],
        }}
      >
        <WorkbenchEmptyWatermark containerApi={api} group={{ id: 'group-left-top' } as any} />
      </WorkbenchProvider>
    )

    expect(screen.queryByRole('button', { name: /Hierarchy/i })).toBeNull()
  })

  it('clicking a reopen chip in the empty dock opens that specific panel', () => {
    const api = fullDockApi()
    render(<WorkbenchEmptyWatermark containerApi={api} />)

    fireEvent.click(screen.getByRole('button', { name: /Stage/i }))

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stage',
        component: 'stage',
        title: 'Stage',
        renderer: 'always',
      })
    )
  })
})
