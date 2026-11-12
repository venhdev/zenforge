import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskOutputPane } from './TaskOutputPane'
import type { Task, Artifact } from '../../types/contracts'

describe('TaskOutputPane', () => {
  const baseTask: Task = {
    id: 'task-1',
    project_slug: 'zenforge',
    plan_slug: 'test-plan',
    title: 'Test Task Title',
    status: 'READY',
    priority: 'P1',
    complexity: 'MEDIUM',
    risk_level: 'LOW',
    auto_run: true,
    dependencies: [],
    created_at: '2026-11-08T05:00:00Z',
    updated_at: '2026-11-08T05:00:00Z',
  }

  const mockArtifact: Artifact = {
    id: 'art-1',
    task_id: 'task-1',
    role: 'OUTPUT',
    name: 'execution-summary.md',
    type: 'FILE',
    file_path: '/path/execution-summary.md',
    mime_type: 'text/markdown',
    byte_size: 1024,
    sha256: 'abc123456789',
    created_at: '2026-11-08T05:00:00Z',
  }

  it('renders waiting for dispatch empty state when READY or PENDING', () => {
    render(<TaskOutputPane task={baseTask} />)
    expect(screen.getByText('Waiting for Dispatch')).toBeTruthy()
  })

  it('renders live daemon process stream when RUNNING with auto_run session', () => {
    const runningTask: Task = {
      ...baseTask,
      status: 'RUNNING',
      auto_run: true,
      claimed_by: 'scout-bot',
      claim_session_id: 'sess-worker-123',
    }
    render(<TaskOutputPane task={runningTask} />)

    expect(screen.getByText('Live Daemon Console')).toBeTruthy()
    expect(screen.getByText(/STREAMING LIVE/)).toBeTruthy()
    expect(screen.getAllByText(/scout-bot/).length).toBeGreaterThan(0)
    expect(screen.getByText('Open Live Terminal ↗')).toBeTruthy()
  })

  it('renders external agent tracking card when RUNNING via external client (auto_run false or no session)', () => {
    const externalTask: Task = {
      ...baseTask,
      status: 'RUNNING',
      auto_run: false,
      claimed_by: 'antigravity-agent',
      current_phase: 'P01-Core-Logic',
    }
    render(<TaskOutputPane task={externalTask} />)

    expect(screen.getByText('External Agent In-Flight')).toBeTruthy()
    expect(screen.getByText(/LIVE TRACKING/)).toBeTruthy()
    expect(screen.getAllByText(/antigravity-agent/).length).toBeGreaterThan(0)
    expect(screen.getByText('P01-Core-Logic')).toBeTruthy()
    expect(screen.queryByText('Live Daemon Console')).toBeNull()
    expect(screen.queryByText('Open Live Terminal ↗')).toBeNull()
  })

  it('renders architectural review request when AWAITING_REVIEW', () => {
    const reviewTask: Task = {
      ...baseTask,
      status: 'AWAITING_REVIEW',
      review_reason: 'Sandbox egress threshold exceeded',
      review_details: 'Agent tried to access external IP',
      review_options: ['Approve egress', 'Deny and kill task'],
    }
    render(<TaskOutputPane task={reviewTask} />)

    expect(screen.getByText('Architectural Review Requested')).toBeTruthy()
    expect(screen.getByText(/Sandbox egress threshold/)).toBeTruthy()
    expect(screen.getByText(/Approve egress/)).toBeTruthy()
  })

  it('renders execution summary and non-duplicate artifacts when COMPLETED', () => {
    const completedTask: Task = {
      ...baseTask,
      status: 'COMPLETED',
      notes: '# Execution Finished\nAll tests passed.',
    }
    render(<TaskOutputPane task={completedTask} artifacts={[mockArtifact]} />)

    expect(screen.getByText('Execution Summary')).toBeTruthy()
    expect(screen.getByText('Expand Modal')).toBeTruthy()
    expect(screen.getByText(/Generated Artifacts/)).toBeTruthy()
    expect(screen.getByText('execution-summary.md')).toBeTruthy()
  })

  it('de-duplicates raw execution log when task.notes is already present', () => {
    const logArtifact: Artifact = {
      id: 'art-log-1',
      task_id: 'task-1',
      role: 'OUTPUT',
      name: 'scout-headless-agy Execution Log',
      type: 'FILE',
      file_path: '/path/scout.log',
      mime_type: 'text/plain',
      byte_size: 12800,
      sha256: 'xyz',
      created_at: '2026-11-08T05:00:00Z',
    }

    const completedTask: Task = {
      ...baseTask,
      status: 'COMPLETED',
      notes: '# Scout Report\nHeadless capabilities verified.',
    }

    render(<TaskOutputPane task={completedTask} artifacts={[logArtifact]} />)

    // Summary should be visible with log download link in header
    expect(screen.getByText('Execution Summary')).toBeTruthy()
    expect(screen.getByText(/Log \(12.5 KB\)/)).toBeTruthy()
    expect(screen.getByText('Expand Modal')).toBeTruthy()

    // Redundant Generated Artifacts section should be omitted
    expect(screen.queryByText(/Generated Artifacts/)).toBeNull()
    expect(screen.queryByText('View report ↗')).toBeNull()
  })

  it('renders zero output state when COMPLETED with no notes and no artifacts', () => {
    const completedTask: Task = {
      ...baseTask,
      status: 'COMPLETED',
      notes: undefined,
    }

    render(<TaskOutputPane task={completedTask} artifacts={[]} />)

    expect(screen.getByText('Task Completed')).toBeTruthy()
    expect(screen.getByText(/No artifacts or execution logs were generated/)).toBeTruthy()
  })
})
