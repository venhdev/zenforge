import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResourcesSidebar } from './ResourcesSidebar'
import type { Resource } from '../../../types/contracts'

const mockResources: Resource[] = [
  {
    id: 'res-1',
    project_slug: 'zenforge',
    key: 'RULES_DOC',
    slug: 'rules-doc',
    kind: 'spec',
    type: 'SPEC',
    types: ['rules', 'policy'],
    format: 'markdown',
    scope: 'PROJECT',
    title: 'Rules Document',
    path: '',
    content_hash: 'h1',
    byte_size: 100,
    status: 'ACTIVE',
    summary: 'Rules summary',
    content: 'Content',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'res-2',
    project_slug: 'zenforge',
    key: 'POLICY_DOC',
    slug: 'policy-doc',
    kind: 'spec',
    type: 'SPEC',
    types: ['policy', 'security'],
    format: 'markdown',
    scope: 'PROJECT',
    title: 'Policy Document',
    path: '',
    content_hash: 'h2',
    byte_size: 100,
    status: 'ACTIVE',
    summary: 'Policy summary',
    content: 'Content',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

describe('ResourcesSidebar Dynamic Tag Cloud', () => {
  it('renders dynamic tags extracted from resources with occurrence counts', () => {
    const handleToggleType = vi.fn()
    render(
      <ResourcesSidebar
        loading={false}
        visibleResources={mockResources}
        selectedId={mockResources[0].id}
        onSelectResource={() => {}}
        onReload={() => {}}
        onCreateClick={() => {}}
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        onResetSearch={() => {}}
        searchResults={null}
        searching={false}
        scopeFilter="ALL"
        onScopeFilterChange={() => {}}
        includeGlobal={true}
        onIncludeGlobalChange={() => {}}
        selectedTypes={[]}
        onToggleTypeFilter={handleToggleType}
        onResetTypes={() => {}}
        snippetById={new Map()}
        error=""
      />
    )

    // Open the collapsible filter drawer first
    fireEvent.click(screen.getByTestId('resources-filter-toggle'))

    const filterDrawer = screen.getByTestId('resources-filter-drawer')
    expect(filterDrawer).toBeDefined()

    // '#policy' should appear with count 2 (appears in both resources)
    const policyElements = screen.getAllByText('#policy')
    expect(policyElements.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)

    // '#rules' and '#security' should also appear
    expect(screen.getAllByText('#rules').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('#security').length).toBeGreaterThanOrEqual(1)

    // Clicking the top cloud tag calls onToggleTypeFilter
    fireEvent.click(policyElements[0])
    expect(handleToggleType).toHaveBeenCalledWith('policy')
  })

  it('shows active filter chips when drawer is closed and filters are applied', () => {
    const handleScopeChange = vi.fn()
    const handleResetTypes = vi.fn()
    render(
      <ResourcesSidebar
        loading={false}
        visibleResources={mockResources}
        selectedId={null}
        onSelectResource={() => {}}
        onReload={() => {}}
        onCreateClick={() => {}}
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        onResetSearch={() => {}}
        searchResults={null}
        searching={false}
        kindFilter="spec"
        onKindFilterChange={() => {}}
        scopeFilter="PROJECT"
        onScopeFilterChange={handleScopeChange}
        includeGlobal={true}
        onIncludeGlobalChange={() => {}}
        selectedTypes={['policy']}
        onToggleTypeFilter={() => {}}
        onResetTypes={handleResetTypes}
        snippetById={new Map()}
        error=""
      />
    )

    // Filter badge should show 3 active filters (kind + scope + 1 tag)
    const toggleBtn = screen.getByTestId('resources-filter-toggle')
    expect(toggleBtn.textContent).toContain('3')

    // Active filter chips should be visible while drawer is closed
    const chipsBar = screen.getByTestId('resources-active-filter-chips')
    expect(chipsBar.textContent).toContain('Kind: Spec')
    expect(chipsBar.textContent).toContain('Scope: Project')
    expect(chipsBar.textContent).toContain('#policy')
  })

  it('makes resource items draggable with application/zenf-resource payload', () => {
    render(
      <ResourcesSidebar
        loading={false}
        visibleResources={mockResources}
        selectedId={null}
        onSelectResource={() => {}}
        onReload={() => {}}
        onCreateClick={() => {}}
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        onResetSearch={() => {}}
        searchResults={null}
        searching={false}
        scopeFilter="ALL"
        onScopeFilterChange={() => {}}
        includeGlobal={true}
        onIncludeGlobalChange={() => {}}
        selectedTypes={[]}
        onToggleTypeFilter={() => {}}
        onResetTypes={() => {}}
        snippetById={new Map()}
        error=""
      />
    )

    const resourceTitle = screen.getByText('Rules Document')
    const itemCard = resourceTitle.closest('[draggable="true"]')
    expect(itemCard).not.toBeNull()

    const setDataMock = vi.fn()
    fireEvent.dragStart(itemCard!, {
      dataTransfer: {
        setData: setDataMock,
        effectAllowed: '',
      },
    })

    expect(setDataMock).toHaveBeenCalledWith(
      'application/zenf-resource',
      expect.stringContaining('"key":"RULES_DOC"')
    )
  })
})

describe('ResourcesSidebar status filter', () => {
  it('offers status tabs and reports the selected status', () => {
    const onStatusFilterChange = vi.fn()
    render(
      <ResourcesSidebar
        loading={false}
        visibleResources={mockResources}
        selectedId={null}
        onSelectResource={() => {}}
        onReload={() => {}}
        onCreateClick={() => {}}
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        onResetSearch={() => {}}
        searchResults={null}
        searching={false}
        scopeFilter="ALL"
        onScopeFilterChange={() => {}}
        statusFilter="ACTIVE"
        onStatusFilterChange={onStatusFilterChange}
        includeGlobal={true}
        onIncludeGlobalChange={() => {}}
        selectedTypes={[]}
        onToggleTypeFilter={() => {}}
        onResetTypes={() => {}}
        snippetById={new Map()}
        error=""
      />
    )

    fireEvent.click(screen.getByTestId('resources-filter-toggle'))
    fireEvent.click(screen.getByTestId('resource-status-superseded'))

    expect(onStatusFilterChange).toHaveBeenCalledWith('SUPERSEDED')
  })
})
