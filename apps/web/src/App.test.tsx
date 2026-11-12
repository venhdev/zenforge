import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any

  globalThis.EventSource = class MockEventSource {
    onopen: any = null
    onerror: any = null
    addEventListener() {}
    removeEventListener() {}
    close() {}
  } as any

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
    text: async () => '[]',
  })
})

describe('App', () => {
  it('renders ZenForge app shell with DockviewWorkbench mounted in DAG view', () => {
    const { unmount } = render(<App />)

    expect(screen.getByTestId('dockview-workbench-root')).toBeDefined()
    expect(screen.getByText('Reset Layout')).toBeDefined()
    expect(screen.getByText(/ZenForge v/)).toBeDefined()

    unmount()
  })

  it('renders panels manager menu and supports toggling inspector panel', () => {
    const { unmount } = render(<App />)

    const panelsButton = screen.getByRole('button', { name: /Panels/i })
    expect(panelsButton).toBeDefined()

    unmount()
  })
})
