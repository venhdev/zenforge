import React, { useMemo, useState } from 'react'
import { Database, Filter, FolderGit2, Plus, RefreshCw, Search, X } from 'lucide-react'
import type {
  Resource,
  ResourceKind,
  ResourceScope,
  ResourceSearchResult,
  ResourceStatus,
} from '../../../types/contracts'
import {
  RESOURCE_KINDS,
  SCOPES,
  extractResourceTags,
  getTagColor,
  KIND_COLORS,
} from './types'

export interface ResourcesSidebarProps {
  loading: boolean
  visibleResources: Resource[]
  selectedId: string | null
  onSelectResource: (res: Resource) => void
  onReload: () => void
  onCreateClick: () => void
  query: string
  onQueryChange: (val: string) => void
  onSearch: (e: React.FormEvent) => void
  onResetSearch: () => void
  searchResults: ResourceSearchResult[] | null
  searching: boolean
  kindFilter?: ResourceKind | 'ALL'
  onKindFilterChange?: (kind: ResourceKind | 'ALL') => void
  scopeFilter: ResourceScope | 'ALL'
  onScopeFilterChange: (scope: ResourceScope | 'ALL') => void
  statusFilter?: ResourceStatus | 'ALL'
  onStatusFilterChange?: (status: ResourceStatus | 'ALL') => void
  includeGlobal: boolean
  onIncludeGlobalChange: (include: boolean) => void
  selectedTypes: string[]
  onToggleTypeFilter: (typeTag: string) => void
  onResetTypes: () => void
  snippetById: Map<string, string>
  error: string
  className?: string
}

export const ResourcesSidebar: React.FC<ResourcesSidebarProps> = ({
  loading,
  visibleResources,
  selectedId,
  onSelectResource,
  onReload,
  onCreateClick,
  query,
  onQueryChange,
  onSearch,
  onResetSearch,
  searchResults,
  kindFilter = 'ALL',
  onKindFilterChange,
  scopeFilter,
  onScopeFilterChange,
  statusFilter = 'ALL',
  onStatusFilterChange,
  selectedTypes,
  onToggleTypeFilter,
  onResetTypes,
  snippetById,
  error,
  className,
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  const dynamicTags = useMemo(() => {
    return extractResourceTags(visibleResources)
  }, [visibleResources])

  const activeFilterCount =
    (kindFilter !== 'ALL' ? 1 : 0) +
    (scopeFilter !== 'ALL' ? 1 : 0) +
    selectedTypes.length

  const formatFilterLabel = (val: string) =>
    val === 'ALL' ? 'All' : val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()

  const handleClearAllFilters = () => {
    onKindFilterChange?.('ALL')
    onScopeFilterChange('ALL')
    onResetTypes()
  }

  return (
    <div className={`flex min-w-0 flex-col overflow-hidden border-r border-zinc-800/80 bg-zinc-950 ${className || 'w-[460px] shrink-0'}`}>
      {/* Top Header Bar */}
      <div className="shrink-0 space-y-2 border-b border-zinc-800/80 p-2.5">
        {/* Search & Action Bar */}
        <form onSubmit={onSearch} className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => {
                onQueryChange(e.target.value)
                if (!e.target.value.trim()) onResetSearch()
              }}
              placeholder="Search resources…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/60 py-1 pl-8 pr-2 text-xs text-zinc-200 outline-none focus:border-sky-500 placeholder:text-zinc-600"
            />
          </div>
          {searchResults && (
            <button
              type="button"
              onClick={onResetSearch}
              title="Clear search"
              className="flex items-center rounded border border-zinc-800 p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            title={isFilterOpen ? 'Hide filters' : 'Show filters'}
            aria-label="Toggle filters"
            data-testid="resources-filter-toggle"
            className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium transition cursor-pointer ${
              isFilterOpen || activeFilterCount > 0
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <Filter className="h-3 w-3" />
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-sky-500/30 px-1 text-[9px] font-mono font-bold text-sky-200">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            title="Reload directory"
            className="flex items-center justify-center rounded border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCreateClick}
            className="flex shrink-0 items-center gap-1 rounded bg-sky-500/20 px-2 py-1 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/30 transition cursor-pointer"
          >
            <Plus className="h-3 w-3" /> Resource
          </button>
        </form>

        {/* Active Filter Chips (shown when drawer is collapsed and filters are active) */}
        {!isFilterOpen && activeFilterCount > 0 && (
          <div
            className="flex flex-wrap items-center gap-1 pt-0.5"
            data-testid="resources-active-filter-chips"
          >
            {kindFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => onKindFilterChange?.('ALL')}
                className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 cursor-pointer"
              >
                <span>Kind: {formatFilterLabel(kindFilter)}</span>
                <X className="h-2.5 w-2.5" />
              </button>
            )}
            {scopeFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => onScopeFilterChange('ALL')}
                className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 cursor-pointer"
              >
                <span>Scope: {formatFilterLabel(scopeFilter)}</span>
                <X className="h-2.5 w-2.5" />
              </button>
            )}
            {selectedTypes.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTypeFilter(tag)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-mono font-bold ring-1 ring-current cursor-pointer ${getTagColor(tag)}`}
              >
                <span>#{tag}</span>
                <X className="h-2.5 w-2.5" />
              </button>
            ))}
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Collapsible Filter Drawer */}
        {isFilterOpen && (
          <div
            className="space-y-2 rounded-md border border-zinc-800/80 bg-zinc-900/40 p-2 text-[11px]"
            data-testid="resources-filter-drawer"
          >
            {/* Kind Filter Tabs */}
            {onKindFilterChange && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-11 shrink-0 text-[10px] font-mono uppercase text-zinc-500">
                  Kind
                </span>
                {(['ALL', ...RESOURCE_KINDS] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onKindFilterChange(k)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
                      kindFilter === k
                        ? 'bg-zinc-800 text-sky-300 ring-1 ring-sky-500/30'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    {formatFilterLabel(k)}
                  </button>
                ))}
              </div>
            )}

            {/* Scope Navigator Tabs */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-11 shrink-0 text-[10px] font-mono uppercase text-zinc-500">
                Scope
              </span>
              {(['ALL', ...SCOPES] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => onScopeFilterChange(sc)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
                    scopeFilter === sc
                      ? 'bg-zinc-800 text-sky-300 ring-1 ring-sky-500/30'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {formatFilterLabel(sc)}
                </button>
              ))}
            </div>

            {/* Status Navigator Tabs */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-11 shrink-0 text-[10px] font-mono uppercase text-zinc-500">
                Status
              </span>
              {(['ALL', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  data-testid={`resource-status-${st.toLowerCase()}`}
                  onClick={() => onStatusFilterChange?.(st)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
                    statusFilter === st
                      ? 'bg-zinc-800 text-emerald-300 ring-1 ring-emerald-500/30'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {formatFilterLabel(st)}
                </button>
              ))}
            </div>

            {/* Dynamic Tag Cloud Filter */}
            {dynamicTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="w-11 shrink-0 text-[10px] font-mono uppercase text-zinc-500">
                  Tags
                </span>
                {dynamicTags.map(({ tag, count }) => {
                  const active = selectedTypes.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => onToggleTypeFilter(tag)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-mono transition cursor-pointer ${
                        active
                          ? `${getTagColor(tag)} ring-1 ring-current font-bold`
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
                      }`}
                    >
                      <span>#{tag}</span>
                      <span
                        className={`rounded-full px-1 text-[8px] font-semibold ${
                          active ? 'bg-black/30' : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
                {selectedTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={onResetTypes}
                    className="text-[9.5px] text-zinc-500 hover:text-zinc-300 underline ml-1 cursor-pointer"
                  >
                    reset
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* Resource List Items */}
      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {loading ? (
          <div className="py-12 text-center font-mono text-xs text-zinc-500">
            Loading resources…
          </div>
        ) : visibleResources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 py-12 text-center font-mono text-xs text-zinc-500">
            {searchResults
              ? 'No resources match the search query.'
              : 'No resources found.'}
          </div>
        ) : (
          visibleResources.map((res) => {
            const isSelected = selectedId === res.id
            const snippet = snippetById.get(res.id)
            const isNative = !res.path
            const resTypes =
              res.types && res.types.length > 0 ? res.types : [res.type.toLowerCase()]

            return (
              <div
                key={res.id}
                onClick={() => onSelectResource(res)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/zenf-resource',
                    JSON.stringify({
                      id: res.id,
                      key: res.key,
                      slug: res.slug,
                      kind: res.kind,
                      title: res.title,
                    })
                  )
                  e.dataTransfer.effectAllowed = 'link'
                }}
                className={`group cursor-grab active:cursor-grabbing rounded-lg border p-2.5 transition active:scale-[0.98] ${
                  isSelected
                    ? 'border-sky-500/50 bg-sky-950/20 ring-1 ring-sky-500/30'
                    : 'border-zinc-800/70 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Meta Pill Row */}
                    <div className="flex flex-wrap items-center gap-1">
                      {res.kind && (
                        <span className={`rounded border px-1.5 py-0.2 text-[9px] font-mono uppercase ${KIND_COLORS[res.kind] || 'border-zinc-700 bg-zinc-800 text-zinc-300'}`}>
                          {res.kind}
                        </span>
                      )}
                      <span className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.2 text-[9px] font-mono text-zinc-300 uppercase">
                        {res.scope}
                      </span>
                      {isNative ? (
                        <span className="flex items-center gap-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-mono text-emerald-300">
                          <Database className="h-2.5 w-2.5" /> NATIVE
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.2 text-[9px] font-mono text-zinc-400">
                          <FolderGit2 className="h-2.5 w-2.5" /> FILE
                        </span>
                      )}
                      {resTypes.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className={`rounded px-1.5 py-0.2 text-[9px] font-mono ${getTagColor(t)}`}
                        >
                          #{t}
                        </span>
                      ))}
                    </div>

                    {/* Title & Key */}
                    <h3 className="mt-1 font-semibold text-xs text-zinc-100 group-hover:text-sky-300 transition truncate">
                      {res.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-zinc-500">
                      <span className="text-zinc-400">{res.key}</span>
                      <span>·</span>
                      <span>v{res.version}</span>
                      {res.byte_size > 0 && (
                        <>
                          <span>·</span>
                          <span>{Math.round(res.byte_size / 1024) || 1} KB</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {snippet ? (
                  <p className="mt-1.5 font-mono text-[10.5px] text-sky-200/90 line-clamp-2">
                    {snippet}
                  </p>
                ) : (
                  res.summary && (
                    <p className="mt-1 line-clamp-1 text-[11px] text-zinc-400">
                      {res.summary}
                    </p>
                  )
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
