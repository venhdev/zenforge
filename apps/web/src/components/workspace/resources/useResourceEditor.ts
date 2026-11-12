import { useCallback, useEffect, useRef, useState } from 'react'
import type { Resource, ResourceKind, ResourceStatus } from '../../../types/contracts'
import { parseMarkdownContent } from '../../../lib/markdownFrontmatterParser'
import { parseTags } from './types'

export interface EditorMetadata {
  title: string
  summary: string
  kind: ResourceKind
  tags: string
  types: string[]
  status: ResourceStatus
}

export interface SaveResourcePayload {
  title: string
  summary: string
  kind?: ResourceKind
  tags: string[]
  types: string[]
  status: ResourceStatus
  content: string
}

export interface UseResourceEditorOptions {
  selectedResource: Resource | null
  onSave?: (payload: SaveResourcePayload) => Promise<void> | void
}

export function useResourceEditor({ selectedResource, onSave }: UseResourceEditorOptions) {
  const [editorContent, setEditorContent] = useState('')
  const [editorMetadata, setEditorMetadata] = useState<EditorMetadata>({
    title: '',
    summary: '',
    kind: 'spec',
    tags: '',
    types: ['design'],
    status: 'ACTIVE',
  })
  const [isDirty, setIsDirty] = useState(false)
  const [readerViewMode, setReaderViewMode] = useState<'preview' | 'source'>('preview')
  const [showMetadataDrawer, setShowMetadataDrawer] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync editor state whenever selectedResource changes
  useEffect(() => {
    if (selectedResource) {
      setEditorContent(selectedResource.content || '')
      setEditorMetadata({
        title: selectedResource.title,
        summary: selectedResource.summary || '',
        kind: selectedResource.kind || 'spec',
        tags: (selectedResource.tags || []).join(', '),
        types:
          selectedResource.types && selectedResource.types.length > 0
            ? selectedResource.types
            : [selectedResource.type.toLowerCase()],
        status: selectedResource.status,
      })
      setIsDirty(false)
    }
  }, [selectedResource])

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
      }
      setCopiedKey(label)
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedKey(null)
      }, 2000)
    } catch {
      // ignore
    }
  }, [])

  const handleDiscardSource = useCallback(() => {
    if (!selectedResource) return
    setEditorContent(selectedResource.content || '')
    setEditorMetadata({
      title: selectedResource.title,
      summary: selectedResource.summary || '',
      kind: selectedResource.kind || 'spec',
      tags: (selectedResource.tags || []).join(', '),
      types:
        selectedResource.types && selectedResource.types.length > 0
          ? selectedResource.types
          : [selectedResource.type.toLowerCase()],
      status: selectedResource.status,
    })
    setIsDirty(false)
  }, [selectedResource])

  const handleFileImportToEditor = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const rawText = String(e.target?.result || '')
      const parsed = parseMarkdownContent(rawText, file.name)
      setEditorContent(parsed.content)
      if (parsed.title || parsed.summary || parsed.tags) {
        setEditorMetadata((prev) => ({
          ...prev,
          title: parsed.title || prev.title,
          summary: parsed.summary || prev.summary,
          tags: parsed.tags ? parsed.tags.join(', ') : prev.tags,
        }))
      }
      setIsDirty(true)
      setReaderViewMode('source')
    }
    reader.readAsText(file)
  }, [])

  const handleSaveSource = useCallback(async () => {
    if (!selectedResource || !onSave) return
    const tags = parseTags(editorMetadata.tags)
    await onSave({
      title: editorMetadata.title.trim() || selectedResource.title,
      summary: editorMetadata.summary.trim(),
      kind: editorMetadata.kind,
      tags,
      types: editorMetadata.types,
      status: editorMetadata.status,
      content: editorContent,
    })
    setIsDirty(false)
  }, [selectedResource, onSave, editorMetadata, editorContent])

  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, customSave?: () => void | Promise<void>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty) {
          if (customSave) {
            void customSave()
          } else {
            void handleSaveSource()
          }
        }
      } else if (e.key === 'Escape') {
        if (isDirty) {
          if (typeof window !== 'undefined' && window.confirm('Discard unsaved changes?')) {
            handleDiscardSource()
          }
        }
      }
    },
    [isDirty, handleSaveSource, handleDiscardSource]
  )

  const updateEditorMetadata = useCallback((partial: Partial<EditorMetadata>) => {
    setEditorMetadata((prev) => ({ ...prev, ...partial }))
    setIsDirty(true)
  }, [])

  const handleRemoveTag = useCallback(
    async (tagToRemove: string) => {
      if (!selectedResource || !onSave) return
      const currentTypes =
        editorMetadata.types && editorMetadata.types.length > 0
          ? editorMetadata.types
          : [selectedResource.type.toLowerCase()]
      const updated = currentTypes.filter(
        (t) => t.toLowerCase().trim() !== tagToRemove.toLowerCase().trim()
      )
      setEditorMetadata((prev) => ({ ...prev, types: updated }))
      await onSave({
        title: editorMetadata.title.trim() || selectedResource.title,
        summary: editorMetadata.summary.trim(),
        kind: editorMetadata.kind,
        tags: parseTags(editorMetadata.tags),
        types: updated,
        status: editorMetadata.status,
        content: editorContent,
      })
    },
    [selectedResource, onSave, editorMetadata, editorContent]
  )

  const handleAddTag = useCallback(
    async (newTag: string) => {
      const cleanTag = newTag.toLowerCase().trim().replace(/^#/, '')
      if (!cleanTag || !selectedResource || !onSave) return
      const currentTypes =
        editorMetadata.types && editorMetadata.types.length > 0
          ? editorMetadata.types
          : [selectedResource.type.toLowerCase()]
      if (currentTypes.some((t) => t.toLowerCase().trim() === cleanTag)) return
      const updated = [...currentTypes, cleanTag]
      setEditorMetadata((prev) => ({ ...prev, types: updated }))
      await onSave({
        title: editorMetadata.title.trim() || selectedResource.title,
        summary: editorMetadata.summary.trim(),
        kind: editorMetadata.kind,
        tags: parseTags(editorMetadata.tags),
        types: updated,
        status: editorMetadata.status,
        content: editorContent,
      })
    },
    [selectedResource, onSave, editorMetadata, editorContent]
  )

  return {
    editorContent,
    setEditorContent,
    editorMetadata,
    setEditorMetadata,
    updateEditorMetadata,
    isDirty,
    setIsDirty,
    readerViewMode,
    setReaderViewMode,
    showMetadataDrawer,
    setShowMetadataDrawer,
    moreMenuOpen,
    setMoreMenuOpen,
    copiedKey,
    handleCopy,
    handleDiscardSource,
    handleFileImportToEditor,
    handleEditorKeyDown,
    handleSaveSource,
    handleRemoveTag,
    handleAddTag,
  }
}
