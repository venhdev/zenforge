import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  WrapText,
  Search,
  FileText,
  Eye,
  Code,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import type { Artifact } from '../../types/contracts'
import { MarkdownViewer } from '../../lib/markdownRenderer'
import { useClipboardCopy } from '../../hooks/useClipboardCopy'

interface ArtifactPreviewModalProps {
  artifact: Artifact
  artifacts?: Artifact[]
  initialContent?: string
  onClose: () => void
  onSelect?: (artifact: Artifact) => void
}

export const ArtifactPreviewModal: React.FC<ArtifactPreviewModalProps> = ({
  artifact,
  artifacts = [],
  initialContent,
  onClose,
  onSelect,
}) => {
  const isImage = artifact.type === 'IMAGE' || artifact.mime_type.startsWith('image/')
  const isPdf = artifact.mime_type === 'application/pdf' || artifact.name.endsWith('.pdf')

  const [content, setContent] = useState<string | null>(initialContent ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wordWrap, setWordWrap] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const { isCopied, copy } = useClipboardCopy()

  // Markdown detection: file extension/MIME OR content has Markdown headers/tables
  const isMarkdown = useMemo(() => {
    if (
      artifact.mime_type === 'text/markdown' ||
      artifact.name.endsWith('.md') ||
      artifact.file_path.endsWith('.md')
    ) {
      return true
    }
    if (content) {
      const trimmed = content.trim()
      if (trimmed.startsWith('# ') || (content.includes('|') && /\|[\s-:]+\|/.test(content))) {
        return true
      }
    }
    return false
  }, [artifact, content])

  // View mode: default 'preview' for markdown, 'raw' for plain text/logs
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview')

  // Auto-switch to raw if not markdown, or preview if markdown
  useEffect(() => {
    if (isMarkdown) {
      setViewMode('preview')
    } else {
      setViewMode('raw')
    }
  }, [isMarkdown])

  const fileUrl = `/api/v1/artifacts/${artifact.id}`

  const downloadHref = useMemo(() => {
    if (initialContent !== undefined && initialContent !== null) {
      return `data:${artifact.mime_type || 'text/plain'};charset=utf-8,${encodeURIComponent(initialContent)}`
    }
    return fileUrl
  }, [initialContent, artifact.mime_type, fileUrl])

  // Sibling navigation
  const currentIndex = useMemo(
    () => artifacts.findIndex((a) => a.id === artifact.id),
    [artifacts, artifact.id]
  )
  const hasMultiple = artifacts.length > 1
  const prevArtifact = hasMultiple && currentIndex > 0 ? artifacts[currentIndex - 1] : null
  const nextArtifact =
    hasMultiple && currentIndex >= 0 && currentIndex < artifacts.length - 1
      ? artifacts[currentIndex + 1]
      : null

  // Fetch text content for non-images
  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent)
      setLoading(false)
      setError(null)
      return
    }

    if (isImage || isPdf) {
      setContent(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(fileUrl, { credentials: 'same-origin', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load artifact (HTTP ${res.status})`)
        }
        return res.text()
      })
      .then((text) => {
        setContent(text)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Error loading artifact content')
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [fileUrl, isImage, isPdf, initialContent])

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && prevArtifact && onSelect) {
        onSelect(prevArtifact)
      } else if (e.key === 'ArrowRight' && nextArtifact && onSelect) {
        onSelect(nextArtifact)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, prevArtifact, nextArtifact, onSelect])

  const handleCopy = useCallback(async () => {
    if (!content) return
    await copy(content, 'content')
  }, [content, copy])

  // Filtered lines for Raw view
  const rawLines = useMemo(() => {
    if (!content) return []
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    if (!searchQuery.trim()) return lines
    const query = searchQuery.toLowerCase()
    return lines.filter((l) => l.toLowerCase().includes(query))
  }, [content, searchQuery])

  const MAX_VISIBLE_RAW_LINES = 1000
  const isTruncated = rawLines.length > MAX_VISIBLE_RAW_LINES
  const displayLines = useMemo(
    () => (isTruncated ? rawLines.slice(0, MAX_VISIBLE_RAW_LINES) : rawLines),
    [rawLines, isTruncated]
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={artifact.name || artifact.id}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col h-full max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4">
          {/* Left: Metadata */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${
                artifact.role === 'INPUT'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/60'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
              }`}
            >
              {artifact.role}
            </span>
            <span className="font-semibold text-xs sm:text-sm text-zinc-100 truncate" title={artifact.name}>
              {artifact.name || artifact.id}
            </span>
            <span className="hidden sm:inline font-mono text-[10px] text-zinc-500">
              {(artifact.byte_size / 1024).toFixed(1)} KB · {isMarkdown ? 'markdown' : artifact.mime_type}
            </span>
          </div>

          {/* Center: Segmented Toggle (ONLY for Markdown documents) */}
          {isMarkdown && (
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
                  viewMode === 'preview'
                    ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Eye className="h-3.5 w-3.5 text-violet-400" />
                <span>Preview</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
                  viewMode === 'raw'
                    ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Code className="h-3.5 w-3.5 text-emerald-400" />
                <span>Raw</span>
              </button>
            </div>
          )}

          {/* Right: Actions & Navigation */}
          <div className="flex items-center gap-1.5 text-xs">
            {/* Sibling navigation counter */}
            {hasMultiple && (
              <div className="hidden sm:flex items-center gap-1 mr-1 text-[11px] font-mono text-zinc-500">
                <button
                  type="button"
                  disabled={!prevArtifact}
                  onClick={() => prevArtifact && onSelect?.(prevArtifact)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                  title="Previous Artifact (←)"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span>
                  {currentIndex + 1} / {artifacts.length}
                </span>
                <button
                  type="button"
                  disabled={!nextArtifact}
                  onClick={() => nextArtifact && onSelect?.(nextArtifact)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                  title="Next Artifact (→)"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Copy button */}
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-700 hover:text-white transition"
                title="Copy all content"
              >
                {isCopied('content') ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 text-zinc-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}

            {/* Download button */}
            <a
              href={downloadHref}
              download={artifact.name || artifact.id}
              className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-700 hover:text-emerald-400 transition"
              title="Download file"
            >
              <Download className="h-3 w-3" />
              <span className="hidden sm:inline">Download</span>
            </a>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-950 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition ml-1"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Sub-toolbar (Search & word-wrap in Raw mode) */}
        {(viewMode === 'raw' || !isMarkdown) && !isImage && !isPdf && content && (
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/40 px-4 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <Search className="h-3 w-3 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter lines..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 sm:w-60 bg-transparent text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none"
              />
              {searchQuery && (
                <span className="font-mono text-[10px] text-zinc-500">
                  {rawLines.length} match{rawLines.length === 1 ? '' : 'es'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setWordWrap(!wordWrap)}
              className={`flex items-center gap-1 text-[10px] font-mono transition ${
                wordWrap ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Toggle Word Wrap"
            >
              <WrapText className="h-3 w-3" />
              <span>Wrap: {wordWrap ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        )}

        {/* Modal Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-zinc-950 p-4 select-text">
          {loading && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              <span className="text-xs">Loading artifact stream…</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center p-8 text-center text-rose-400">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-xs font-semibold">{error}</p>
              <p className="text-[11px] text-zinc-500 mt-1">
                The artifact file may be inaccessible or removed from disk.
              </p>
            </div>
          )}

          {/* Image View */}
          {!loading && !error && isImage && (
            <div className="flex h-full min-h-[350px] w-full items-center justify-center bg-black/60 rounded-lg p-2 overflow-hidden">
              <img
                src={fileUrl}
                alt={artifact.name || artifact.id}
                className="max-h-[75vh] max-w-full object-contain rounded select-none shadow-lg"
              />
            </div>
          )}

          {/* PDF View */}
          {!loading && !error && isPdf && (
            <div className="h-full min-h-[500px] w-full rounded-lg overflow-hidden border border-zinc-800">
              <iframe src={fileUrl} className="h-full w-full" title={artifact.name} />
            </div>
          )}

          {/* Markdown Preview View */}
          {!loading && !error && !isImage && !isPdf && content !== null && isMarkdown && viewMode === 'preview' && (
            <div className="max-w-4xl mx-auto py-2 px-2">
              <MarkdownViewer content={content} />
            </div>
          )}

          {/* Raw View (For plain text/logs OR Markdown in Raw mode) */}
          {!loading && !error && !isImage && !isPdf && content !== null && (!isMarkdown || viewMode === 'raw') && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs overflow-hidden">
              <div className="overflow-x-auto p-2">
                <table className="w-full border-collapse">
                  <tbody>
                    {displayLines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="w-12 select-none pr-3 text-right text-[10px] text-zinc-600 font-mono align-top py-0.5">
                          {idx + 1}
                        </td>
                        <td
                          className={`text-zinc-300 py-0.5 select-text ${
                            wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                          }`}
                        >
                          {line || ' '}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isTruncated && (
                <div className="border-t border-zinc-800/80 bg-zinc-900/60 px-4 py-2.5 text-center text-xs text-zinc-400">
                  <span>
                    Showing first {MAX_VISIBLE_RAW_LINES.toLocaleString()} of {rawLines.length.toLocaleString()} lines.{' '}
                  </span>
                  <span className="text-zinc-500">
                    Filter via search bar or download full artifact to view all lines.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Binary or Unknown fallback */}
          {!loading && !error && !isImage && !isPdf && content === null && (
            <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-400">
              <FileText className="h-10 w-10 text-zinc-600 mb-3" />
              <p className="text-sm font-semibold text-zinc-200">{artifact.name || artifact.id}</p>
              <p className="text-xs text-zinc-500 mt-1">Binary or unsupported inline preview format</p>
              <div className="mt-4 flex items-center gap-3 font-mono text-[11px] text-zinc-500">
                <span>{(artifact.byte_size / 1024).toFixed(1)} KB</span>
                {artifact.sha256 && <span>SHA: {artifact.sha256.slice(0, 12)}…</span>}
              </div>
              <a
                href={fileUrl}
                download={artifact.name || artifact.id}
                className="mt-6 flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition shadow"
              >
                <Download className="h-4 w-4" />
                <span>Download File</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
