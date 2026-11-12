import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ArtifactPreviewModal } from './ArtifactPreviewModal'
import type { Artifact } from '../../types/contracts'

describe('ArtifactPreviewModal', () => {
  const mockImageArtifact: Artifact = {
    id: 'art-img-1',
    task_id: 'task-1',
    role: 'INPUT',
    name: 'architecture-diagram.png',
    type: 'IMAGE',
    file_path: '/path/diagram.png',
    mime_type: 'image/png',
    byte_size: 40960,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    created_at: '2026-11-08T05:00:00Z',
  }

  const mockMarkdownArtifact: Artifact = {
    id: 'art-md-1',
    task_id: 'task-1',
    role: 'OUTPUT',
    name: 'scout-report.md',
    type: 'FILE',
    file_path: '/path/scout-report.md',
    mime_type: 'text/markdown',
    byte_size: 2048,
    sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    created_at: '2026-11-08T05:00:00Z',
  }

  const mockPlainTextArtifact: Artifact = {
    id: 'art-txt-1',
    task_id: 'task-1',
    role: 'OUTPUT',
    name: 'build-error.log',
    type: 'FILE',
    file_path: '/path/build-error.log',
    mime_type: 'text/plain',
    byte_size: 512,
    sha256: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
    created_at: '2026-11-08T05:00:00Z',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders image artifact correctly without fetching text', () => {
    const handleClose = vi.fn()
    render(
      <ArtifactPreviewModal
        artifact={mockImageArtifact}
        onClose={handleClose}
      />
    )

    expect(screen.getByText('architecture-diagram.png')).toBeTruthy()
    const img = screen.getByRole('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/api/v1/artifacts/art-img-1')
  })

  it('renders dual-mode toggle for markdown artifacts and allows switching to raw', async () => {
    const markdownContent = '# Scout Findings\n\n| Item | Val |\n| :--- | ---: |\n| A | 100 |\n'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => markdownContent,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const handleClose = vi.fn()
    render(
      <ArtifactPreviewModal
        artifact={mockMarkdownArtifact}
        onClose={handleClose}
      />
    )

    // Wait for markdown preview to render
    await waitFor(() => {
      expect(screen.getByText('Scout Findings')).toBeTruthy()
    })

    // Segmented toggle must exist for markdown
    const previewBtn = screen.getByRole('button', { name: /preview/i })
    const rawBtn = screen.getByRole('button', { name: /raw/i })
    expect(previewBtn).toBeTruthy()
    expect(rawBtn).toBeTruthy()

    // Switch to Raw mode
    fireEvent.click(rawBtn)
    expect(screen.getByPlaceholderText('Filter lines...')).toBeTruthy()
  })

  it('renders single-mode Raw view for plain text without showing preview toggle', async () => {
    const plainText = 'Build step 1 failed with code 127\nError: command not found\n'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => plainText,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const handleClose = vi.fn()
    render(
      <ArtifactPreviewModal
        artifact={mockPlainTextArtifact}
        onClose={handleClose}
      />
    )

    // Wait for content
    await waitFor(() => {
      expect(screen.getByText(/Build step 1 failed/)).toBeTruthy()
    })

    // Segmented toggle buttons MUST NOT exist for plain text
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull()

    // Filter input and line numbers must be immediately visible
    expect(screen.getByPlaceholderText('Filter lines...')).toBeTruthy()
  })

  it('handles close on Escape key and close button', () => {
    const handleClose = vi.fn()
    render(
      <ArtifactPreviewModal
        artifact={mockImageArtifact}
        onClose={handleClose}
      />
    )

    // Click close button
    const closeBtn = screen.getByTitle('Close (Esc)')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(2)
  })
})
