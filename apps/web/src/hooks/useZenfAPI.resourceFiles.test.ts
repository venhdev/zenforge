import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useZenfAPI } from './useZenfAPI'

function mockJSON(status: number, body: unknown) {
  const payload = status === 204 ? null : JSON.stringify(body)
  const fetchMock = vi.fn(async () =>
    new Response(payload, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useZenfAPI resource files', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists files owned by a resource', async () => {
    const fetchMock = mockJSON(200, {
      files: [{ id: 'art-1', resource_id: 'res-1', name: 'diagram.png', type: 'IMAGE' }],
    })
    const { result } = renderHook(() => useZenfAPI())

    const res = await result.current.fetchResourceFiles('res-1')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].resource_id).toBe('res-1')
    }
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/resources/res-1/files', undefined)
  })

  it('uploads a file as multipart form data', async () => {
    const fetchMock = mockJSON(201, { id: 'art-2', resource_id: 'res-1', name: 'log.txt' })
    const { result } = renderHook(() => useZenfAPI())

    const file = new File(['hello'], 'log.txt', { type: 'text/plain' })
    const res = await result.current.uploadResourceFile('res-1', file)

    expect(res.ok).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('surfaces API errors instead of throwing', async () => {
    mockJSON(413, { error: { message: 'file exceeds the attachment limit' } })
    const { result } = renderHook(() => useZenfAPI())

    const res = await result.current.uploadResourceFile('res-1', new File(['x'], 'big.bin'))

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('attachment limit')
      expect(res.status).toBe(413)
    }
  })

  it('deletes a resource file', async () => {
    const fetchMock = mockJSON(204, {})
    const { result } = renderHook(() => useZenfAPI())

    const res = await result.current.deleteResourceFile('res-1', 'art-2')

    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/resources/res-1/files/art-2', { method: 'DELETE' })
  })
})
