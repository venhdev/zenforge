import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskSpecPane } from './TaskSpecPane'
import type { Task } from '../../types/contracts'

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'STK-04',
    title: 'Compress Footer to 1-Row & End-to-End Regression Gate',
    status: 'RUNNING',
    description: `[CONTEXT]
Refactor mobile footer action bar.

[INPUT]
mobile/handmold/lib/features/movement/presentation/stockout_v2_screen.dart

[OUTPUT]
1-row ergonomic bottom action bar

[ACCEPTANCE]
100% tests pass`,
    acceptance_criteria: [
      'Khu vực đáy chỉ chiếm đúng 1 row duy nhất với chiều cao 56dp',
      'Đã xóa bỏ hoàn toàn 2 nút phụ SỨC CHỨA và XÓA PHIÊN cũ',
    ],
    verification_commands: ['cd mobile/handmold && fvm flutter test'],
    target_files: ['mobile/handmold/lib/features/movement/presentation/stockout_v2_screen.dart'],
    dependencies: ['STK-03'],
    priority: 'P1',
    complexity: 'LOW',
    risk_level: 'LOW',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('TaskSpecPane', () => {
  it('renders empty fallback when task is null', () => {
    render(<TaskSpecPane task={null} allTasks={[]} />)
    expect(screen.getByText('No task selected')).toBeDefined()
  })

  it('keeps hook order stable when a task arrives after mounting with none', () => {
    const task = createMockTask()
    const { rerender } = render(<TaskSpecPane task={null} allTasks={[]} />)
    expect(screen.getByText('No task selected')).toBeDefined()

    // Regression: a hook used to live after the `if (!task) return` branch, so
    // selecting a task from an empty inspector threw React error #310.
    expect(() =>
      rerender(<TaskSpecPane task={task} allTasks={[task]} />)
    ).not.toThrow()
    expect(screen.getByText('STK-04')).toBeDefined()
  })

  it('renders task specification with structured blocks and triage badges', () => {
    const task = createMockTask()
    const depTask: Task = {
      id: 'STK-03',
      title: 'Setup Form',
      status: 'COMPLETED',
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    render(<TaskSpecPane task={task} allTasks={[task, depTask]} />)

    expect(screen.getByText('STK-04')).toBeDefined()
    expect(screen.getByText('Compress Footer to 1-Row & End-to-End Regression Gate')).toBeDefined()
    expect(screen.getByText('Priority: P1')).toBeDefined()
    expect(screen.getByText('Complexity: LOW')).toBeDefined()
    expect(screen.getByText('Risk: LOW')).toBeDefined()
    expect(screen.getByText('Refactor mobile footer action bar.')).toBeDefined()
    expect(screen.getByText('STK-03')).toBeDefined()
  })

  it('triggers onSelectTaskId when clicking a dependency badge', () => {
    const task = createMockTask()
    const depTask: Task = {
      id: 'STK-03',
      title: 'Prerequisite',
      status: 'COMPLETED',
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const onSelectTaskId = vi.fn()

    render(
      <TaskSpecPane
        task={task}
        allTasks={[task, depTask]}
        onSelectTaskId={onSelectTaskId}
      />
    )

    const depButton = screen.getByTitle('Jump and focus on STK-03')
    fireEvent.click(depButton)

    expect(onSelectTaskId).toHaveBeenCalledTimes(1)
    expect(onSelectTaskId).toHaveBeenCalledWith('STK-03')
  })

  it('scroll container has flex containment and isolated scroll boundaries', () => {
    const task = createMockTask()
    const { container } = render(<TaskSpecPane task={task} allTasks={[task]} />)

    const scrollContainer = container.querySelector('.overflow-y-auto')
    expect(scrollContainer).toBeDefined()
    expect(scrollContainer?.className).toContain('min-h-0')
    expect(scrollContainer?.className).toContain('overscroll-contain')
    expect(scrollContainer?.className).toContain('[contain:content]')
  })

  it('renders Compiled Claim Packet and triggers preview modal', async () => {
    const task = createMockTask()
    const fetchTaskPacket = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        task_id: 'STK-04',
        prompt_markdown: '# Compiled Directive\nDo the task properly.',
        linked_resources: [],
        skill_paths: [],
        verification_commands: [],
      },
    })

    render(
      <TaskSpecPane
        task={task}
        allTasks={[task]}
        fetchTaskPacket={fetchTaskPacket}
      />
    )

    expect(screen.getByText('Compiled Claim Packet')).toBeDefined()
    const previewBtn = screen.getByText('Preview Prompt')
    expect(previewBtn).toBeDefined()
    const copyBtn = screen.getByText('Copy Prompt')
    expect(copyBtn).toBeDefined()

    fireEvent.click(previewBtn)
    expect(fetchTaskPacket).toHaveBeenCalledWith('STK-04')

    const modalTitle = await screen.findByText('STK-04 Compiled Agent Directive.md')
    expect(modalTitle).toBeDefined()
  })

  it('renders Technical Resources & Contracts when linked_resources are present in packet', async () => {
    const task = createMockTask()
    const fetchTaskPacket = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        task,
        target_files: [],
        skill_paths: [],
        verification_commands: [],
        input_attachments: [],
        prompt_markdown: '# Directive',
        linked_resources: [
          {
            id: 'res-01',
            key: 'TECH_SPEC',
            slug: 'tech-spec',
            title: 'Technical Specification',
            type: 'SPECIFICATION',
            scope: 'PLAN',
            version: 1,
            summary: 'Architecture specification for plan',
          },
        ],
      },
    })

    render(
      <TaskSpecPane
        task={task}
        allTasks={[task]}
        fetchTaskPacket={fetchTaskPacket}
      />
    )

    const sectionTitle = await screen.findByText('Technical Resources & Contracts (1)')
    expect(sectionTitle).toBeDefined()
    expect(screen.getByText('TECH_SPEC')).toBeDefined()
    expect(screen.getByText('Technical Specification')).toBeDefined()
    expect(screen.getByText('Architecture specification for plan')).toBeDefined()
    expect(screen.getByText('zenf_find')).toBeDefined()
  })

  it('renders error banner when packet fetching fails', async () => {
    const task = createMockTask()
    const fetchTaskPacket = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Daemon unreachable',
    })

    render(
      <TaskSpecPane
        task={task}
        allTasks={[task]}
        fetchTaskPacket={fetchTaskPacket}
      />
    )

    const errorBanner = await screen.findByTestId('packet-error-banner')
    expect(errorBanner).toBeDefined()
    expect(screen.getByText(/Daemon unreachable/i)).toBeDefined()
  })
})

describe('TaskSpecPane context lanes', () => {
  const contextTask = createMockTask({
    id: 'CTX-01',
    status: 'READY',
    required_docs: ['ARCH', 'SPEC'],
  })

  it('renders linked resource chips', () => {
    render(<TaskSpecPane task={contextTask} allTasks={[contextTask]} />)

    expect(screen.getByTestId('context-chip-ARCH')).toBeDefined()
    expect(screen.getByTestId('context-chip-SPEC')).toBeDefined()
  })

  it('warns when a linked resource is superseded', () => {
    render(
      <TaskSpecPane
        task={contextTask}
        allTasks={[contextTask]}
        resources={[
          {
            id: 'res-1',
            key: 'ARCH',
            slug: 'arch',
            kind: 'spec',
            type: 'ARCHITECTURE',
            scope: 'PROJECT',
            title: 'Architecture',
            path: '',
            content_hash: 'h',
            byte_size: 1,
            status: 'SUPERSEDED',
            version: 1,
            created_at: '',
            updated_at: '',
          },
        ]}
      />
    )

    const chip = screen.getByTestId('context-chip-ARCH')
    expect(chip.getAttribute('title')).toContain('SUPERSEDED')
  })

  it('unlinks a resource through the chip remove control', () => {
    const onUnlinkResource = vi.fn(async () => {})
    render(
      <TaskSpecPane task={contextTask} allTasks={[contextTask]} onUnlinkResource={onUnlinkResource} />
    )

    fireEvent.click(screen.getByTestId('context-chip-remove-ARCH'))

    expect(onUnlinkResource).toHaveBeenCalledWith('CTX-01', 'ARCH')
  })

  it('routes a dropped zenf-resource into the task context lane', () => {
    const onTaskContextDrop = vi.fn(async () => {})
    render(
      <TaskSpecPane
        task={contextTask}
        allTasks={[contextTask]}
        onTaskContextDrop={onTaskContextDrop}
      />
    )

    const zone = screen.getByTestId('task-context-dropzone')
    fireEvent.drop(zone, {
      dataTransfer: {
        types: ['application/zenf-resource'],
        getData: () => JSON.stringify({ id: 'res-9', key: 'RULES' }),
        files: [],
      },
    })

    expect(onTaskContextDrop).toHaveBeenCalledWith('CTX-01', {
      kind: 'existing',
      resourceId: 'res-9',
      resourceKey: 'RULES',
    })
  })
})
