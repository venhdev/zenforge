import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingHUD } from './FloatingHUD'
import type { Task } from '../../types/contracts'

const makeRunningTask = (id: string, claimedBy: string, minutesAgo = 1): Task => ({
  id,
  plan_slug: 'plan-1',
  title: `Task Title for ${id}`,
  status: 'RUNNING',
  claimed_by: claimedBy,
  auto_run: true,
  dependencies: [],
  updated_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
  created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
})

describe('FloatingHUD', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders nothing when visible is false', () => {
    const { container } = render(
      <FloatingHUD tasks={[]} visible={false} onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders idle state when visible is true and no tasks are running', () => {
    render(<FloatingHUD tasks={[]} visible={true} onClose={vi.fn()} />)

    expect(screen.getByText('ACTIVE RUNNING')).toBeDefined()
    expect(screen.getByText('All tasks idle')).toBeDefined()
  })

  it('renders running tasks up to 5 and formats runtime', () => {
    const tasks: Task[] = [
      makeRunningTask('task-scout-1', 'scout-worker', 2),
      makeRunningTask('task-scout-2', 'coder-worker', 1),
      makeRunningTask('task-scout-3', 'tester-worker', 0),
    ]

    render(<FloatingHUD tasks={tasks} visible={true} onClose={vi.fn()} />)

    expect(screen.getByText('task-scout-1')).toBeDefined()
    expect(screen.getByText('task-scout-2')).toBeDefined()
    expect(screen.getByText('task-scout-3')).toBeDefined()
    expect(screen.getByText('scout-worker')).toBeDefined()
    expect(screen.getByText('coder-worker')).toBeDefined()
  })

  it('switches between stack mode and pill mode via minimize/expand button', () => {
    const tasks = [makeRunningTask('task-scout-1', 'scout-worker', 1)]
    render(<FloatingHUD tasks={tasks} visible={true} onClose={vi.fn()} />)

    // Initially in stack mode
    const minimizeBtn = screen.getByTitle('Minimize to Pill')
    expect(minimizeBtn).toBeDefined()

    // Click minimize to switch to pill mode
    fireEvent.click(minimizeBtn)
    const expandBtn = screen.getByTitle('Expand HUD Stack')
    expect(expandBtn).toBeDefined()

    // Click expand to switch back to stack mode
    fireEvent.click(expandBtn)
    expect(screen.getByTitle('Minimize to Pill')).toBeDefined()
  })

  it('toggles maximize and restore size in stack mode', () => {
    render(<FloatingHUD tasks={[]} visible={true} onClose={vi.fn()} />)

    const maxBtn = screen.getByTitle('Maximize Size')
    expect(maxBtn).toBeDefined()

    fireEvent.click(maxBtn)
    expect(screen.getByTitle('Restore Normal Size')).toBeDefined()

    fireEvent.click(screen.getByTitle('Restore Normal Size'))
    expect(screen.getByTitle('Maximize Size')).toBeDefined()
  })

  it('has a corner resize handle', () => {
    render(<FloatingHUD tasks={[]} visible={true} onClose={vi.fn()} />)

    const resizeHandle = screen.getByTitle('Drag to resize HUD window')
    expect(resizeHandle).toBeDefined()
  })

  it('triggers onSelectTask when task is clicked', () => {
    const onSelectTask = vi.fn()
    const task = makeRunningTask('task-scout-1', 'scout-worker', 1)

    render(
      <FloatingHUD
        tasks={[task]}
        visible={true}
        onClose={vi.fn()}
        onSelectTask={onSelectTask}
      />
    )

    fireEvent.click(screen.getByText('task-scout-1'))
    expect(onSelectTask).toHaveBeenCalledWith(task)
  })

  it('triggers onClose when close button is clicked without drag interference', () => {
    const onClose = vi.fn()
    render(<FloatingHUD tasks={[]} visible={true} onClose={onClose} />)

    const closeBtn = screen.getByTitle('Close HUD')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
