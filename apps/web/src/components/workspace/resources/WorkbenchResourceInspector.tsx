import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Paperclip, Trash2, Upload } from 'lucide-react'
import { useZenfAPI } from '../../../hooks/useZenfAPI'
import type { Artifact, Resource } from '../../../types/contracts'
import { ArtifactPreviewModal } from '../../inspector/ArtifactPreviewModal'
import { ResourceReaderPane } from './ResourceReaderPane'
import { useResourceEditor } from './useResourceEditor'

export interface WorkbenchResourceInspectorProps {
  resource: Resource
  onResourceUpdated?: () => void
  onResourceDeleted?: () => void
}

export const WorkbenchResourceInspector: React.FC<WorkbenchResourceInspectorProps> = ({
  resource,
  onResourceUpdated,
  onResourceDeleted,
}) => {
  const {
    fetchResource,
    updateResource,
    refreshResource,
    deleteResource,
    fetchResourceFiles,
    uploadResourceFile,
    deleteResourceFile,
  } = useZenfAPI()
  const [detailResource, setDetailResource] = useState<Resource | null>(resource)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState('')
  const [files, setFiles] = useState<Artifact[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [previewFile, setPreviewFile] = useState<Artifact | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDetailResource(resource)
    let cancelled = false
    setLoadingDetail(true)
    void fetchResource(resource.id, 'blocks').then((res) => {
      if (cancelled) return
      setLoadingDetail(false)
      if (res.ok && res.data) {
        setDetailResource(res.data)
      }
    })
    return () => {
      cancelled = true
    }
  }, [resource.id, fetchResource])

  const loadFiles = useCallback(async () => {
    setFilesLoading(true)
    const res = await fetchResourceFiles(resource.id)
    setFilesLoading(false)
    if (res.ok) setFiles(res.data)
  }, [fetchResourceFiles, resource.id])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const handleAttachFile = useCallback(
    async (file: File) => {
      const res = await uploadResourceFile(resource.id, file)
      if (res.ok) await loadFiles()
    },
    [resource.id, uploadResourceFile, loadFiles]
  )

  const handleRemoveFile = useCallback(
    async (fileId: string) => {
      const res = await deleteResourceFile(resource.id, fileId)
      if (res.ok) await loadFiles()
    },
    [resource.id, deleteResourceFile, loadFiles]
  )

  const handleSaveSource = useCallback(
    async (payload: any) => {
      if (!detailResource) return
      setBusy('update')
      const res = await updateResource(detailResource.id, payload)
      setBusy('')
      if (res.ok && res.data) {
        setDetailResource(res.data)
        onResourceUpdated?.()
      }
    },
    [detailResource, updateResource, onResourceUpdated]
  )

  const editor = useResourceEditor({
    selectedResource: detailResource,
    onSave: handleSaveSource,
  })

  const handleRefresh = useCallback(
    async (target: Resource) => {
      setBusy(`refresh:${target.id}`)
      const res = await refreshResource(target.id)
      setBusy('')
      if (res.ok) {
        const fresh = await fetchResource(target.id, 'blocks')
        if (fresh.ok && fresh.data) {
          setDetailResource(fresh.data)
        }
        onResourceUpdated?.()
      }
    },
    [refreshResource, fetchResource, onResourceUpdated]
  )

  const handleDelete = useCallback(
    async (target: Resource) => {
      const isFile = Boolean(target.path)
      const promptMsg = isFile
        ? `Remove "${target.title}" from the resource registry? The physical file on disk will NOT be touched.`
        : `Delete native resource "${target.title}"? This cannot be undone.`
      if (!window.confirm(promptMsg)) return

      setBusy(`delete:${target.id}`)
      const res = await deleteResource(target.id)
      setBusy('')
      if (res.ok) {
        onResourceDeleted?.()
      }
    },
    [deleteResource, onResourceDeleted]
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950" data-testid="workbench-resource-inspector">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) editor.handleFileImportToEditor(file)
          e.target.value = ''
        }}
      />
      <ResourceReaderPane
        selectedResource={detailResource}
        loadingDetail={loadingDetail}
        editor={editor}
        busy={busy}
        onSave={() => void editor.handleSaveSource()}
        onRefresh={handleRefresh}
        onDelete={handleDelete}
        onImportFileClick={() => fileInputRef.current?.click()}
      />

      <section data-testid="resource-files" className="border-t border-zinc-800/80 px-3 py-2">
        <input
          ref={attachmentInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleAttachFile(file)
            e.target.value = ''
          }}
        />
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            <Paperclip className="h-3 w-3" /> Files ({files.length})
          </span>
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-cyan-500/50 hover:text-cyan-300"
          >
            <Upload className="h-2.5 w-2.5" /> Attach
          </button>
        </div>
        {filesLoading && <p className="text-[10px] text-zinc-500">Loading files…</p>}
        {!filesLoading && files.length === 0 && (
          <p className="text-[10px] text-zinc-600">No attached files. Drop images, PDFs or logs here.</p>
        )}
        <ul className="space-y-1">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-1.5 rounded border border-zinc-800/70 bg-zinc-900/40 px-2 py-1">
              <button
                type="button"
                data-testid={`resource-file-${file.id}`}
                onClick={() => setPreviewFile(file)}
                className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-300 hover:text-cyan-300"
                title={file.name}
              >
                {file.name}
              </button>
              <span className="shrink-0 font-mono text-[9px] text-zinc-500">
                {(file.byte_size / 1024).toFixed(1)} KB
              </span>
              <button
                type="button"
                data-testid={`resource-file-delete-${file.id}`}
                onClick={() => void handleRemoveFile(file.id)}
                className="shrink-0 text-zinc-500 hover:text-rose-400"
                title="Delete file"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {previewFile && (
        <ArtifactPreviewModal artifact={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  )
}
