import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TaskNode, type TaskNodeData } from './TaskNode'
import { estimateNodeHeight } from './DAGCanvas'
import type { Task, TaskPriority } from '../../types/contracts'

function renderTaskNode(task: Task, overrides: Partial<TaskNodeData> = {}) {
  const onSelect = vi.fn()
  const onOpenTerminal = vi.fn()
  const data: TaskNodeData = {
    task,
    isSelected: false,
    onSelect,
    onOpenTerminal,
    ...overrides,
  }

  const result = render(
    <ReactFlowProvider>
      <TaskNode data={data} />
    </ReactFlowProvider>
  )

  return { ...result, onSelect, onOpenTerminal }
}

describe('TaskNode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders 3-tier layout: header with priority, ID, auto-run, and status', () => {
    const task: Task = {
      id: 'docking-p06-task',
      title: 'Redesign Task Card Node',
      status: 'READY',
      priority: 'P0',
      auto_run: true,
      dependencies: ['dep-1'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    renderTaskNode(task)

    // Tier 1: Priority badge (P0 is rose)
    const priorityBadge = screen.getByTestId('task-priority-badge')
    expect(priorityBadge.textContent).toBe('P0')
    expect(priorityBadge.className).toContain('text-rose-300')

    // Task ID
    expect(screen.getByText('docking-p06-task')).toBeDefined()

    // Auto-run badge
    expect(screen.getByTestId('task-autorun-badge')).toBeDefined()

    // Status badge
    expect(screen.getByTestId('task-status-badge').textContent).toBe('READY')

    // Prereq text should NOT be present (redundant with DAG arrows)
    expect(screen.queryByText(/prereq:/i)).toBeNull()
  })

  it('renders all priority badges with corresponding colors (P0 rose, P1 amber, P2 cyan, P3 zinc)', () => {
    const priorities: { prio: TaskPriority; expectedColor: string }[] = [
      { prio: 'P0', expectedColor: 'text-rose-300' },
      { prio: 'P1', expectedColor: 'text-amber-300' },
      { prio: 'P2', expectedColor: 'text-cyan-300' },
      { prio: 'P3', expectedColor: 'text-zinc-400' },
    ]

    for (const { prio, expectedColor } of priorities) {
      const task: Task = {
        id: `task-${prio}`,
        title: `Task with ${prio}`,
        status: 'PENDING',
        priority: prio,
        dependencies: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const { unmount } = renderTaskNode(task)
      const badge = screen.getByTestId('task-priority-badge')
      expect(badge.textContent).toBe(prio)
      expect(badge.className).toContain(expectedColor)
      unmount()
    }
  })

  it('handles copy task ID with 2-second visual feedback without triggering onSelect', () => {
    const task: Task = {
      id: 'copyable-task-id-1234',
      title: 'Test copy functionality',
      status: 'READY',
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { onSelect } = renderTaskNode(task)

    // Dedicated copy button
    const copyButton = screen.getByTestId('copy-task-id')
    fireEvent.click(copyButton)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copyable-task-id-1234')
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('Copied!')).toBeDefined()

    // Fast forward 2 seconds: Copied feedback reverts
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByText('Copied!')).toBeNull()

    // Clicking ID container directly also copies
    const idContainer = screen.getByTestId('task-id-container')
    fireEvent.click(idContainer)
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('Copied!')).toBeDefined()
  })

  it('renders Tier 2: line-clamp-2 title with full tooltip and scope chips', () => {
    const task: Task = {
      id: 'task-scope-chips',
      title: 'Implement Cockpit DAG Canvas Task Card Enrichment & Dynamic Spacing',
      status: 'READY',
      dependencies: [],
      target_files: ['fileA.ts', 'fileB.tsx'],
      acceptance_criteria: ['Crit 1', 'Crit 2', 'Crit 3'],
      priority: 'P1',
      complexity: 'LOW',
      risk_level: 'LOW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    renderTaskNode(task)

    // Title element
    const titleEl = screen.getByTestId('task-title')
    expect(titleEl.className).toContain('line-clamp-2')
    expect(titleEl.getAttribute('title')).toBe(task.title)

    // Scope chips
    expect(screen.getByTestId('chip-files').textContent).toContain('2 files')
    expect(screen.getByTestId('chip-files').textContent).not.toContain('📁')
    expect(screen.getByTestId('chip-criteria').textContent).toContain('3 criteria')
    expect(screen.getByTestId('chip-complexity').textContent).toBe('LOW')
    expect(screen.getByTestId('chip-risk').textContent).toBe('LOW')
    // No duplicate chip-priority in body (header priority badge is SSOT)
    expect(screen.queryByTestId('chip-priority')).toBeNull()
  })

  it('does not render status icon inside task-id-container between priority and ID', () => {
    const task: Task = {
      id: 'task-no-icon',
      title: 'Task without status icon next to ID',
      status: 'COMPLETED',
      priority: 'P2',
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    renderTaskNode(task)
    const idContainer = screen.getByTestId('task-id-container')
    expect(idContainer.querySelector('svg.lucide-check-circle-2')).toBeNull()
  })

  it('renders Tier 3: mini segmented progress indicator when phases are present', () => {
    const task: Task = {
      id: 'task-with-phases',
      title: 'Phased Execution Task',
      status: 'RUNNING',
      dependencies: [],
      phases: [
        { id: 'p1', title: 'Phase 1 - Red', status: 'COMPLETED' },
        { id: 'p2', title: 'Phase 2 - Green', status: 'IN_PROGRESS' },
        { id: 'p3', title: 'Phase 3 - Refactor', status: 'PENDING' },
      ],
      current_phase: 'p2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    renderTaskNode(task)

    const phasesContainer = screen.getByTestId('task-phases')
    expect(phasesContainer).toBeDefined()
    expect(screen.getByText('Phase 2/3')).toBeDefined()
    expect(screen.getByText('Phase 2 - Green')).toBeDefined()
  })

  it('renders Tier 3 RUNNING footer: claimed_by, assigned agent, ticker, and terminal button', () => {
    const task: Task = {
      id: 'task-running-footer',
      title: 'Actively running task',
      status: 'RUNNING',
      dependencies: [],
      claimed_by: 'subagent-coder-p06',
      agent_slug: 'coder-alpha',
      claimed_at: new Date(Date.now() - 35000).toISOString(),
      claim_session_id: 'sess-abc12345',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { onOpenTerminal, onSelect } = renderTaskNode(task)

    expect(screen.getByText('subagent-coder-p06')).toBeDefined()
    expect(screen.getByText('for coder-alpha')).toBeDefined()
    expect(screen.getByText(/35s/)).toBeDefined()

    const termBtn = screen.getByTestId('terminal-session-btn')
    expect(termBtn.textContent).toContain('Terminal (sess-a)')

    fireEvent.click(termBtn)
    expect(onOpenTerminal).toHaveBeenCalledWith(task)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders Tier 3 COMPLETED footer: ✓ by claimed_by and elapsed duration', () => {
    const claimedAt = new Date(Date.now() - 45000).toISOString()
    const updatedAt = new Date(Date.now()).toISOString()
    const task: Task = {
      id: 'task-completed-footer',
      title: 'Completed task verification',
      status: 'COMPLETED',
      dependencies: [],
      claimed_by: 'subagent-coder-p06',
      claimed_at: claimedAt,
      updated_at: updatedAt,
      created_at: claimedAt,
    }

    renderTaskNode(task)

    expect(screen.getByText('✓ by subagent-coder-p06')).toBeDefined()
    expect(screen.getByText('45s')).toBeDefined()
  })

  it('renders Tier 3 AWAITING_REVIEW alert box with review_reason', () => {
    const task: Task = {
      id: 'task-review-footer',
      title: 'Needs human review',
      status: 'AWAITING_REVIEW',
      dependencies: [],
      review_reason: 'Architectural schema drift detected in table specs',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    renderTaskNode(task)

    const alertBox = screen.getByTestId('task-review-alert')
    expect(alertBox).toBeDefined()
    expect(screen.getByText('Review Required')).toBeDefined()
    expect(screen.getByText('Architectural schema drift detected in table specs')).toBeDefined()
  })

})

describe('DAGCanvas estimateNodeHeight', () => {
  it('calculates base height of 88 for minimal task', () => {
    const task: Task = {
      id: 't1',
      title: 'Base task',
      status: 'CANCELLED',
      dependencies: [],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(task)).toBe(88)
  })

  it('adds +22 for scope chips', () => {
    const taskWithFiles: Task = {
      id: 't2',
      title: 'Task with files',
      status: 'CANCELLED',
      dependencies: [],
      target_files: ['src/App.tsx'],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(taskWithFiles)).toBe(88 + 22)

    const taskWithComplexity: Task = {
      id: 't3',
      title: 'Task with complexity',
      status: 'CANCELLED',
      dependencies: [],
      complexity: 'MEDIUM',
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(taskWithComplexity)).toBe(88 + 22)

    const taskWithChips: Task = {
      id: 't3-chips',
      title: 'Task with chips fitting on 1 row',
      status: 'CANCELLED',
      dependencies: [],
      target_files: ['file1.ts'],
      complexity: 'MEDIUM',
      risk_level: 'LOW',
      created_at: '',
      updated_at: '',
    }
    // Up to 4 chips fit on single row (+22)
    expect(estimateNodeHeight(taskWithChips)).toBe(88 + 22)
  })

  it('adds +24 for phases', () => {
    const taskWithPhases: Task = {
      id: 't4',
      title: 'Task with phases',
      status: 'CANCELLED',
      dependencies: [],
      phases: [{ id: 'p1', title: 'Phase 1', status: 'PENDING' }],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(taskWithPhases)).toBe(88 + 24)
  })

  it('adds status footer offsets correctly', () => {
    const runningTask: Task = {
      id: 'r1',
      title: 'Running',
      status: 'RUNNING',
      dependencies: [],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(runningTask)).toBe(88 + 46)

    const completedTask: Task = {
      id: 'c1',
      title: 'Completed',
      status: 'COMPLETED',
      dependencies: [],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(completedTask)).toBe(88 + 26)

    const reviewTask: Task = {
      id: 'rev1',
      title: 'Review',
      status: 'AWAITING_REVIEW',
      dependencies: [],
      created_at: '',
      updated_at: '',
    }
    expect(estimateNodeHeight(reviewTask)).toBe(88 + 42)

  })

  it('correctly aggregates combined heights', () => {
    const fullRunningTask: Task = {
      id: 'full1',
      title: 'Full Running Task',
      status: 'RUNNING',
      dependencies: [],
      target_files: ['file1.ts'],
      complexity: 'HIGH',
      phases: [{ id: 'p1', title: 'Phase 1', status: 'IN_PROGRESS' }],
      created_at: '',
      updated_at: '',
    }
    // 88 (base) + 22 (scope) + 24 (phases) + 46 (RUNNING) = 180
    expect(estimateNodeHeight(fullRunningTask)).toBe(88 + 22 + 24 + 46)
  })

  it('renders linked resources chip when task has required_docs', () => {
    const task: Task = {
      id: 'doc-task-1',
      title: 'Task with Docs',
      status: 'READY',
      dependencies: [],
      required_docs: ['SPEC_AUTH', 'ARCH_DOC'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    renderTaskNode(task)
    const chip = screen.getByTestId('chip-docs')
    expect(chip.textContent).toContain('2 docs')
  })

  it('handles drag over, drop, and invokes onAttachResource with dropped resource key', () => {
    const onAttachResource = vi.fn()
    const task: Task = {
      id: 'target-task-drop',
      title: 'Drop Target Task',
      status: 'READY',
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    renderTaskNode(task, { onAttachResource })
    const node = screen.getByTestId('task-node-target-task-drop')

    // Drag over with zenf resource type
    fireEvent.dragOver(node, {
      dataTransfer: {
        types: ['application/zenf-resource'],
        dropEffect: 'none',
      },
    })

    expect(screen.getByTestId('drop-overlay')).toBeDefined()
    expect(screen.getByText('+ Attach Resource')).toBeDefined()

    // Drop
    fireEvent.drop(node, {
      dataTransfer: {
        getData: (type: string) => {
          if (type === 'application/zenf-resource') {
            return JSON.stringify({ key: 'RULES_DOC', id: 'res-1' })
          }
          return ''
        },
      },
    })

    expect(onAttachResource).toHaveBeenCalledTimes(1)
    expect(onAttachResource).toHaveBeenCalledWith('target-task-drop', 'RULES_DOC')
  })
})
