import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActivityBar } from './ActivityBar'

describe('ActivityBar', () => {
  it('renders all 4 standardized workbench view icons', () => {
    const onSelect = vi.fn()
    render(<ActivityBar currentView="dag" onSelectView={onSelect} />)

    expect(screen.getByLabelText('Hierarchy')).toBeDefined()
    expect(screen.getByLabelText('Resources')).toBeDefined()
    expect(screen.getByLabelText('Harness')).toBeDefined()
    expect(screen.getByLabelText('Activity')).toBeDefined()
  })

  it('removes disabled views from the rail, keeping hidden-but-enabled ones', () => {
    render(
      <ActivityBar
        enabledViews={['explorer', 'harness']}
        openPanels={{ explorer: true, resources: false, harness: false, console: false }}
        activePanels={{ explorer: true, resources: false, harness: false, console: false }}
      />
    )

    // Enabled => present. Hierarchy is open; Harness is enabled but closed.
    expect(screen.getByLabelText('Hierarchy')).toBeDefined()
    expect(screen.getByLabelText('Harness')).toBeDefined()
    // Disabled => absent from the rail even though the panel state says closed.
    expect(screen.queryByLabelText('Resources')).toBeNull()
    expect(screen.queryByLabelText('Activity')).toBeNull()
  })

  it('dims enabled views that are currently hidden', () => {
    render(
      <ActivityBar
        enabledViews={['explorer', 'harness']}
        openPanels={{ explorer: true, harness: false }}
        activePanels={{ explorer: true, harness: false }}
      />
    )

    expect(screen.getByLabelText('Hierarchy').className).toContain('text-cyan-400')
    expect(screen.getByLabelText('Harness').className).toContain('text-zinc-600')
    expect(screen.getByLabelText('Harness').getAttribute('aria-pressed')).toBe('false')
  })

  it('triggers onFocusOrOpenPanel with shiftKey state when an item is clicked', () => {
    const onFocusOrOpenToggle = vi.fn()
    render(
      <ActivityBar
        onFocusOrOpenPanel={onFocusOrOpenToggle}
        openPanels={{ explorer: true, resources: true, harness: true, console: true }}
        activePanels={{ explorer: true, resources: false, harness: false, console: true }}
      />
    )

    fireEvent.click(screen.getByLabelText('Resources'))
    expect(onFocusOrOpenToggle).toHaveBeenCalledWith('resources', false)

    fireEvent.click(screen.getByLabelText('Harness'), { shiftKey: true })
    expect(onFocusOrOpenToggle).toHaveBeenCalledWith('harness', true)
  })

  it('displays badge counts when provided', () => {
    render(
      <ActivityBar
        currentView="dag"
        onSelectView={vi.fn()}
        resourcesCount={12}
      />
    )

    expect(screen.getByText('12')).toBeDefined()
  })
})
