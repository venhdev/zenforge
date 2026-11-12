import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LiveLog } from './LiveLog'
import type { EventMessage } from '../../types/contracts'

const mockEvents: EventMessage[] = [
  {
    id: 1,
    project_slug: 'zenforge',
    plan_slug: 'docking-plan',
    task_id: 'task-101',
    entity_type: 'task',
    entity_id: 'task-101',
    type: 'task.created',
    payload: JSON.stringify({ task_id: 'task-101', status: 'READY' }),
    timestamp: '2026-11-08T12:00:00.000Z',
  },
  {
    id: 2,
    project_slug: 'zenforge',
    plan_slug: 'docking-plan',
    task_id: 'task-101',
    entity_type: 'resource',
    entity_id: 'res-42',
    type: 'resource.created',
    payload: JSON.stringify({ key: 'specs', title: 'Docking Specs' }),
    timestamp: '2026-11-08T12:05:00.000Z',
  },
]

const fetchEventsMock = vi.fn()

vi.mock('../../hooks/useZenfAPI', () => ({
  useZenfAPI: () => ({
    fetchEvents: fetchEventsMock,
  }),
}))

describe('LiveLog Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchEventsMock.mockResolvedValue({ ok: true, data: mockEvents })
  })

  describe('Compact sidebar mode', () => {
    it('renders compact sidebar layout with header and dock toggle button when onToggleDock is provided', async () => {
      render(<LiveLog tick={0} variant="sidebar" onToggleDock={vi.fn()} />)

      expect(screen.getByText('Live Log')).toBeDefined()
      const dockBtn = screen.getByTitle('Dock to Bottom')
      expect(dockBtn).toBeDefined()

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
        expect(screen.getByText(/task created/i)).toBeDefined()
        expect(screen.getByText(/resource registered/i)).toBeDefined()
      })
    })

    it('collapses and expands live log content when toggle clicked', async () => {
      render(<LiveLog tick={0} variant="sidebar" />)

      await waitFor(() => {
        expect(screen.getByText(/task created/i)).toBeDefined()
      })

      const collapseBtn = screen.getByTitle('Collapse live log')
      fireEvent.click(collapseBtn)

      expect(screen.queryByText(/task created/i)).toBeNull()
      expect(screen.getByTitle('Expand live log')).toBeDefined()

      fireEvent.click(screen.getByTitle('Expand live log'))
      expect(screen.getByText(/task created/i)).toBeDefined()
    })

    it('triggers onToggleDock callback in sidebar mode', async () => {
      const toggleSpy = vi.fn()
      render(<LiveLog tick={0} variant="sidebar" onToggleDock={toggleSpy} />)

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
      })

      const dockBtn = screen.getByTitle('Dock to Bottom')
      fireEvent.click(dockBtn)

      expect(toggleSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Drawer wide mode', () => {
    it('renders drawer layout with Live Stream and badge', async () => {
      render(<LiveLog tick={0} variant="drawer" />)

      expect(screen.getByText('Live Stream')).toBeDefined()
      expect(screen.queryByTitle('Dock to Sidebar')).toBeNull()
      expect(screen.getByTitle('Auto-scroll pinned')).toBeDefined()

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
        expect(screen.getByText('task')).toBeDefined()
        expect(screen.getByText('resource')).toBeDefined()
        expect(screen.getByText(/task created/i)).toBeDefined()
        expect(screen.getByText(/resource registered/i)).toBeDefined()
      })
    })

    it('toggles auto-scroll pin state when clicked in drawer mode', async () => {
      render(<LiveLog tick={0} variant="drawer" />)

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
      })

      const pinToggleBtn = screen.getByTitle('Auto-scroll pinned')
      expect(pinToggleBtn).toBeDefined()

      fireEvent.click(pinToggleBtn)
      expect(screen.getByTitle('Auto-scroll unpinned')).toBeDefined()

      fireEvent.click(pinToggleBtn)
      expect(screen.getByTitle('Auto-scroll pinned')).toBeDefined()
    })

    it('triggers onToggleDock callback in drawer mode', async () => {
      const toggleSpy = vi.fn()
      render(<LiveLog tick={0} variant="drawer" onToggleDock={toggleSpy} />)

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
      })

      const dockBtn = screen.getByTitle('Dock to Sidebar')
      fireEvent.click(dockBtn)

      expect(toggleSpy).toHaveBeenCalledTimes(1)
    })

    it('triggers onClose callback when close button is clicked in drawer mode', async () => {
      const closeSpy = vi.fn()
      render(<LiveLog tick={0} variant="drawer" onClose={closeSpy} />)

      await waitFor(() => {
        expect(screen.getByText('2')).toBeDefined()
      })

      const closeBtn = screen.getByTitle('Close')
      fireEvent.click(closeBtn)

      expect(closeSpy).toHaveBeenCalledTimes(1)
    })
  })
})
