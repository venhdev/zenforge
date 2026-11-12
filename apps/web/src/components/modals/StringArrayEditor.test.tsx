import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StringArrayEditor } from './StringArrayEditor'

describe('StringArrayEditor', () => {
  it('renders existing values as badges', () => {
    const onChange = vi.fn()
    render(
      <StringArrayEditor
        label="Target Files"
        values={['fileA.ts', 'fileB.ts']}
        onChange={onChange}
      />
    )

    expect(screen.getByText('Target Files')).toBeDefined()
    expect(screen.getByText('fileA.ts')).toBeDefined()
    expect(screen.getByText('fileB.ts')).toBeDefined()
  })

  it('adds item when Enter is pressed in input', () => {
    const onChange = vi.fn()
    render(
      <StringArrayEditor
        label="Target Files"
        values={['fileA.ts']}
        onChange={onChange}
        placeholder="Enter filename..."
      />
    )

    const input = screen.getByPlaceholderText('Enter filename...')
    fireEvent.change(input, { target: { value: 'fileC.ts' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(['fileA.ts', 'fileC.ts'])
  })

  it('removes item when X button is clicked', () => {
    const onChange = vi.fn()
    render(
      <StringArrayEditor
        label="Acceptance Criteria"
        values={['rule 1', 'rule 2']}
        onChange={onChange}
      />
    )

    const removeBtn = screen.getByLabelText('Remove rule 1')
    fireEvent.click(removeBtn)

    expect(onChange).toHaveBeenCalledWith(['rule 2'])
  })
})
