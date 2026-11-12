import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResourceEditor } from './useResourceEditor'
import type { Resource } from '../../../types/contracts'

const mockResource: Resource = {
  id: 'res-1',
  project_slug: 'zenforge',
  key: 'TEST_KEY',
  slug: 'test-key',
  kind: 'spec',
  type: 'SPEC',
  types: ['spec', 'design'],
  format: 'markdown',
  scope: 'PROJECT',
  title: 'Test Title',
  path: '',
  content_hash: 'h1',
  byte_size: 100,
  status: 'ACTIVE',
  summary: 'A short summary',
  content: '# Hello World\nSome content',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('useResourceEditor', () => {
  it('initializes from selectedResource', () => {
    const { result } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource })
    )

    expect(result.current.editorContent).toBe('# Hello World\nSome content')
    expect(result.current.editorMetadata.title).toBe('Test Title')
    expect(result.current.editorMetadata.summary).toBe('A short summary')
    expect(result.current.editorMetadata.types).toEqual(['spec', 'design'])
    expect(result.current.isDirty).toBe(false)
    expect(result.current.readerViewMode).toBe('preview')
  })

  it('marks isDirty when editor content changes', () => {
    const { result } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource })
    )

    act(() => {
      result.current.setEditorContent('Updated content')
      result.current.setIsDirty(true)
    })

    expect(result.current.editorContent).toBe('Updated content')
    expect(result.current.isDirty).toBe(true)
  })

  it('discards changes and restores original resource values', () => {
    const { result } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource })
    )

    act(() => {
      result.current.setEditorContent('Dirty text')
      result.current.updateEditorMetadata({ title: 'New Dirty Title' })
    })

    expect(result.current.isDirty).toBe(true)
    expect(result.current.editorContent).toBe('Dirty text')
    expect(result.current.editorMetadata.title).toBe('New Dirty Title')

    act(() => {
      result.current.handleDiscardSource()
    })

    expect(result.current.isDirty).toBe(false)
    expect(result.current.editorContent).toBe('# Hello World\nSome content')
    expect(result.current.editorMetadata.title).toBe('Test Title')
  })

  it('manages copied key state and cleans up', async () => {
    const { result } = renderHook(() =>
      useResourceEditor({ selectedResource: mockResource })
    )

    await act(async () => {
      await result.current.handleCopy('text-to-copy', 'TEST_LABEL')
    })

    expect(result.current.copiedKey).toBe('TEST_LABEL')
  })
})
