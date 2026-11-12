import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkbenchErrorBoundary } from './WorkbenchErrorBoundary'

function Boom(): React.ReactElement {
  throw new Error('panel data is malformed')
}

describe('WorkbenchErrorBoundary', () => {
  it('renders an inline error card instead of crashing the app shell', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <span>shell stays alive</span>
        <WorkbenchErrorBoundary panelId="inspector">
          <Boom />
        </WorkbenchErrorBoundary>
      </div>
    )

    expect(screen.getByText('shell stays alive')).toBeDefined()
    expect(screen.getByTestId('panel-error-inspector')).toBeDefined()
    expect(screen.getByText('panel data is malformed')).toBeDefined()
    spy.mockRestore()
  })

  it('clears the error when the user retries', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    function Flaky(): React.ReactElement {
      if (shouldThrow) throw new Error('transient')
      return <span>recovered</span>
    }

    render(
      <WorkbenchErrorBoundary panelId="stage">
        <Flaky />
      </WorkbenchErrorBoundary>
    )
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(screen.getByText('recovered')).toBeDefined()
    spy.mockRestore()
  })
})
