import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskModal } from './TaskModal'
import { PlanModal } from './PlanModal'
import { ProjectModal } from './ProjectModal'
import type { Task, Project } from '../../types/contracts'

const mockProjects: Project[] = [
  {
    slug: 'zenforge',
    name: 'ZenForge',
    root_path: '/path/zenforge',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

const mockTasks: Task[] = [
  {
    id: 'T-01',
    title: 'Prerequisite Task',
    status: 'COMPLETED',
    dependencies: [],
    created_at: '',
    updated_at: '',
  },
]

describe('CRUD Modals', () => {
  describe('ProjectModal', () => {
    it('creates project with required fields', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      render(
        <ProjectModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )

      fireEvent.change(screen.getByPlaceholderText('e.g. zenforge'), {
        target: { value: 'my-proj' },
      })
      fireEvent.change(screen.getByPlaceholderText('e.g. ZenForge Autonomous Core'), {
        target: { value: 'My Project' },
      })

      fireEvent.click(screen.getByRole('button', { name: /Create Project/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'my-proj',
          expect.objectContaining({ slug: 'my-proj', name: 'My Project' }),
          undefined
        )
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('PlanModal', () => {
    it('creates plan with target project and title', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      render(
        <PlanModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          projects={mockProjects}
          activeProjectSlug="zenforge"
        />
      )

      fireEvent.change(screen.getByPlaceholderText('e.g. plan-v0.5-release'), {
        target: { value: 'plan-release' },
      })
      fireEvent.change(screen.getByPlaceholderText('e.g. Multi-Tool Autonomous DAG Release'), {
        target: { value: 'Release Plan' },
      })

      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: 'plan-release',
            title: 'Release Plan',
            project_slug: 'zenforge',
          })
        )
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('TaskModal', () => {
    it('configures all task attributes including auto-run tool', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      render(
        <TaskModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          allTasks={mockTasks}
          activeProjectSlug="zenforge"
          activePlanSlug="plan-release"
        />
      )

      fireEvent.change(screen.getByPlaceholderText('e.g. Implement headless runner adaptor'), {
        target: { value: 'Build New Feature' },
      })

      // Toggle auto-run checkbox
      const autorunCheckbox = screen.getByRole('checkbox')
      fireEvent.click(autorunCheckbox)

      // Prerequisite selection
      const prereqCard = screen.getByText('Prerequisite Task')
      fireEvent.click(prereqCard)

      fireEvent.click(screen.getByRole('button', { name: /Create Task/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Build New Feature',
            auto_run: true,
            dependencies: ['T-01'],
          })
        )
      })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
