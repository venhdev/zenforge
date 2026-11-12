import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspaceNavigation } from './useWorkspaceNavigation'

const setUrl = (search: string) => {
  window.history.replaceState(null, '', `/${search}`)
}

const currentParams = () => new URLSearchParams(window.location.search)

interface Props {
  project?: boolean
  selection?: boolean
  plan?: string | null
}

const renderNavigation = (initialProps: Props = {}) =>
  renderHook(
    ({ project = false, selection = false, plan = null }: Props) =>
      useWorkspaceNavigation(plan, { project, selection }),
    { initialProps }
  )

describe('useWorkspaceNavigation', () => {
  beforeEach(() => {
    localStorage.clear()
    setUrl('')
  })

  it('prefers a URL parameter over the stored value', () => {
    localStorage.setItem('zenf_active_project', 'stored')
    setUrl('?project=linked')

    const { result } = renderNavigation()

    expect(result.current.activeProjectSlug).toBe('linked')
  })

  it('falls back to the stored value when the URL is clean', () => {
    localStorage.setItem('zenf_selected_task', 'CL-05')
    setUrl('')

    const { result } = renderNavigation()

    expect(result.current.selectedTaskId).toBe('CL-05')
  })

  it('writes the selection into the URL without a reload', () => {
    const { result } = renderNavigation()

    act(() => {
      result.current.setActiveProjectSlug('alpha')
    })

    expect(currentParams().get('project')).toBe('alpha')
  })

  it('keeps a deep link intact before the data has resolved', () => {
    setUrl('?project=ghost&task=CL-05')
    const { result } = renderNavigation({ project: false, selection: false })

    act(() => {
      result.current.setActiveProjectSlug(null)
      result.current.setSelectedTaskId(null)
    })

    expect(currentParams().get('project')).toBe('ghost')
    expect(currentParams().get('task')).toBe('CL-05')
  })

  it('drops a stale project once the project list has resolved', () => {
    localStorage.setItem('zenf_active_project', 'ghost')
    setUrl('?project=ghost')

    const { result, rerender } = renderNavigation({ project: false })
    expect(result.current.activeProjectSlug).toBe('ghost')

    rerender({ project: true })
    act(() => {
      result.current.setActiveProjectSlug(null)
    })

    expect(currentParams().has('project')).toBe(false)
    expect(localStorage.getItem('zenf_active_project')).toBeNull()
  })

  it('drops a stale task once the plan selection has resolved', () => {
    localStorage.setItem('zenf_selected_task', 'CL-05')
    setUrl('?task=CL-05')

    const { result, rerender } = renderNavigation({ selection: false })

    rerender({ selection: true })
    act(() => {
      result.current.setSelectedTaskId(null)
    })

    expect(currentParams().has('task')).toBe(false)
    expect(localStorage.getItem('zenf_selected_task')).toBeNull()
  })

  it('drops a stale plan once the selection has resolved', () => {
    localStorage.setItem('zenf_active_plan', 'gone')
    setUrl('?plan=gone')

    const { rerender } = renderNavigation({ selection: false, plan: 'gone' })
    expect(currentParams().get('plan')).toBe('gone')

    rerender({ selection: true, plan: null })

    expect(currentParams().has('plan')).toBe(false)
    expect(localStorage.getItem('zenf_active_plan')).toBeNull()
  })

  it('keeps valid values in both the URL and storage', () => {
    const { result } = renderNavigation({ project: true, selection: true, plan: 'plan-a' })

    act(() => {
      result.current.setActiveProjectSlug('alpha')
      result.current.setSelectedTaskId('T-01')
    })

    expect(currentParams().get('project')).toBe('alpha')
    expect(currentParams().get('plan')).toBe('plan-a')
    expect(currentParams().get('task')).toBe('T-01')
    expect(localStorage.getItem('zenf_active_project')).toBe('alpha')
    expect(localStorage.getItem('zenf_selected_task')).toBe('T-01')
  })
})
