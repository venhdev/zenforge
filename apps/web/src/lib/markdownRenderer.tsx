import React, { useMemo } from 'react'
import { useClipboardCopy } from '../hooks/useClipboardCopy'
import {
  Check,
  Copy,
  Info,
  AlertTriangle,
  Lightbulb,
  AlertOctagon,
  Zap,
  ShieldCheck,
} from 'lucide-react'

export interface TaskContextData {
  taskId: string
  title: string
  projectSlug: string
  planSlug: string
  priority: string
  complexity: string
  riskLevel: string
}

const TASK_TAG_REGEXES = {
  taskId: /<task_id>([\s\S]*?)<\/task_id>/i,
  title: /<title>([\s\S]*?)<\/title>/i,
  projectSlug: /<project_slug>([\s\S]*?)<\/project_slug>/i,
  planSlug: /<plan_slug>([\s\S]*?)<\/plan_slug>/i,
  priority: /<priority>([\s\S]*?)<\/priority>/i,
  complexity: /<complexity>([\s\S]*?)<\/complexity>/i,
  riskLevel: /<risk_level>([\s\S]*?)<\/risk_level>/i,
}

export function parseTaskContextBlock(xmlBlock: string): TaskContextData {
  const getTagValue = (re: RegExp) => {
    const match = xmlBlock.match(re)
    return match ? match[1].trim() : ''
  }

  return {
    taskId: getTagValue(TASK_TAG_REGEXES.taskId),
    title: getTagValue(TASK_TAG_REGEXES.title),
    projectSlug: getTagValue(TASK_TAG_REGEXES.projectSlug),
    planSlug: getTagValue(TASK_TAG_REGEXES.planSlug),
    priority: getTagValue(TASK_TAG_REGEXES.priority),
    complexity: getTagValue(TASK_TAG_REGEXES.complexity),
    riskLevel: getTagValue(TASK_TAG_REGEXES.riskLevel),
  }
}

export const TaskSpecificationCard: React.FC<{ data: TaskContextData }> = ({ data }) => {
  const { isCopied, copy } = useClipboardCopy()

  const handleCopy = async () => {
    if (!data.taskId) return
    await copy(data.taskId, 'taskId')
  }

  const getPriorityStyle = (priority: string) => {
    const p = priority.toUpperCase()
    if (p === 'P0') return 'border-rose-500/40 bg-rose-950/40 text-rose-300'
    if (p === 'P1') return 'border-amber-500/40 bg-amber-950/40 text-amber-300'
    if (p === 'P2') return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
    return 'border-zinc-700 bg-zinc-800 text-zinc-300'
  }

  return (
    <div className="my-3.5 rounded-xl border border-violet-500/30 bg-violet-950/20 p-3.5 shadow-sm select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-violet-500/20 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Zap className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-violet-300">
            TASK SPECIFICATION
          </span>
        </div>
        {data.taskId && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-violet-500/25 bg-violet-900/30 px-2 py-1 text-[11px] font-mono text-violet-300 hover:bg-violet-900/50 hover:text-white transition"
            title="Copy Task ID"
          >
            {isCopied('taskId') ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400 font-sans">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span className="font-sans">Copy ID</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Title */}
      {data.title && (
        <h3 className="text-sm font-semibold text-zinc-100 mb-2 leading-snug">
          {data.title}
        </h3>
      )}

      {/* Task ID */}
      {data.taskId && (
        <div className="mb-3 flex items-center gap-1.5 font-mono text-xs">
          <span className="text-zinc-500 select-none text-[11px]">ID:</span>
          <span className="rounded bg-violet-950/60 px-2 py-0.5 border border-violet-500/20 font-semibold text-violet-300 select-all">
            {data.taskId}
          </span>
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
        {data.priority && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold border ${getPriorityStyle(
              data.priority
            )}`}
          >
            {data.priority.toUpperCase()}
          </span>
        )}
        {data.projectSlug && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900/80 text-zinc-300">
            <span className="text-zinc-500 text-[10px]">project:</span>
            <span className="font-medium text-zinc-200">{data.projectSlug}</span>
          </span>
        )}
        {data.planSlug && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900/80 text-zinc-300">
            <span className="text-zinc-500 text-[10px]">plan:</span>
            <span className="font-medium text-zinc-200">{data.planSlug}</span>
          </span>
        )}
        {data.complexity && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400">
            <span className="text-zinc-500 text-[10px]">complexity:</span>
            <span className="text-zinc-300">{data.complexity}</span>
          </span>
        )}
        {data.riskLevel && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400">
            <span className="text-zinc-500 text-[10px]">risk:</span>
            <span className="text-zinc-300">{data.riskLevel}</span>
          </span>
        )}
      </div>
    </div>
  )
}

export function ensureProtocolCodeSpans(text: string): string {
  // Wrap claim_task, transition_task, review in code backticks if not already enclosed
  return text.replace(
    /(`[^`]+`)|(\b(?:claim_task|transition_task|review)(?:\([^)]*\))?\b)/g,
    (_match, codeSpan, bareKeyword) => {
      if (codeSpan) return codeSpan
      return `\`${bareKeyword}\``
    }
  )
}

export const AgentHandshakeProtocolBox: React.FC<{ lines: string[] }> = ({ lines }) => {
  const cleanLines = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^<\/?mcp_handshake_protocol/i.test(l))

  return (
    <div className="my-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3.5 shadow-sm select-text">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-cyan-500/20 pb-2 mb-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-500/30">
          <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
          AGENT HANDSHAKE PROTOCOL
        </span>
      </div>

      {/* Bullet Points */}
      <div className="space-y-2">
        {cleanLines.map((line, idx) => {
          const isBullet = /^(\s*[-*]|\s*\d+\.)\s+/.test(line)
          const text = isBullet ? line.replace(/^(\s*[-*]|\s*\d+\.)\s+/, '') : line
          return (
            <div key={idx} className="flex items-start gap-2.5 text-xs text-zinc-300">
              <span className="font-mono text-cyan-400 text-[10px] select-none mt-0.5 shrink-0">❖</span>
              <div className="flex-1 leading-relaxed">
                {renderInlineMarkdown(ensureProtocolCodeSpans(text))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function isStandaloneXmlTag(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^<br\s*\/?>$/i.test(trimmed)) return false
  return /^<\/?([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s+[^>]*)?\/?>$/.test(trimmed)
}

export function unwrapDirectiveTags(text: string): string {
  let unwrapped = text.trim()
  let prev = ''
  while (unwrapped !== prev) {
    prev = unwrapped
    const match = unwrapped.match(/^<([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>$/)
    if (match) {
      unwrapped = match[2].trim()
    } else {
      break
    }
  }
  return unwrapped
}

// CopyButton helper for code fences
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const { isCopied, copy } = useClipboardCopy()

  const handleCopy = async () => {
    await copy(code, 'code')
  }

  return (
    <div className="relative my-3.5 rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs overflow-hidden shadow-sm">
      <div className="flex h-7 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/70 px-3 text-[11px] text-zinc-400">
        <span className="font-semibold uppercase tracking-wider text-zinc-400 text-[10px]">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition"
          title="Copy code"
        >
          {isCopied('code') ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-zinc-300 leading-relaxed select-text">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// Inline formatting: handles `code`, **bold**, *italic*, [link](url), and <br>
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  // First handle <br> or <br/> tags by splitting into sub-fragments
  const brSegments = text.split(/<br\s*\/?>/gi)
  const resultNodes: React.ReactNode[] = []

  brSegments.forEach((segment, sIdx) => {
    if (sIdx > 0) {
      resultNodes.push(<br key={`br-${sIdx}`} />)
    }

    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(segment)) !== null) {
      if (match.index > lastIndex) {
        resultNodes.push(segment.slice(lastIndex, match.index))
      }

      const token = match[0]
      if (token.startsWith('`') && token.endsWith('`')) {
        const codeContent = token.slice(1, -1)
        const isProtocolAction = /\b(claim_task|transition_task|review)\b/.test(codeContent)
        resultNodes.push(
          <code
            key={`${sIdx}-${match.index}`}
            className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
              isProtocolAction
                ? 'border-cyan-500/40 bg-cyan-950/60 text-cyan-200 font-semibold'
                : 'border-zinc-800 bg-zinc-900 text-violet-300'
            }`}
          >
            {codeContent}
          </code>
        )
      } else if (token.startsWith('**') && token.endsWith('**')) {
        resultNodes.push(
          <strong key={`${sIdx}-${match.index}`} className="font-semibold text-zinc-100">
            {token.slice(2, -2)}
          </strong>
        )
      } else if (token.startsWith('*') && token.endsWith('*')) {
        resultNodes.push(
          <em key={`${sIdx}-${match.index}`} className="italic text-zinc-300">
            {token.slice(1, -1)}
          </em>
        )
      } else if (token.startsWith('[') && token.includes('](')) {
        const linkEnd = token.indexOf('](')
        const label = token.slice(1, linkEnd)
        const url = token.slice(linkEnd + 2, -1)
        resultNodes.push(
          <a
            key={`${sIdx}-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 underline underline-offset-2 hover:text-violet-300 transition"
          >
            {label}
          </a>
        )
      } else {
        resultNodes.push(token)
      }

      lastIndex = pattern.lastIndex
    }

    if (lastIndex < segment.length) {
      resultNodes.push(segment.slice(lastIndex))
    }
  })

  return resultNodes.length > 0 ? resultNodes : [text]
}

// Escaped pipe helper: replaces \| with a safe placeholder before splitting by |
const PIPE_PLACEHOLDER = '\u0000PIPE\u0000'
const PIPE_RE = new RegExp(PIPE_PLACEHOLDER, 'g')

function parseTableLine(line: string): string[] {
  const trimmed = line.trim()
  // Replace escaped pipes \| with placeholder
  const safeLine = trimmed.replace(/\\\|/g, PIPE_PLACEHOLDER)
  const content = safeLine.replace(/^\|/, '').replace(/\|$/, '')
  return content.split('|').map((c) => c.replace(PIPE_RE, '|').trim())
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = parseTableLine(trimmed)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

function getTableAlignments(delimiterLine: string): ('left' | 'center' | 'right')[] {
  const cells = parseTableLine(delimiterLine)
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

export const MarkdownViewer = React.memo(function MarkdownViewer({ content }: { content: string }) {
  const elements = useMemo(() => {
    if (!content) return null

    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const elements: React.ReactNode[] = []
    let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 1. Code fence: ```lang
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(<CodeBlock key={`code-${i}`} code={codeLines.join('\n')} language={lang} />)
      i++
      continue
    }

    // 1.5. Task Context XML directive: <task_context> ... </task_context>
    if (/^\s*<task_context(?:\s+[^>]*)?>/i.test(line)) {
      const blockLines: string[] = []
      while (i < lines.length) {
        blockLines.push(lines[i])
        if (/<\/task_context>/i.test(lines[i])) {
          i++
          break
        }
        i++
      }
      const blockContent = blockLines.join('\n')
      const taskData = parseTaskContextBlock(blockContent)
      elements.push(<TaskSpecificationCard key={`task-spec-${i}`} data={taskData} />)
      continue
    }

    // 1.6. MCP Handshake Protocol XML directive: <mcp_handshake_protocol> ... </mcp_handshake_protocol>
    if (/^\s*<mcp_handshake_protocol(?:\s+[^>]*)?>/i.test(line)) {
      const blockLines: string[] = []
      while (i < lines.length) {
        blockLines.push(lines[i])
        if (/<\/mcp_handshake_protocol>/i.test(lines[i])) {
          i++
          break
        }
        i++
      }
      elements.push(<AgentHandshakeProtocolBox key={`protocol-${i}`} lines={blockLines} />)
      continue
    }

    // 1.7. Standalone XML tags (e.g. <context>, </context>, <scope>, </scope>, etc.): unwrap/skip line
    if (isStandaloneXmlTag(line)) {
      i++
      continue
    }

    // 2. Headings (# H1, ## H2, ### H3, #### H4)
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      if (match) {
        const level = match[1].length
        const headingText = match[2]
        if (level === 1) {
          elements.push(
            <h1
              key={`h1-${i}`}
              className="mt-6 mb-3 text-base font-bold text-zinc-100 flex items-center gap-2 pb-2 border-b border-zinc-800"
            >
              <span className="h-2 w-2 rounded-full bg-violet-400 shrink-0" />
              {renderInlineMarkdown(headingText)}
            </h1>
          )
        } else if (level === 2) {
          elements.push(
            <h2
              key={`h2-${i}`}
              className="mt-5 mb-2.5 pb-1.5 border-b border-zinc-800/80 text-sm font-bold text-zinc-100"
            >
              {renderInlineMarkdown(headingText)}
            </h2>
          )
        } else if (level === 3) {
          elements.push(
            <h3 key={`h3-${i}`} className="mt-3.5 mb-1.5 text-xs font-bold text-zinc-200">
              {renderInlineMarkdown(headingText)}
            </h3>
          )
        } else {
          elements.push(
            <h4 key={`h4-${i}`} className="mt-2.5 mb-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {renderInlineMarkdown(headingText)}
            </h4>
          )
        }
        i++
        continue
      }
    }

    // 3. Horizontal Rule
    if (/^(---|___|\*\*\*)$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="my-4 border-zinc-800/80" />)
      i++
      continue
    }

    // 4. Blockquote / Alerts
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      const fullQuote = quoteLines.join(' ')
      const isTip = fullQuote.startsWith('[!TIP]')
      const isWarning = fullQuote.startsWith('[!WARNING]')
      const isCaution = fullQuote.startsWith('[!CAUTION]') || fullQuote.startsWith('[!IMPORTANT]')
      const isNote = fullQuote.startsWith('[!NOTE]')
      const cleanQuote = fullQuote.replace(/^\[!(NOTE|WARNING|CAUTION|TIP|IMPORTANT)\]\s?/, '')

      let borderColor = 'border-violet-500 bg-violet-950/20 text-zinc-300'
      let AlertIcon = Info
      let label = 'NOTE'

      if (isTip) {
        borderColor = 'border-emerald-500 bg-emerald-950/20 text-emerald-200'
        AlertIcon = Lightbulb
        label = 'TIP'
      } else if (isWarning) {
        borderColor = 'border-amber-500 bg-amber-950/20 text-amber-200'
        AlertIcon = AlertTriangle
        label = 'WARNING'
      } else if (isCaution) {
        borderColor = 'border-rose-500 bg-rose-950/20 text-rose-200'
        AlertIcon = AlertOctagon
        label = 'IMPORTANT'
      } else if (isNote) {
        borderColor = 'border-cyan-500 bg-cyan-950/20 text-cyan-200'
        AlertIcon = Info
        label = 'NOTE'
      }

      elements.push(
        <div
          key={`quote-${i}`}
          className={`my-3 rounded-r-lg border-l-4 p-3 text-xs select-text shadow-sm ${borderColor}`}
        >
          {(isTip || isWarning || isCaution || isNote) && (
            <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] tracking-wider mb-1">
              <AlertIcon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </div>
          )}
          <div className="leading-relaxed">{renderInlineMarkdown(cleanQuote)}</div>
        </div>
      )
      continue
    }

    // 5. GFM Tables
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const headers = parseTableLine(line)
      const alignments = getTableAlignments(lines[i + 1])
      i += 2 // skip header and delimiter

      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableLine(lines[i]))
        i++
      }

      elements.push(
        <div
          key={`table-${i}`}
          className="my-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-md"
        >
          <table className="w-full border-collapse text-left text-xs font-sans">
            <thead className="border-b border-zinc-700/80 bg-zinc-900/95 text-zinc-100">
              <tr>
                {headers.map((h, hIdx) => {
                  const align = alignments[hIdx] || 'left'
                  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
                  return (
                    <th key={hIdx} className={`px-3.5 py-2.5 font-bold tracking-wide ${alignClass}`}>
                      {renderInlineMarkdown(h)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-zinc-900/20 hover:bg-zinc-800/40 transition-colors">
                  {headers.map((_, cIdx) => {
                    const cellVal = row[cIdx] || ''
                    const align = alignments[cIdx] || 'left'
                    const alignClass =
                      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
                    return (
                      <td key={cIdx} className={`px-3.5 py-2 text-zinc-300 leading-relaxed ${alignClass}`}>
                        {renderInlineMarkdown(cellVal)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 6. Lists (- item, * item, 1. item)
    if (/^(\s*[-*]|\s*\d+\.)\s+/.test(line)) {
      const listItems: string[] = []
      const isOrdered = /^\s*\d+\.\s+/.test(line)
      while (i < lines.length && /^(\s*[-*]|\s*\d+\.)\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^(\s*[-*]|\s*\d+\.)\s+/, ''))
        i++
      }

      elements.push(
        <ul key={`list-${i}`} className="my-2 space-y-1.5 pl-4 text-xs text-zinc-300">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="font-mono text-violet-400 text-[10px] select-none mt-0.5 shrink-0">
                {isOrdered ? `${idx + 1}.` : '•'}
              </span>
              <div className="flex-1 leading-relaxed">
                {renderInlineMarkdown(unwrapDirectiveTags(item))}
              </div>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // 7. Regular paragraph / empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Accumulate consecutive paragraph lines
    const pLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !/^(---|___|\*\*\*)$/.test(lines[i].trim()) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) &&
      !/^(\s*[-*]|\s*\d+\.)\s+/.test(lines[i]) &&
      !/^\s*<task_context(?:\s+[^>]*)?>/i.test(lines[i]) &&
      !/^\s*<mcp_handshake_protocol(?:\s+[^>]*)?>/i.test(lines[i]) &&
      !isStandaloneXmlTag(lines[i])
    ) {
      pLines.push(lines[i])
      i++
    }

    const pText = unwrapDirectiveTags(pLines.join(' '))
    if (pText) {
      elements.push(
        <p key={`p-${i}`} className="my-2 text-xs text-zinc-300 leading-relaxed select-text">
          {renderInlineMarkdown(pText)}
        </p>
      )
    }
  }

  return elements
  }, [content])

  if (!content) {
    return <div className="text-zinc-500 italic p-4 text-xs">(empty document)</div>
  }

  return <div className="space-y-1 font-sans">{elements}</div>
})
