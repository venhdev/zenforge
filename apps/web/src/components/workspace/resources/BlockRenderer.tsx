import React, { useMemo } from 'react'
import {
  Check,
  Code2,
  Copy,
  Layout,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { MarkdownViewer } from '../../../lib/markdownRenderer'
import type { ResourceBlock } from '../../../types/contracts'

export interface BlockRendererProps {
  block: ResourceBlock
  onCopy: (txt: string) => void
  isCopied: boolean
}

/**
 * Interactive visualizer for structured ResourceBlock entries (diagram, bash, fixture, wireframe, code, text).
 */
export const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  onCopy,
  isCopied,
}) => {
  const content = useMemo(() => {
    if (!block.data) return ''
    if (typeof block.data === 'string') return block.data
    try {
      return JSON.stringify(block.data, null, 2)
    } catch {
      return String(block.data)
    }
  }, [block.data])

  switch (block.type) {
    case 'diagram':
      return (
        <div className="my-4 rounded-xl border border-sky-500/30 bg-sky-950/10 p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-sky-500/20 pb-2 mb-3">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-400">
              <Sparkles className="h-3.5 w-3.5" /> Diagram ({block.format || 'mermaid'})
            </span>
            <button
              onClick={() => onCopy(content)}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>Source</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-zinc-950/80 p-3 font-mono text-xs text-sky-200">
            <code>{content}</code>
          </pre>
        </div>
      )

    case 'bash':
      return (
        <div className="my-4 rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
              <Terminal className="h-3.5 w-3.5" />
              {block.metadata?.executable ? 'executable bash script' : 'shell command'}
            </span>
            <button
              onClick={() => onCopy(content)}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white hover:bg-zinc-700"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>Copy</span>
            </button>
          </div>
          <pre className="overflow-x-auto p-3.5 font-mono text-xs text-emerald-300 leading-relaxed">
            <code>{content}</code>
          </pre>
        </div>
      )

    case 'fixture':
      return (
        <div className="my-4 rounded-xl border border-cyan-500/30 bg-zinc-950 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-cyan-500/20 bg-cyan-950/20 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-cyan-400">
              <Code2 className="h-3.5 w-3.5" /> Test Fixture ({block.format || 'json'})
            </span>
            <button
              onClick={() => onCopy(content)}
              className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>Copy</span>
            </button>
          </div>
          <pre className="overflow-x-auto p-3.5 font-mono text-xs text-cyan-200 leading-relaxed">
            <code>{content}</code>
          </pre>
        </div>
      )

    case 'wireframe':
      return (
        <div className="my-4 rounded-xl border border-indigo-500/30 bg-zinc-950 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-indigo-500/20 bg-indigo-950/20 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-400">
              <Layout className="h-3.5 w-3.5" /> ASCII Wireframe Canvas
            </span>
            <button
              onClick={() => onCopy(content)}
              className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>Copy</span>
            </button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs text-indigo-200 leading-none tracking-tight">
            <code>{content}</code>
          </pre>
        </div>
      )

    case 'code':
      return (
        <div className="my-4 rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
            <span className="font-mono text-[10px] uppercase text-zinc-400">
              {block.format}
            </span>
            <button
              onClick={() => onCopy(content)}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>Copy</span>
            </button>
          </div>
          <pre className="overflow-x-auto p-3.5 font-mono text-xs text-zinc-300 leading-relaxed">
            <code>{content}</code>
          </pre>
        </div>
      )

    case 'text':
    default:
      return <MarkdownViewer content={content} />
  }
}
