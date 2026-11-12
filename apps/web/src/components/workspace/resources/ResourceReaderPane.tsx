import React, { useState, useRef, useEffect } from 'react'
import {
  Check,
  Copy,
  Database,
  Eye,
  FileCode,
  FileText,
  FolderGit2,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { MarkdownViewer } from '../../../lib/markdownRenderer'
import type { Resource, ResourceKind, ResourceStatus } from '../../../types/contracts'
import { BlockRenderer } from './BlockRenderer'
import { KIND_COLORS, RESOURCE_KINDS, SEMANTIC_TYPES, getTagColor } from './types'
import type { useResourceEditor } from './useResourceEditor'

export interface ResourceReaderPaneProps {
  selectedResource: Resource | null
  loadingDetail: boolean
  editor: ReturnType<typeof useResourceEditor>
  busy: string
  onSave: () => Promise<void> | void
  onRefresh: (res: Resource) => Promise<void> | void
  onDelete: (res: Resource) => Promise<void> | void
  onImportFileClick: () => void
  onTagClick?: (tag: string) => void
}

export const ResourceReaderPane: React.FC<ResourceReaderPaneProps> = ({
  selectedResource,
  loadingDetail,
  editor,
  busy,
  onSave,
  onRefresh,
  onDelete,
  onImportFileClick,
  onTagClick,
}) => {
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const addTagInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isAddingTag) {
      addTagInputRef.current?.focus()
    } else {
      setNewTagInput('')
    }
  }, [isAddingTag])

  const handleCommitNewTag = async () => {
    const tag = newTagInput.trim().replace(/^#/, '')
    if (tag) {
      await editor.handleAddTag(tag)
    }
    setIsAddingTag(false)
    setNewTagInput('')
  }

  if (!selectedResource) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-zinc-950 flex-1">
        <Package className="h-12 w-12 text-zinc-700 mb-3" />
        <h3 className="text-sm font-semibold text-zinc-300">No resource selected</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-sm">
          Select a resource from the directory on the left, or create a new entry.
        </p>
      </div>
    )
  }

  const agentUri = selectedResource.project_slug
    ? `zenf://${selectedResource.project_slug}/resource/${selectedResource.key}`
    : `zenf://global/resource/${selectedResource.key}`

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <div className="flex h-full flex-col overflow-hidden">
        {/* Article Top Navigation Bar */}
        <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {/* Breadcrumb with inline Key Copy */}
              <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-zinc-500">
                <span className="uppercase text-sky-400 font-semibold">
                  {selectedResource.scope}
                </span>
                {selectedResource.project_slug && (
                  <>
                    <span>/</span>
                    <span className="text-zinc-300">{selectedResource.project_slug}</span>
                  </>
                )}
                {selectedResource.scope_ref && (
                  <>
                    <span>/</span>
                    <span className="text-zinc-300">{selectedResource.scope_ref}</span>
                  </>
                )}
                <span>/</span>
                <span className="text-zinc-300 font-bold">{selectedResource.key}</span>
                <button
                  onClick={() => void editor.handleCopy(selectedResource.key, 'key')}
                  title="Copy Resource Key"
                  className="ml-1 text-zinc-500 hover:text-zinc-200 transition cursor-pointer"
                >
                  {editor.copiedKey === 'key' ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                {/* Canonical Agent URI button */}
                <button
                  onClick={() => void editor.handleCopy(agentUri, 'agent-uri')}
                  title={`Copy Agent URI: ${agentUri}`}
                  className="ml-1.5 flex items-center gap-1 rounded bg-sky-500/10 hover:bg-sky-500/20 px-1.5 py-0.5 text-[9.5px] font-mono text-sky-300 border border-sky-500/30 transition cursor-pointer"
                >
                  {editor.copiedKey === 'agent-uri' ? (
                    <>
                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-2.5 w-2.5 text-sky-400" />
                      <span>Agent Ref</span>
                    </>
                  )}
                </button>

                {/* Soul Copy Prompt Directive Button */}
                {selectedResource.kind === 'soul' && (
                  <button
                    onClick={() => void editor.handleCopy(editor.editorContent, 'soul-prompt')}
                    title="Copy Prompt Directive"
                    className="ml-1.5 flex items-center gap-1 rounded bg-violet-500/10 hover:bg-violet-500/20 px-2 py-0.5 text-[9.5px] font-mono text-violet-300 border border-violet-500/30 transition cursor-pointer"
                  >
                    {editor.copiedKey === 'soul-prompt' ? (
                      <>
                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                        <span className="text-emerald-300">Prompt Copied!</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-2.5 w-2.5 text-violet-400" />
                        <span>Copy Prompt</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Title */}
              <h1 className="mt-1 text-base font-bold text-zinc-100 flex items-center gap-2">
                {editor.editorMetadata.title || selectedResource.title}
                <span className="text-xs font-normal font-mono text-zinc-500">
                  (v{selectedResource.version})
                </span>
              </h1>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {selectedResource.kind && (
                  <span
                    className={`rounded border px-1.5 py-0.2 text-[9px] font-mono uppercase ${
                      KIND_COLORS[selectedResource.kind] ||
                      'border-zinc-700 bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {selectedResource.kind}
                  </span>
                )}

                {!selectedResource.path ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-mono text-emerald-300 ring-1 ring-emerald-500/30">
                    <Database className="h-3 w-3" /> Native SQLite WAL
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                    <FolderGit2 className="h-3 w-3 text-sky-400" />
                    <span className="truncate max-w-[280px]">{selectedResource.path}</span>
                  </span>
                )}

                {/* Dynamic Tag Chips with 1-Click Filter and Hover ✕ Delete */}
                {(editor.editorMetadata.types && editor.editorMetadata.types.length > 0
                  ? editor.editorMetadata.types
                  : [selectedResource.type.toLowerCase()]
                ).map((t) => (
                  <span
                    key={t}
                    className={`group inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono transition ${getTagColor(
                      t
                    )}`}
                  >
                    <button
                      type="button"
                      onClick={() => onTagClick?.(t)}
                      title={`Filter resources by #${t}`}
                      className="hover:underline cursor-pointer"
                    >
                      #{t}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void editor.handleRemoveTag(t)
                      }}
                      title={`Remove tag #${t}`}
                      className="ml-0.5 text-zinc-400 hover:text-rose-400 transition cursor-pointer opacity-70 group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}

                {/* Inline Add Tag Button / Input */}
                {isAddingTag ? (
                  <div className="inline-flex items-center gap-1 rounded border border-sky-500/50 bg-zinc-900 px-1.5 py-0.5 text-[10px]">
                    <span className="text-zinc-500 font-mono">#</span>
                    <input
                      ref={addTagInputRef}
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleCommitNewTag()
                        } else if (e.key === 'Escape') {
                          setIsAddingTag(false)
                        }
                      }}
                      onBlur={() => void handleCommitNewTag()}
                      placeholder="tag..."
                      className="w-16 bg-transparent text-[10px] font-mono text-zinc-200 outline-none placeholder:text-zinc-600"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingTag(true)}
                    title="Add a tag to this resource"
                    className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    <span>Tag</span>
                  </button>
                )}

                <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                  {editor.editorMetadata.status || selectedResource.status}
                </span>
              </div>
            </div>

            {/* Reader Action Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* View Mode Toggle: Interactive Preview vs Raw Source */}
              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                <button
                  onClick={() => editor.setReaderViewMode('preview')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    editor.readerViewMode === 'preview'
                      ? 'bg-sky-500/20 text-sky-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
                <button
                  onClick={() => editor.setReaderViewMode('source')}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    editor.readerViewMode === 'source'
                      ? 'bg-sky-500/20 text-sky-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileCode className="h-3.5 w-3.5" /> Source
                </button>
              </div>

              {/* Unsaved indicator */}
              {editor.isDirty && (
                <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-mono text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Unsaved
                </span>
              )}

              {/* Save Button */}
              {(editor.readerViewMode === 'source' || editor.isDirty) && (
                <button
                  onClick={() => void editor.handleSaveSource()}
                  disabled={busy === 'update' || !editor.isDirty}
                  title="Save Changes (Ctrl+S / ⌘S)"
                  className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-sky-400 disabled:opacity-40 transition cursor-pointer"
                >
                  <Check className="h-3 w-3" />
                  <span>{busy === 'update' ? 'Saving…' : 'Save'}</span>
                </button>
              )}

              {/* Revert Button */}
              {editor.isDirty && (
                <button
                  onClick={editor.handleDiscardSource}
                  title="Discard unsaved changes (Esc)"
                  className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  <span>Revert</span>
                </button>
              )}

              {/* Import .md File Button */}
              <button
                onClick={onImportFileClick}
                title="Load content from a local markdown (.md) file"
                className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition cursor-pointer"
              >
                <Upload className="h-3 w-3 text-sky-400" />
                <span>Import .md</span>
              </button>

              {/* Refresh Snapshot from disk */}
              {selectedResource.path && (
                <button
                  onClick={() => void onRefresh(selectedResource)}
                  disabled={busy === `refresh:${selectedResource.id}`}
                  title={`Sync latest snapshot from disk file (${selectedResource.path})`}
                  className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-emerald-400 hover:bg-zinc-800 disabled:opacity-50 transition cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${
                      busy === `refresh:${selectedResource.id}` ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Sync Disk</span>
                </button>
              )}

              {/* Metadata Drawer Toggle */}
              <button
                onClick={() => editor.setShowMetadataDrawer((v) => !v)}
                title={
                  editor.showMetadataDrawer
                    ? 'Hide Metadata Panel'
                    : 'Edit Resource Metadata'
                }
                className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition cursor-pointer ${
                  editor.showMetadataDrawer
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Meta</span>
              </button>

              {/* More Actions Menu (...) */}
              <div className="relative">
                <button
                  onClick={() => editor.setMoreMenuOpen((v) => !v)}
                  title="More resource actions"
                  className="flex items-center rounded border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>

                {editor.moreMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => editor.setMoreMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl text-xs">
                      <button
                        onClick={() => {
                          void editor.handleCopy(agentUri, 'agent-uri')
                          editor.setMoreMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3 text-sky-400" />
                        <span>Copy Agent URI (zenf://...)</span>
                      </button>
                      <button
                        onClick={() => {
                          void editor.handleCopy(`[${selectedResource.title}](${agentUri})`, 'md-link')
                          editor.setMoreMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                      >
                        <FileText className="h-3 w-3 text-zinc-400" />
                        <span>Copy Markdown Link</span>
                      </button>
                      <button
                        onClick={() => {
                          void editor.handleCopy(selectedResource.id, 'res-id')
                          editor.setMoreMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                      >
                        <Copy className="h-3 w-3 text-zinc-400" />
                        <span>Copy Resource ID</span>
                      </button>
                      <button
                        onClick={() => {
                          void editor.handleCopy(
                            editor.editorContent || selectedResource.content || '',
                            'res-content'
                          )
                          editor.setMoreMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                      >
                        <FileCode className="h-3 w-3 text-zinc-400" />
                        <span>Copy Raw Content</span>
                      </button>
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        onClick={() => {
                          editor.setMoreMenuOpen(false)
                          void onDelete(selectedResource)
                        }}
                        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Delete Resource</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Summary Abstract */}
          {!editor.showMetadataDrawer &&
            (editor.editorMetadata.summary || selectedResource.summary) && (
              <div className="mt-3 rounded-md bg-zinc-900/60 p-2.5 border border-zinc-800/60 text-xs text-zinc-300 leading-relaxed font-sans">
                <span className="font-semibold text-sky-400 mr-1.5">Abstract:</span>
                {editor.editorMetadata.summary || selectedResource.summary}
              </div>
            )}
        </div>

        {/* Collapsible Metadata Editing Panel */}
        {editor.showMetadataDrawer && (
          <div className="border-b border-zinc-800 bg-zinc-900/60 p-4 space-y-3 shrink-0">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Title
                </label>
                <input
                  value={editor.editorMetadata.title}
                  onChange={(e) =>
                    editor.updateEditorMetadata({ title: e.target.value })
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Kind
                </label>
                <select
                  value={editor.editorMetadata.kind}
                  onChange={(e) =>
                    editor.updateEditorMetadata({
                      kind: e.target.value as ResourceKind,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-sky-500 uppercase"
                >
                  {RESOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Status
                </label>
                <select
                  value={editor.editorMetadata.status}
                  onChange={(e) =>
                    editor.updateEditorMetadata({
                      status: e.target.value as ResourceStatus,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-sky-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DRAFT">DRAFT</option>
                  <option value="DEPRECATED">DEPRECATED</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Summary / Abstract
              </label>
              <textarea
                value={editor.editorMetadata.summary}
                onChange={(e) =>
                  editor.updateEditorMetadata({ summary: e.target.value })
                }
                rows={2}
                placeholder="1-2 sentences summarizing this resource…"
                className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Semantic Types (Multi-Select)
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SEMANTIC_TYPES.map((t) => {
                  const selected = editor.editorMetadata.types.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const updated = selected
                          ? editor.editorMetadata.types.filter((item) => item !== t)
                          : [...editor.editorMetadata.types, t]
                        editor.updateEditorMetadata({ types: updated })
                      }}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-mono transition cursor-pointer ${
                        selected
                          ? `${getTagColor(t)} ring-1 ring-current font-bold`
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      #{t}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Tags (comma-separated)
              </label>
              <input
                value={editor.editorMetadata.tags}
                onChange={(e) =>
                  editor.updateEditorMetadata({ tags: e.target.value })
                }
                placeholder="architecture, rules, adaptor"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
              />
            </div>
          </div>
        )}

        {/* Resource Content Body: Preview or Full-Height Source Editor */}
        {editor.readerViewMode === 'source' ? (
          <div className="flex flex-1 flex-col h-full overflow-hidden bg-zinc-950">
            <div className="relative flex-1 p-5 flex flex-col min-h-0">
              <textarea
                value={editor.editorContent}
                onChange={(e) => {
                  editor.setEditorContent(e.target.value)
                  editor.setIsDirty(true)
                }}
                onKeyDown={(e) => editor.handleEditorKeyDown(e, onSave)}
                placeholder="# Enter CommonMark / GFM markdown..."
                className="w-full flex-1 resize-none bg-transparent font-mono text-xs text-zinc-200 outline-none leading-relaxed selection:bg-sky-500/30 overflow-y-auto"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-between px-5 py-2 border-t border-zinc-800/60 bg-zinc-900/30 text-[11px] font-mono text-zinc-500">
              <div className="flex items-center gap-3">
                <span>{new Blob([editor.editorContent]).size} bytes</span>
                <span>•</span>
                <span>{editor.editorContent.split('\n').length} lines</span>
                {editor.isDirty && (
                  <>
                    <span>•</span>
                    <span className="text-amber-400 font-semibold">Modified</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-4 text-[10.5px]">
                <span>
                  <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">
                    Ctrl
                  </kbd>
                  +
                  <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">
                    S
                  </kbd>{' '}
                  to save
                </span>
                <span>
                  <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">
                    Esc
                  </kbd>{' '}
                  to revert
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            {loadingDetail ? (
              <div className="py-16 text-center font-mono text-xs text-zinc-500">
                Loading rich resource blocks…
              </div>
            ) : editor.isDirty ? (
              <div className="max-w-4xl">
                <div className="mb-4 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 font-mono text-[11px] text-amber-300 flex items-center justify-between">
                  <span>Previewing unsaved draft</span>
                  <button
                    onClick={() => void editor.handleSaveSource()}
                    disabled={busy === 'update'}
                    className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/30 cursor-pointer"
                  >
                    Save Now
                  </button>
                </div>
                <MarkdownViewer content={editor.editorContent} />
              </div>
            ) : (
              <div className="max-w-4xl space-y-4">
                {selectedResource.blocks && selectedResource.blocks.length > 0 ? (
                  selectedResource.blocks.map((block) => (
                    <BlockRenderer
                      key={block.id}
                      block={block}
                      onCopy={(txt) => void editor.handleCopy(txt, `blk-${block.id}`)}
                      isCopied={editor.copiedKey === `blk-${block.id}`}
                    />
                  ))
                ) : (
                  <MarkdownViewer content={selectedResource.content || ''} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
