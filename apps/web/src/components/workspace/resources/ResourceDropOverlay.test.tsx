import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResourceDropOverlay } from './ResourceDropOverlay'
import { ScopePicker } from './ScopePicker'
import type { Plan, Project, Task } from '../../../types/contracts'

const projects: Project[] = [
  { slug: 'alpha', name: 'Alpha', root_path: '/a', status: 'ACTIVE', created_at: '', updated_at: '' },
  { slug: 'beta', name: 'Beta', root_path: '/b', status: 'ACTIVE', created_at: '', updated_at: '' },
]

const plans: Plan[] = [
  { slug: 'plan-a', project_slug: 'alpha', title: 'Plan A', status: 'ACTIVE', created_at: '', updated_at: '' },
]

const tasks: Task[] = [
  {
    id: 'task-1',
    project_slug: 'alpha',
    plan_slug: 'plan-a',
    title: 'First task',
    dependencies: [],
    status: 'READY',
    created_at: '',
    updated_at: '',
  },
]

describe('ResourceDropOverlay', () => {
  const baseProps = {
    projects,
    plans,
    tasks,
    onZoneDrop: vi.fn(),
    onChooseZone: vi.fn(),
    onSelectTarget: vi.fn(),
    onCancel: vi.fn(),
    onBack: vi.fn(),
  }

  it('renders four scope zones while open', () => {
    render(<ResourceDropOverlay open pendingScope={null} {...baseProps} />)
    for (const zone of ['global', 'project', 'plan', 'task']) {
      expect(screen.getByTestId(`drop-zone-${zone}`)).toBeDefined()
    }
  })

  it('routes a drop on GLOBAL to onZoneDrop', () => {
    const onZoneDrop = vi.fn()
    render(<ResourceDropOverlay open pendingScope={null} {...baseProps} onZoneDrop={onZoneDrop} />)

    fireEvent.drop(screen.getByTestId('drop-zone-global'), { dataTransfer: { types: [], files: [] } })

    expect(onZoneDrop).toHaveBeenCalledWith('GLOBAL', expect.anything())
  })

  it('routes a drop on PROJECT to onZoneDrop so the caller can open the picker', () => {
    const onZoneDrop = vi.fn()
    render(<ResourceDropOverlay open pendingScope={null} {...baseProps} onZoneDrop={onZoneDrop} />)

    fireEvent.drop(screen.getByTestId('drop-zone-project'), { dataTransfer: { types: [], files: [] } })

    expect(onZoneDrop).toHaveBeenCalledWith('PROJECT', expect.anything())
  })

  it('renders the picker when a pending scope is set', () => {
    render(<ResourceDropOverlay open {...baseProps} pendingScope="TASK" />)

    expect(screen.getByTestId('scope-picker')).toBeDefined()
    expect(screen.queryByTestId('drop-zone-global')).toBeNull()
  })

  it('unwinds the picker on Escape before cancelling', () => {
    const onCancel = vi.fn()
    const onBack = vi.fn()
    render(<ResourceDropOverlay open {...baseProps} pendingScope="TASK" onCancel={onCancel} onBack={onBack} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onBack).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape when no picker is open', () => {
    const onCancel = vi.fn()
    render(<ResourceDropOverlay open pendingScope={null} {...baseProps} onCancel={onCancel} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })
})

describe('ScopePicker', () => {
  it('auto-fills plan and project when a task is selected', () => {
    const onSelect = vi.fn()
    render(
      <ScopePicker scope="TASK" projects={projects} plans={plans} tasks={tasks} onSelect={onSelect} onCancel={vi.fn()} />
    )

    fireEvent.click(screen.getByTestId('scope-option-task-1'))

    expect(onSelect).toHaveBeenCalledWith({ scope: 'TASK', projectSlug: 'alpha', scopeRef: 'task-1' })
  })

  it('auto-fills the project when a plan is selected', () => {
    const onSelect = vi.fn()
    render(
      <ScopePicker scope="PLAN" projects={projects} plans={plans} tasks={tasks} onSelect={onSelect} onCancel={vi.fn()} />
    )

    fireEvent.click(screen.getByTestId('scope-option-plan-a'))

    expect(onSelect).toHaveBeenCalledWith({ scope: 'PLAN', projectSlug: 'alpha', scopeRef: 'plan-a' })
  })

  it('filters candidates with type-ahead', () => {
    render(
      <ScopePicker scope="PROJECT" projects={projects} plans={plans} tasks={tasks} onSelect={vi.fn()} onCancel={vi.fn()} />
    )

    fireEvent.change(screen.getByPlaceholderText('Search projects…'), { target: { value: 'bet' } })

    expect(screen.queryByTestId('scope-option-alpha')).toBeNull()
    expect(screen.getByTestId('scope-option-beta')).toBeDefined()
  })

  it('falls back to the default project for a task without one', () => {
    const onSelect = vi.fn()
    const orphan: Task = { ...tasks[0], id: 'task-2', project_slug: undefined, plan_slug: undefined, title: 'Orphan' }
    render(
      <ScopePicker
        scope="TASK"
        projects={projects}
        plans={plans}
        tasks={[orphan]}
        defaultProjectSlug="beta"
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('scope-option-task-2'))

    expect(onSelect).toHaveBeenCalledWith({ scope: 'TASK', projectSlug: 'beta', scopeRef: 'task-2' })
  })
})
