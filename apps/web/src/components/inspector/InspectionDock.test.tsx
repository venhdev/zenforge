import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InspectionDock } from './InspectionDock'
import type { Task } from '../../types/contracts'

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-101',
    title: 'Design 2-Tab Inspector Dock',
    status: 'READY',
    dependencies: [],
    priority: 'P1',
    complexity: 'LOW',
    risk_level: 'LOW',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('InspectionDock', () => {
  it('strictly renders 2 semantic tabs: Input & Spec and Output & Artifacts', () => {
    const task = createMockTask()
    render(
      <InspectionDock
        selectedTask={task}
        allTasks={[task]}
        artifacts={[]}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    // Verify exactly 2 tab buttons exist
    expect(screen.getByRole('button', { name: /Input & Spec/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Output & Artifacts/i })).toBeDefined()

    // Assert obsolete tabs are completely gone
    expect(screen.queryByRole('button', { name: /^Spec$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Execution & Trace/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Claim Packet/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Terminal >_/i })).toBeNull()
  })

  it('defaults to Input & Spec for READY tasks and switches to Output & Artifacts on click', () => {
    const task = createMockTask({ status: 'READY' })
    render(
      <InspectionDock
        selectedTask={task}
        allTasks={[task]}
        artifacts={[]}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    // Input tab active initially -> Spec Hub is visible
    expect(screen.getByText('Task Specification Hub')).toBeDefined()

    // Click Output & Artifacts tab
    const outputTab = screen.getByRole('button', { name: /Output & Artifacts/i })
    fireEvent.click(outputTab)

    // In READY state, Output pane renders Waiting for Dispatch
    expect(screen.getByText('Waiting for Dispatch')).toBeDefined()
  })

  it('adaptively defaults to Output & Artifacts when selected task is RUNNING', () => {
    const task = createMockTask({ status: 'RUNNING', auto_run: true, claim_session_id: 'session-xyz' })
    render(
      <InspectionDock
        selectedTask={task}
        allTasks={[task]}
        artifacts={[]}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    // Output tab should be active by default for running task
    expect(screen.getByText('Live Daemon Console')).toBeDefined()
    expect(screen.getByText('In-Flight Daemon Process Stream')).toBeDefined()
  })

  it('preserves user-selected tab (Input & Spec) when switching to a COMPLETED task', () => {
    const taskReady = createMockTask({ id: 'TASK-1', status: 'READY' })
    const taskCompleted = createMockTask({ id: 'TASK-2', status: 'COMPLETED' })

    const { rerender } = render(
      <InspectionDock
        selectedTask={taskReady}
        allTasks={[taskReady, taskCompleted]}
        artifacts={[]}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    // User is on Input & Spec
    expect(screen.getByText('Task Specification Hub')).toBeDefined()

    // Caller switches to COMPLETED task
    rerender(
      <InspectionDock
        selectedTask={taskCompleted}
        allTasks={[taskReady, taskCompleted]}
        artifacts={[]}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    // Tab must NOT hijack to Output; it stays on Input & Spec!
    expect(screen.getByText('Task Specification Hub')).toBeDefined()
  })
})
