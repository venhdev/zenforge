import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalModal } from './TerminalModal'

// Mock TerminalConsole to test modal portal & keyboard boundaries
vi.mock('../terminal/TerminalConsole', () => ({
  TerminalConsole: ({ sessionId, onClose }: any) => (
    <div data-testid="mock-terminal-console">
      <span>Session: {sessionId}</span>
      <button onClick={onClose}>Close Terminal</button>
    </div>
  ),
}))

describe('TerminalModal', () => {
  it('renders terminal console inside portal and delegates props', () => {
    const handleClose = vi.fn()
    render(
      <TerminalModal
        sessionId="sess-12345"
        taskTitle="Test Run"
        onClose={handleClose}
      />
    )

    expect(screen.getByTestId('mock-terminal-console')).toBeTruthy()
    expect(screen.getByText('Session: sess-12345')).toBeTruthy()

    // Test close button inside mock console
    fireEvent.click(screen.getByText('Close Terminal'))
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape key press and backdrop click', () => {
    const handleClose = vi.fn()
    render(
      <TerminalModal
        sessionId="sess-12345"
        taskTitle="Test Run"
        onClose={handleClose}
      />
    )

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)

    // Backdrop click
    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(handleClose).toHaveBeenCalledTimes(2)
  })
})
