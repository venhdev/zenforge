import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateResourceModal } from './CreateResourceModal'
import type { Project } from '../../../types/contracts'

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

describe('CreateResourceModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <CreateResourceModal
        isOpen={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        projects={mockProjects}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders modal and validates required fields', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <CreateResourceModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        projects={mockProjects}
        initialProjectSlug="zenforge"
      />
    )

    expect(screen.getByText('Create Resource Entry')).toBeDefined()

    // Submit form directly without key/title
    const form = container.querySelector('form')!
    fireEvent.submit(form)

    expect(screen.getByText('Key and Title are required')).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits form successfully when required fields are filled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <CreateResourceModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        projects={mockProjects}
        initialProjectSlug="zenforge"
      />
    )

    fireEvent.change(
      screen.getByPlaceholderText('e.g. Headless CLI Adaptor Architecture'),
      { target: { value: 'My Architecture Doc' } }
    )
    fireEvent.change(screen.getByPlaceholderText('ARCH_ADAPTOR'), {
      target: { value: 'ARCH_DOC_1' },
    })

    const submitBtn = screen.getByRole('button', { name: /Create Resource/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0].title).toBe('My Architecture Doc')
    expect(onSubmit.mock.calls[0][0].key).toBe('ARCH_DOC_1')
    expect(onSubmit.mock.calls[0][0].isNative).toBe(true)
    expect(onSubmit.mock.calls[0][0].kind).toBe('spec')
  })
})
