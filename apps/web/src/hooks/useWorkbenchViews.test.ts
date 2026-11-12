import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  ALL_WORKBENCH_VIEW_IDS,
  WORKBENCH_VIEWS_STORAGE_KEY,
  useWorkbenchViews,
} from './useWorkbenchViews'

describe('useWorkbenchViews', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('enables every view by default', () => {
    const { result } = renderHook(() => useWorkbenchViews())

    expect(result.current.enabledViews).toEqual(ALL_WORKBENCH_VIEW_IDS)
    expect(Object.values(result.current.enabledMap).every(Boolean)).toBe(true)
  })

  it('persists a disabled view and restores it on the next mount', () => {
    const first = renderHook(() => useWorkbenchViews())
    act(() => first.result.current.setViewEnabled('harness', false))

    expect(first.result.current.enabledMap.harness).toBe(false)
    expect(JSON.parse(localStorage.getItem(WORKBENCH_VIEWS_STORAGE_KEY) || '[]')).not.toContain('harness')

    const second = renderHook(() => useWorkbenchViews())
    expect(second.result.current.enabledMap.harness).toBe(false)
    expect(second.result.current.enabledMap.explorer).toBe(true)
  })

  it('recovers from a corrupt payload instead of leaving the cockpit empty', () => {
    localStorage.setItem(WORKBENCH_VIEWS_STORAGE_KEY, 'not-json{')
    const { result } = renderHook(() => useWorkbenchViews())
    expect(result.current.enabledViews).toEqual(ALL_WORKBENCH_VIEW_IDS)
  })

  it('recovers from an empty payload', () => {
    localStorage.setItem(WORKBENCH_VIEWS_STORAGE_KEY, '[]')
    const { result } = renderHook(() => useWorkbenchViews())
    expect(result.current.enabledViews).toEqual(ALL_WORKBENCH_VIEW_IDS)
  })

  it('drops unknown ids from a persisted payload', () => {
    localStorage.setItem(
      WORKBENCH_VIEWS_STORAGE_KEY,
      JSON.stringify(['explorer', 'nonsense-panel'])
    )
    const { result } = renderHook(() => useWorkbenchViews())
    expect(result.current.enabledViews).toEqual(['explorer'])
  })

  it('resetViews re-enables everything', () => {
    const { result } = renderHook(() => useWorkbenchViews())
    act(() => result.current.setViewEnabled('stage', false))
    act(() => result.current.resetViews())

    expect(result.current.enabledViews).toEqual(ALL_WORKBENCH_VIEW_IDS)
    expect(JSON.parse(localStorage.getItem(WORKBENCH_VIEWS_STORAGE_KEY) || '[]')).toEqual(
      ALL_WORKBENCH_VIEW_IDS
    )
  })
})
