import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  GripVertical,
  Minus,
  Square,
  Minimize2,
  Maximize2,
  X,
  ExternalLink,
  Bot,
  Zap,
  Clock,
  Radio,
} from 'lucide-react'
import type { Task } from '../../types/contracts'

export interface FloatingHUDProps {
  tasks: Task[]
  visible: boolean
  onClose: () => void
  onSelectTask?: (task: Task) => void
}

type HUDMode = 'stack' | 'pill'

interface Size {
  width: number
  height: number
}

const MIN_WIDTH = 260
const MAX_WIDTH = 650
const MIN_HEIGHT = 100
const MAX_HEIGHT = 550

const DEFAULT_SIZE: Size = { width: 340, height: 160 }
const EXPANDED_SIZE: Size = { width: 480, height: 320 }

function formatDuration(updatedAt: string, now: number): string {
  const start = new Date(updatedAt).getTime()
  if (isNaN(start) || start <= 0) return '00:00'
  const diffSec = Math.max(0, Math.floor((now - start) / 1000))
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const remM = m % 60
    return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  tasks,
  visible,
  onClose,
  onSelectTask,
}) => {
  const [mode, setMode] = useState<HUDMode>(() => {
    try {
      const saved = localStorage.getItem('zenf_hud_mode')
      return saved === 'pill' ? 'pill' : 'stack'
    } catch {
      return 'stack'
    }
  })

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('zenf_hud_pos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          return parsed
        }
      }
    } catch {
      // ignore
    }
    const defaultX = typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 380) : 800
    return { x: defaultX, y: 68 }
  })

  const [size, setSize] = useState<Size>(() => {
    try {
      const saved = localStorage.getItem('zenf_hud_size')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          return {
            width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width)),
            height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parsed.height)),
          }
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_SIZE
  })

  const [now, setNow] = useState(() => Date.now())
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const resizeStartRef = useRef<{ pointerX: number; pointerY: number; startWidth: number; startHeight: number } | null>(null)
  const hudRef = useRef<HTMLDivElement | null>(null)

  const runningTasks = useMemo(
    () => tasks.filter((t) => t.status === 'RUNNING').slice(0, 5),
    [tasks]
  )

  const totalRunning = useMemo(
    () => tasks.filter((t) => t.status === 'RUNNING').length,
    [tasks]
  )

  // Runtime ticker interval: only run when at least 1 task is RUNNING
  useEffect(() => {
    if (runningTasks.length === 0) return

    setNow(Date.now())
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [runningTasks.length])

  // Save mode changes
  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'stack' ? 'pill' : 'stack'
      try {
        localStorage.setItem('zenf_hud_mode', next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  // Toggle Maximize / Restore size in Stack mode
  const toggleMaximizeSize = useCallback(() => {
    setSize((prev) => {
      const isCurrentlyExpanded = prev.width >= EXPANDED_SIZE.width && prev.height >= EXPANDED_SIZE.height
      const next = isCurrentlyExpanded ? DEFAULT_SIZE : EXPANDED_SIZE
      try {
        localStorage.setItem('zenf_hud_size', JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  // Pointer drag handling for moving window
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Prevent dragging when clicking buttons, inputs, or resize handle
    if ((e.target as HTMLElement).closest('button, [data-resize-handle]')) {
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    }
  }, [pos.x, pos.y])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.pointerX
    const dy = e.clientY - dragStartRef.current.pointerY
    const newX = Math.max(8, Math.min(window.innerWidth - 120, dragStartRef.current.startX + dx))
    const newY = Math.max(8, Math.min(window.innerHeight - 40, dragStartRef.current.startY + dy))
    setPos({ x: newX, y: newY })
  }, [isDragging])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    setIsDragging(false)
    dragStartRef.current = null
    try {
      localStorage.setItem('zenf_hud_pos', JSON.stringify(pos))
    } catch {
      // ignore
    }
  }, [isDragging, pos])

  // Pointer drag handling for resizing window
  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsResizing(true)
    resizeStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startWidth: size.width,
      startHeight: size.height,
    }
  }, [size.width, size.height])

  const handleResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing || !resizeStartRef.current) return
    const dx = e.clientX - resizeStartRef.current.pointerX
    const dy = e.clientY - resizeStartRef.current.pointerY
    const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartRef.current.startWidth + dx))
    const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resizeStartRef.current.startHeight + dy))
    setSize({ width: newW, height: newH })
  }, [isResizing])

  const handleResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    setIsResizing(false)
    resizeStartRef.current = null
    try {
      localStorage.setItem('zenf_hud_size', JSON.stringify(size))
    } catch {
      // ignore
    }
  }, [isResizing, size])

  if (!visible) return null

  const isExpanded = size.width >= EXPANDED_SIZE.width && size.height >= EXPANDED_SIZE.height

  return (
    <div
      ref={hudRef}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
      }}
      className={`fixed top-0 left-0 z-50 select-none transition-shadow duration-200 ${
        isDragging
          ? 'cursor-grabbing opacity-95 shadow-[0_16px_48px_rgba(0,0,0,0.85)]'
          : 'shadow-[0_8px_32px_rgba(0,0,0,0.65)]'
      }`}
    >
      {mode === 'pill' ? (
        /* --- MODE 1: Ultra-Compact Pill Capsule --- */
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1.5 backdrop-blur-md ring-1 ring-violet-500/30 text-xs font-mono text-zinc-200 cursor-grab active:cursor-grabbing hover:border-violet-500/50 transition-colors"
        >
          <GripVertical className="h-3.5 w-3.5 text-zinc-500 shrink-0" />

          {totalRunning > 0 ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {totalRunning} RUNNING
              </span>
              <span className="text-zinc-600">│</span>
              <span className="max-w-[130px] truncate font-medium text-zinc-300">
                {runningTasks[0]?.id}
              </span>
              <span className="text-violet-400 font-semibold">
                ⏱ {formatDuration(runningTasks[0]?.updated_at, now)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Radio className="h-3 w-3 text-zinc-500" />
              <span>0 RUNNING · IDLE</span>
            </div>
          )}

          <div className="flex items-center gap-1 pl-1 border-l border-zinc-800 shrink-0">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleMode}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              title="Expand HUD Stack"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition"
              title="Close HUD"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        /* --- MODE 2: Stack Capsule (Resizable Card) --- */
        <div
          style={{
            width: `${size.width}px`,
            height: `${size.height}px`,
          }}
          className="relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/90 p-2.5 backdrop-blur-md ring-1 ring-violet-500/25"
        >
          {/* Header & Drag Handle */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="flex items-center justify-between border-b border-zinc-800/80 pb-2 cursor-grab active:cursor-grabbing shrink-0"
          >
            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-zinc-200 min-w-0">
              <GripVertical className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <Zap className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400 shrink-0" />
              <span className="truncate">ACTIVE RUNNING</span>
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-300 font-bold border border-emerald-500/30 shrink-0">
                {totalRunning}
              </span>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {/* 1. Minimize to Pill Button */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={toggleMode}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                title="Minimize to Pill"
              >
                <Minus className="h-3 w-3" />
              </button>

              {/* 2. Maximize / Restore Size Button */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={toggleMaximizeSize}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                title={isExpanded ? 'Restore Normal Size' : 'Maximize Size'}
              >
                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Square className="h-3 w-3" />}
              </button>

              {/* 3. Close Button */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition"
                title="Close HUD"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Running Tasks List (Scrollable without ugly native scrollbars) */}
          <div className="mt-2 flex-1 overflow-y-auto space-y-1.5 pr-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {runningTasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center py-2 px-1 overflow-hidden select-none">
                <Clock className="h-5 w-5 text-zinc-600 mb-1 shrink-0" />
                <span className="text-xs font-mono text-zinc-400">All tasks idle</span>
                {size.height >= 125 && (
                  <span className="text-[10px] text-zinc-600 mt-0.5 truncate max-w-[240px]">
                    Autonomous runs will stream here live.
                  </span>
                )}
              </div>
            ) : (
              runningTasks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onSelectTask?.(t)}
                  className="group flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2 hover:border-violet-500/50 hover:bg-zinc-900 transition-all cursor-pointer"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span
                        className="truncate font-mono text-xs font-semibold text-zinc-100 group-hover:text-violet-300 transition-colors"
                        title={t.id}
                      >
                        {t.id}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-400 font-mono">
                      <Bot className="h-3 w-3 text-violet-400 shrink-0" />
                      <span className="truncate">{t.claimed_by || 'orchestrator'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded bg-violet-950/60 border border-violet-800/40 px-1.5 py-0.5 font-mono text-[11px] font-bold text-violet-300">
                      ⏱ {formatDuration(t.updated_at, now)}
                    </span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectTask?.(t)
                      }}
                      className="rounded p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 transition"
                      title="Focus Task in Cockpit"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer if more than 5 tasks are running */}
          {totalRunning > 5 && (
            <div className="mt-1 flex items-center justify-between border-t border-zinc-800/60 pt-1.5 text-[10px] font-mono text-zinc-400 px-1 shrink-0">
              <span>+{totalRunning - 5} more running in background...</span>
              <span className="text-violet-400 font-semibold">5 / {totalRunning}</span>
            </div>
          )}

          {/* Bottom-Right Corner Resize Grip Handle */}
          <div
            data-resize-handle="true"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            className="absolute bottom-1 right-1 cursor-se-resize p-1 text-zinc-600 hover:text-violet-400 active:text-violet-300 transition"
            title="Drag to resize HUD window"
          >
            <svg
              className="h-3 w-3 opacity-60 hover:opacity-100"
              viewBox="0 0 10 10"
              fill="currentColor"
            >
              <circle cx="8" cy="8" r="1.1" />
              <circle cx="8" cy="4" r="1.1" />
              <circle cx="4" cy="8" r="1.1" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
