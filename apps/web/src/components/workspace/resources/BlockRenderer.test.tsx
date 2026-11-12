import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockRenderer } from './BlockRenderer'
import type { ResourceBlock } from '../../../types/contracts'

describe('BlockRenderer', () => {
  it('renders diagram block with copy button', () => {
    const block: ResourceBlock = {
      id: 'block-1',
      type: 'diagram',
      format: 'mermaid',
      data: 'graph TD; A-->B;',
    }
    const onCopy = vi.fn()

    render(<BlockRenderer block={block} onCopy={onCopy} isCopied={false} />)

    expect(screen.getByText(/Diagram/i)).toBeDefined()
    expect(screen.getByText('graph TD; A-->B;')).toBeDefined()

    const copyBtn = screen.getByRole('button')
    fireEvent.click(copyBtn)
    expect(onCopy).toHaveBeenCalledWith('graph TD; A-->B;')
  })

  it('renders bash command block', () => {
    const block: ResourceBlock = {
      id: 'block-2',
      type: 'bash',
      format: 'bash',
      data: 'pnpm test',
      metadata: { executable: true },
    }
    const onCopy = vi.fn()

    render(<BlockRenderer block={block} onCopy={onCopy} isCopied={false} />)

    expect(screen.getByText(/executable bash script/i)).toBeDefined()
    expect(screen.getByText('pnpm test')).toBeDefined()
  })

  it('renders fixture block with json serialization', () => {
    const block: ResourceBlock = {
      id: 'block-3',
      type: 'fixture',
      format: 'json',
      data: { hello: 'world' },
    }
    const onCopy = vi.fn()

    render(<BlockRenderer block={block} onCopy={onCopy} isCopied={false} />)

    expect(screen.getByText(/Test Fixture/i)).toBeDefined()
    expect(screen.getByText(/"hello": "world"/i)).toBeDefined()
  })
})
