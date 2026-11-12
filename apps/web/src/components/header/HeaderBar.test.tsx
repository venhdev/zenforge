import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeaderBar } from './HeaderBar'
import type { Project, Plan } from '../../types/contracts'

const mockProject: Project = {
  slug: 'zenforge',
  name: 'ZenForge',
  description: 'Test project',
  status: 'ACTIVE',
  created_at: '2026-11-08T00:00:00Z',
  updated_at: '2026-11-08T00:00:00Z',
}

const mockPlan: Plan = {
  slug: 'test-plan',
  title: 'Test Plan',
  status: 'ACTIVE',
  project_slug: 'zenforge',
  created_at: '2026-11-08T00:00:00Z',
  updated_at: '2026-11-08T00:00:00Z',
}

describe('HeaderBar', () => {
  it('renders branding, project, and plan selectors', () => {
    render(
      <HeaderBar
        connected={true}
        projects={[mockProject]}
        activeProject={mockProject}
        onSelectProject={vi.fn()}
        plans={[mockPlan]}
        activePlan={mockPlan}
        onSelectPlan={vi.fn()}
        showArchived={false}
        onToggleArchived={vi.fn()}
        activeWorkers={0}
      />
    )

    expect(screen.getAllByText('ZenForge').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('ZenForge')).toBeDefined()
    expect(screen.getByDisplayValue('Test Plan')).toBeDefined()
  })

  it('renders plan version badge and selector label when plan has version', () => {
    const planWithVersion: Plan = {
      ...mockPlan,
      version: 2,
    }

    render(
      <HeaderBar
        connected={true}
        projects={[mockProject]}
        activeProject={mockProject}
        onSelectProject={vi.fn()}
        plans={[planWithVersion]}
        activePlan={planWithVersion}
        onSelectPlan={vi.fn()}
        showArchived={false}
        onToggleArchived={vi.fn()}
        activeWorkers={0}
      />
    )

    expect(screen.getByDisplayValue('Test Plan (v2)')).toBeDefined()
    expect(screen.getByText('ACTIVE · v2')).toBeDefined()
  })

  it('toggles Panels menu and triggers onOpenWorkbenchPanel and onResetWorkbenchLayout', () => {
    const handleOpenPanel = vi.fn()
    const handleResetLayout = vi.fn()

    render(
      <HeaderBar
        connected={true}
        projects={[mockProject]}
        activeProject={mockProject}
        onSelectProject={vi.fn()}
        plans={[mockPlan]}
        activePlan={mockPlan}
        onSelectPlan={vi.fn()}
        showArchived={false}
        onToggleArchived={vi.fn()}
        activeWorkers={0}
        onOpenWorkbenchPanel={handleOpenPanel}
        onResetWorkbenchLayout={handleResetLayout}
      />
    )

    const panelsButton = screen.getByRole('button', { name: /Panels/i })
    expect(panelsButton).toBeDefined()

    // Open panels dropdown
    fireEvent.click(panelsButton)
    expect(screen.getByText('Workbench Panels')).toBeDefined()

    // Click Task Explorer (dropdown remains open)
    const explorerOption = screen.getByText('Task Explorer')
    fireEvent.click(explorerOption)
    expect(handleOpenPanel).toHaveBeenCalledWith('explorer')

    // Click Reset Layout directly (dropdown was kept open)
    const resetOption = screen.getByText('Reset Layout')
    fireEvent.click(resetOption)
    expect(handleResetLayout).toHaveBeenCalledTimes(1)
  })

  it('toggles Task Inspector inside Panels menu and supports Floating HUD toggle', () => {
    const handleTogglePanel = vi.fn()
    const handleToggleHud = vi.fn()

    render(
      <HeaderBar
        connected={true}
        projects={[mockProject]}
        activeProject={mockProject}
        onSelectProject={vi.fn()}
        plans={[mockPlan]}
        activePlan={mockPlan}
        onSelectPlan={vi.fn()}
        showArchived={false}
        onToggleArchived={vi.fn()}
        activeWorkers={0}
        onToggleWorkbenchPanel={handleTogglePanel}
        onToggleHud={handleToggleHud}
        hudVisible={false}
        isInspectorOpen={true}
      />
    )

    const panelsButton = screen.getByRole('button', { name: /Panels/i })
    fireEvent.click(panelsButton)

    // Toggle Inspector inside dropdown
    const inspectorButton = screen.getByRole('button', { name: /Task Inspector/i })
    expect(inspectorButton).toBeDefined()
    fireEvent.click(inspectorButton)
    expect(handleTogglePanel).toHaveBeenCalledWith('inspector')

    // Toggle Floating HUD inside dropdown
    const hudOption = screen.getByRole('button', { name: /Floating HUD/i })
    expect(hudOption).toBeDefined()
    fireEvent.click(hudOption)
    expect(handleToggleHud).toHaveBeenCalledTimes(1)
  })

  it('reflects enabled views rather than open state in the Panels menu', () => {
    const handleTogglePanel = vi.fn()

    render(
      <HeaderBar
        connected={true}
        projects={[mockProject]}
        activeProject={mockProject}
        onSelectProject={vi.fn()}
        plans={[mockPlan]}
        activePlan={mockPlan}
        onSelectPlan={vi.fn()}
        showArchived={false}
        onToggleArchived={vi.fn()}
        activeWorkers={0}
        onToggleWorkbenchPanel={handleTogglePanel}
        enabledPanels={{ explorer: false, resources: true, harness: true, console: true, stage: true, inspector: false }}
        isInspectorOpen={false}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Panels/i }))

    const explorerRow = screen.getByRole('button', { name: /Task Explorer/i })
    const resourcesRow = screen.getByRole('button', { name: /^Resources/i })
    expect(explorerRow.textContent).toContain('OFF')
    expect(resourcesRow.textContent).toContain('ON')

    fireEvent.click(explorerRow)
    expect(handleTogglePanel).toHaveBeenCalledWith('explorer')
  })

})
