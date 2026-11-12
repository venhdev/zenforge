import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchResourceInspector } from './WorkbenchResourceInspector'
import type { Resource } from '../../../types/contracts'

const resource: Resource = {
  id: 'res-1',
  project_slug: 'zenforge',
  key: 'ARCH',
  slug: 'arch',
  kind: 'spec',
  type: 'ARCHITECTURE',
  types: ['architecture'],
  format: 'markdown',
  scope: 'PROJECT',
  title: 'Architecture',
  path: '',
  content_hash: 'h',
  byte_size: 10,
  status: 'ACTIVE',
  summary: '',
  content: '# Architecture',
  version: 1,
  created_at: '',
  updated_at: '',
}

function stubFetch(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const key = `${init?.method || 'GET'} ${url}`
    const handler = routes[key] || routes[url]
    if (!handler) return new Response('not found', { status: 404 })
    return handler()
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkbenchResourceInspector attached files', () => {
  it('lists files owned by the resource', async () => {
    stubFetch({
      'GET /api/v1/resources/res-1?format=blocks': () =>
        new Response(JSON.stringify(resource), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      'GET /api/v1/resources/res-1/files': () =>
        new Response(
          JSON.stringify({
            files: [
              { id: 'art-1', resource_id: 'res-1', name: 'diagram.png', type: 'IMAGE', mime_type: 'image/png', byte_size: 2048, sha256: 'x', file_path: '/x', created_at: '' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    })

    render(<WorkbenchResourceInspector resource={resource} />)

    await waitFor(() => expect(screen.getByTestId('resource-file-art-1')).toBeDefined())
    expect(screen.getByText('diagram.png')).toBeDefined()
  })

  it('deletes a file through the API', async () => {
    const fetchMock = stubFetch({
      'GET /api/v1/resources/res-1?format=blocks': () =>
        new Response(JSON.stringify(resource), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      'GET /api/v1/resources/res-1/files': () =>
        new Response(
          JSON.stringify({
            files: [
              { id: 'art-1', resource_id: 'res-1', name: 'diagram.png', type: 'IMAGE', mime_type: 'image/png', byte_size: 2048, sha256: 'x', file_path: '/x', created_at: '' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
      'DELETE /api/v1/resources/res-1/files/art-1': () => new Response(null, { status: 204 }),
    })

    render(<WorkbenchResourceInspector resource={resource} />)
    await waitFor(() => expect(screen.getByTestId('resource-file-delete-art-1')).toBeDefined())

    fireEvent.click(screen.getByTestId('resource-file-delete-art-1'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/resources/res-1/files/art-1', { method: 'DELETE' })
    )
  })
})
