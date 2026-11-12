import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceTree } from './WorkspaceTree'
import type { Task, Project, Plan } from '../../types/contracts'

const mockProjects: Project[] = [
  {
    slug: 'proj-alpha',
    name: 'Project Alpha',
    status: 'ACTIVE',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

const mockPlans: Plan[] = [
  {
    slug: 'plan-one',
    project_slug: 'proj-alpha',
    title: 'Sprint 1',
    status: 'ACTIVE',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

const mockTasks: Task[] = [
  {
    id: 'task-01',
    title: 'Database Setup',
    status: 'COMPLETED',
    priority: 'P1',
    plan_slug: 'plan-one',
    dependencies: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 'task-02',
    title: 'UI Workbench',
    status: 'RUNNING',
    priority: 'P0',
    plan_slug: 'plan-one',
    dependencies: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

describe('WorkspaceTree', () => {
  it('renders projects and plans in hierarchy', () => {
    render(
      <WorkspaceTree
        projects={mockProjects}
        plans={mockPlans}
        tasks={mockTasks}
        activeProjectSlug="proj-alpha"
        activePlanSlug="plan-one"
        selectedTaskId={null}
        onSelectTask={vi.fn()}
      />
    )

    expect(screen.getByText('Project Alpha')).toBeDefined()
    expect(screen.getByText('Sprint 1')).toBeDefined()
    expect(screen.getByText('task-01')).toBeDefined()
    expect(screen.getByText('task-02')).toBeDefined()
  })

  it('filters completed tasks when hideDoneTasks is true', () => {
    const { rerender } = render(
      <WorkspaceTree
        projects={mockProjects}
        plans={mockPlans}
        tasks={mockTasks}
        activeProjectSlug="proj-alpha"
        activePlanSlug="plan-one"
        selectedTaskId={null}
        hideDoneTasks={false}
        onSelectTask={vi.fn()}
      />
    )

    expect(screen.getByText('task-01')).toBeDefined()

    rerender(
      <WorkspaceTree
        projects={mockProjects}
        plans={mockPlans}
        tasks={mockTasks}
        activeProjectSlug="proj-alpha"
        activePlanSlug="plan-one"
        selectedTaskId={null}
        hideDoneTasks={true}
        onSelectTask={vi.fn()}
      />
    )

    expect(screen.queryByText('task-01')).toBeNull()
    expect(screen.getByText('task-02')).toBeDefined()
  })

  it('handles search filtering', () => {
    render(
      <WorkspaceTree
        projects={mockProjects}
        plans={mockPlans}
        tasks={mockTasks}
        activeProjectSlug="proj-alpha"
        activePlanSlug="plan-one"
        selectedTaskId={null}
        onSelectTask={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText('Search hierarchy...')
    fireEvent.change(searchInput, { target: { value: 'Workbench' } })

    expect(screen.queryByText('Database Setup')).toBeNull()
    expect(screen.getByText('UI Workbench')).toBeDefined()
  })
})
