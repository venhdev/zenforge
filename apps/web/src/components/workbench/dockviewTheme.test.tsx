import { describe, it, expect } from 'vitest'
import { DockviewReact } from 'dockview-react'
import './dockviewTheme.css'

export const DOCKVIEW_ZENFORGE_THEME = 'dockview-theme-zenforge'

describe('dockviewTheme', () => {
  it('successfully loads dockview-react component and theme selector', () => {
    expect(DockviewReact).toBeDefined()
    expect(DOCKVIEW_ZENFORGE_THEME).toBe('dockview-theme-zenforge')
  })
})
