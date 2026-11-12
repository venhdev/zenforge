import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ScrollText,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pin,
  X,
} from 'lucide-react'
import type { EventMessage } from '../../types/contracts'
import { formatEvent, toneClass, toneBadgeClass } from '../../lib/eventFormatter'
import { useZenfAPI } from '../../hooks/useZenfAPI'

export interface LiveLogProps {
  /** Increments on every SSE event, including the daemon's state:changed. */
  tick: number
  variant?: 'sidebar' | 'drawer'
  dockLocation?: 'sidebar' | 'bottom'
  onToggleDock?: () => void
  onClose?: () => void
}

function formatTime(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString(undefined, { hour12: false })
}

function formatPayloadPreview(raw?: any): string | null {
  if (!raw) return null
  if (typeof raw === 'object') {
    if (Object.keys(raw).length === 0) return null
    return JSON.stringify(raw)
  }
  const trimmed = String(raw).trim()
  if (!trimmed || trimmed === '{}' || trimmed === '[]') return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      if (Object.keys(parsed).length === 0) return null
      return JSON.stringify(parsed)
    }
    return String(parsed)
  } catch {
    return trimmed
  }
}

export const LiveLog: React.FC<LiveLogProps> = ({
  tick,
  variant = 'sidebar',
  dockLocation: _dockLocation = 'sidebar',
  onToggleDock,
  onClose,
}) => {
  const [events, setEvents] = useState<EventMessage[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [pinned, setPinned] = useState(true)
  const lastIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { fetchEvents } = useZenfAPI()

  const load = useCallback(async (initial: boolean) => {
    try {
      const afterId = initial ? 0 : lastIdRef.current
      const res = await fetchEvents(afterId, 80)
      if (!res.ok) return
      const batch = res.data
      if (!Array.isArray(batch) || batch.length === 0) return

      const newest = batch[batch.length - 1].id
      if (newest > lastIdRef.current) lastIdRef.current = newest

      setEvents((prev) => (initial ? batch : [...prev, ...batch]).slice(-300))
    } catch {
      // The daemon may be restarting; the next tick retries.
    }
  }, [fetchEvents])

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (tick > 0) void load(false)
  }, [tick, load])

  useEffect(() => {
    const node = scrollRef.current
    if (node && pinned) {
      node.scrollTop = node.scrollHeight
    }
  }, [events, pinned])

  const handleScroll = () => {
    const node = scrollRef.current
    if (!node) return
    const isAtBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    if (isAtBottom !== pinned) {
      setPinned(isAtBottom)
    }
  }

  const togglePinned = () => {
    setPinned((prev) => {
      const next = !prev
      if (next && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      return next
    })
  }

  const isDrawer = variant === 'drawer'

  if (isDrawer) {
    return (
      <section className="flex h-full w-full flex-col border-t border-zinc-800 bg-zinc-950 font-sans">
        {/* Header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <ScrollText className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="text-xs font-semibold tracking-wide text-zinc-300 truncate">
              Live Stream
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[10px] text-zinc-400 shrink-0">
              {events.length}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={togglePinned}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
                pinned
                  ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title={pinned ? 'Auto-scroll pinned' : 'Auto-scroll unpinned'}
              aria-label="Toggle auto-scroll pin"
            >
              <Pin className={`h-3 w-3 ${pinned ? 'fill-emerald-400' : ''}`} />
            </button>

            {onToggleDock && (
              <button
                type="button"
                onClick={() => onToggleDock()}
                className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer"
                title="Dock to Sidebar"
                aria-label="Dock to Sidebar"
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                <span>Dock to Sidebar</span>
              </button>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
                title="Close"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Console Body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-2 font-mono space-y-0.5"
        >
          {events.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-600">// waiting for activity</div>
          ) : (
            events.map((evt) => {
              const summary = formatEvent(evt)
              const payloadPreview = formatPayloadPreview(evt.payload)
              return (
                <div
                  key={evt.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-900/60 transition-colors group cursor-default"
                  title={payloadPreview ? `${summary.text}\nPayload: ${payloadPreview}` : summary.text}
                >
                  <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">
                    {formatTime(evt.timestamp)}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1 py-0.2 text-[9px] font-mono font-bold uppercase tracking-wider ${
                      toneBadgeClass[summary.tone] || 'border-zinc-700 bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {evt.entity_type || 'system'}
                  </span>
                  <span
                    className={`truncate font-mono text-[11.5px] ${toneClass[summary.tone]}`}
                  >
                    {summary.text}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </section>
    )
  }

  // Sidebar variant (default)
  return (
    <section className="flex h-1/4 min-h-[120px] flex-col border-t border-zinc-800 bg-zinc-950/80">
      <div className="flex h-8 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <ScrollText className="h-3.5 w-3.5 text-emerald-400" />
          <span>Live Log</span>
          <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
            {events.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onToggleDock && (
            <button
              type="button"
              onClick={() => onToggleDock()}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
              title="Dock to Bottom"
              aria-label="Dock to Bottom"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
            title={collapsed ? 'Expand live log' : 'Collapse live log'}
            aria-label={collapsed ? 'Expand live log' : 'Collapse live log'}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-2 pb-2 font-mono text-[10.5px] leading-relaxed"
        >
          {events.length === 0 ? (
            <div className="px-1 py-2 text-zinc-600">// waiting for activity</div>
          ) : (
            events.map((evt) => {
              const summary = formatEvent(evt)
              return (
                <div key={evt.id} className="flex gap-2 whitespace-nowrap">
                  <span className="shrink-0 text-zinc-600">{formatTime(evt.timestamp)}</span>
                  <span className={`truncate ${toneClass[summary.tone]}`} title={summary.text}>
                    {summary.text}
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}
