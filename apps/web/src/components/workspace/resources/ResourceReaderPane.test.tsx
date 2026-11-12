import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, renderHook } from '@testing-library/react'
import { ResourceReaderPane } from './ResourceReaderPane'
import { useResourceEditor } from './useResourceEditor'
import type { Resource } from '../../../types/contracts'

const mockResource: Resource = {
  id: 'res-1',
  project_slug: 'zenforge',
  key: 'POLICY_DOC',
  slug: 'policy-doc',
  kind: 'spec',
  type: 'SPEC',
  types: ['policy', 'security'],
  format: 'markdown',
  scope: 'PROJECT',
  title: 'Policy Document',
  path: '',
  content_hash: 'h1',
  byte_size: 100,
  status: 'ACTIVE',
  summary: 'Policy summary',
  content: '# Policy\nBody',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('ResourceReaderPane Inline Tags', () => {
  it('renders tag chips with click-to-filter and quick remove', async () => {
    const handleTagClick = vi.fn()
    const handleSave = vi.fn()

    const { result: editorResult } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource, onSave: handleSave })
    )

    render(
      <ResourceReaderPane
        selectedResource={mockResource}
        loadingDetail={false}
        editor={editorResult.current}
        busy=""
        onSave={() => {}}
        onRefresh={() => {}}
        onDelete={() => {}}
        onImportFileClick={() => {}}
        onTagClick={handleTagClick}
      />
    )

    // Tag chips rendered
    const policyBtn = screen.getByText('#policy')
    expect(policyBtn).toBeDefined()

    // Clicking tag body calls onTagClick
    fireEvent.click(policyBtn)
    expect(handleTagClick).toHaveBeenCalledWith('policy')

    // Click remove on #security tag
    const removeSecurityBtn = screen.getByTitle('Remove tag #security')
    expect(removeSecurityBtn).toBeDefined()
    fireEvent.click(removeSecurityBtn)

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['policy'],
      })
    )
  })

  it('allows adding a new tag via [+ Tag] input', async () => {
    const handleSave = vi.fn()

    const { result: editorResult } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource, onSave: handleSave })
    )

    render(
      <ResourceReaderPane
        selectedResource={mockResource}
        loadingDetail={false}
        editor={editorResult.current}
        busy=""
        onSave={() => {}}
        onRefresh={() => {}}
        onDelete={() => {}}
        onImportFileClick={() => {}}
      />
    )

    // Click [+ Tag] button
    const addTagBtn = screen.getByTitle('Add a tag to this resource')
    fireEvent.click(addTagBtn)

    // Input appears
    const input = screen.getByPlaceholderText('tag...')
    fireEvent.change(input, { target: { value: 'compliance' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['policy', 'security', 'compliance'],
      })
    )
  })

  it('renders Copy Prompt button for souls', () => {
    const soulResource: Resource = {
      ...mockResource,
      kind: 'soul',
      title: 'Architect Soul',
    }
    const { result: editorResult } = renderHook(() =>
      useResourceEditor({ selectedResource: soulResource })
    )

    render(
      <ResourceReaderPane
        selectedResource={soulResource}
        loadingDetail={false}
        editor={editorResult.current}
        busy=""
        onSave={() => {}}
        onRefresh={() => {}}
        onDelete={() => {}}
        onImportFileClick={() => {}}
      />
    )

    expect(screen.getByText('Copy Prompt')).toBeDefined()
  })
})
