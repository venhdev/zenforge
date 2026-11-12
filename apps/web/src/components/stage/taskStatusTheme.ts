import React from 'react'
import {
  CheckCircle2,
  PlayCircle,
  Clock,
  AlertTriangle,
  AlertCircle,
  Ban,
  CircleDashed,
  XCircle,
} from 'lucide-react'
import type { TaskStatus } from '../../types/contracts'

export interface TaskStatusMetadata {
  label: string
  border: string
  bg: string
  text: string
  glow: string
  icon: React.ReactNode
  badge?: string
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, TaskStatusMetadata> = {
  COMPLETED: {
    label: 'Completed',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-950/20',
    text: 'text-emerald-400',
    glow: 'hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]',
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    icon: React.createElement(CheckCircle2, { className: 'h-3.5 w-3.5 text-emerald-400' }),
  },
  RUNNING: {
    label: 'Running',
    border: 'border-violet-500/80',
    bg: 'bg-violet-950/30',
    text: 'text-violet-400',
    glow: 'shadow-[0_0_16px_rgba(139,92,246,0.3)] animate-pulse',
    badge: 'border-violet-500/40 bg-violet-500/10 text-violet-400 animate-pulse',
    icon: React.createElement(PlayCircle, { className: 'h-3.5 w-3.5 text-violet-400 animate-spin' }),
  },
  READY: {
    label: 'Ready',
    border: 'border-amber-500/40',
    bg: 'bg-amber-950/20',
    text: 'text-amber-400',
    glow: 'hover:shadow-[0_0_12px_rgba(245,158,11,0.2)]',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
    icon: React.createElement(Clock, { className: 'h-3.5 w-3.5 text-amber-400' }),
  },
  AWAITING_REVIEW: {
    label: 'Awaiting Review',
    border: 'border-orange-500/70',
    bg: 'bg-orange-950/30',
    text: 'text-orange-400',
    glow: 'shadow-[0_0_16px_rgba(249,115,22,0.3)] animate-pulse',
    badge: 'border-orange-500/40 bg-orange-500/15 text-orange-400 animate-pulse',
    icon: React.createElement(AlertTriangle, { className: 'h-3.5 w-3.5 text-orange-400' }),
  },
  FAILED: {
    label: 'Failed',
    border: 'border-rose-500/60',
    bg: 'bg-rose-950/30',
    text: 'text-rose-400',
    glow: 'shadow-[0_0_14px_rgba(244,63,94,0.3)]',
    badge: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
    icon: React.createElement(AlertCircle, { className: 'h-3.5 w-3.5 text-rose-400' }),
  },
  BLOCKED: {
    label: 'Blocked',
    border: 'border-zinc-800',
    bg: 'bg-zinc-900/40',
    text: 'text-zinc-500',
    glow: '',
    badge: 'border-zinc-700 bg-zinc-800 text-zinc-400',
    icon: React.createElement(Ban, { className: 'h-3.5 w-3.5 text-zinc-500' }),
  },
  PENDING: {
    label: 'Pending',
    border: 'border-zinc-800',
    bg: 'bg-zinc-900/40',
    text: 'text-zinc-500',
    glow: '',
    badge: 'border-zinc-800 bg-zinc-900 text-zinc-500',
    icon: React.createElement(CircleDashed, { className: 'h-3.5 w-3.5 text-zinc-500' }),
  },
  CANCELLED: {
    label: 'Cancelled',
    border: 'border-zinc-800',
    bg: 'bg-zinc-900/40',
    text: 'text-zinc-600',
    glow: '',
    badge: 'border-zinc-800 bg-zinc-900 text-zinc-500',
    icon: React.createElement(XCircle, { className: 'h-3.5 w-3.5 text-zinc-600' }),
  },
}

export function getTaskStatusStyle(status: TaskStatus): string {
  const config = TASK_STATUS_CONFIG[status]
  if (!config) {
    return 'border-zinc-800 bg-zinc-900 text-zinc-500'
  }
  return config.badge || `${config.border} ${config.bg} ${config.text}`
}

export const STATUS_HEX_COLORS: Record<TaskStatus, string> = {
  COMPLETED: '#10b981',
  RUNNING: '#8b5cf6',
  READY: '#f59e0b',
  AWAITING_REVIEW: '#f97316',
  FAILED: '#f43f5e',
  BLOCKED: '#71717a',
  PENDING: '#3f3f46',
  CANCELLED: '#3f3f46',
}

export function getStatusHexColor(status?: TaskStatus): string {
  if (!status) return '#3f3f46'
  return STATUS_HEX_COLORS[status] || '#3f3f46'
}

export const EDGE_COLORS = {
  running: '#a855f7',
  completed: '#10b981',
  default: '#52525b',
  defaultMarker: '#71717a',
  dimmed: '#3f3f46',
  selected: '#8b5cf6',
  blast: '#f59e0b',
} as const
