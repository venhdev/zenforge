import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TerminalConsole } from '../terminal/TerminalConsole'

interface TerminalModalProps {
  sessionId: string | null
  taskTitle?: string
  mode?: 'HEADLESS' | 'INTERACTIVE'
  onClose: () => void
  onAbort?: () => void
}

export const TerminalModal: React.FC<TerminalModalProps> = ({
  sessionId,
  taskTitle,
  mode = 'HEADLESS',
  onClose,
  onAbort,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={taskTitle ? `Terminal: ${taskTitle}` : 'Worker Terminal'}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col h-full max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <TerminalConsole
          sessionId={sessionId}
          taskTitle={taskTitle}
          mode={mode}
          onClose={onClose}
          onAbort={onAbort}
          isDrawer={false}
          className="border-none"
        />
      </div>
    </div>,
    document.body
  )
}
