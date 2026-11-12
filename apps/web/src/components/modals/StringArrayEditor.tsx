import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'

export interface StringArrayEditorProps {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  badgeBgColor?: string
}

export function StringArrayEditor({
  label,
  values,
  onChange,
  placeholder = 'Add item and press Enter...',
  disabled = false,
  className = '',
  badgeBgColor = 'bg-cyan-950/60 border-cyan-800/60 text-cyan-300',
}: StringArrayEditorProps) {
  const [draft, setDraft] = useState('')

  const handleAdd = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (!values.includes(trimmed)) {
      onChange([...values, trimmed])
    }
    setDraft('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const handleRemove = (index: number) => {
    if (disabled) return
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-xs font-semibold text-zinc-300">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={handleAdd}
          className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((val, idx) => (
            <span
              key={`${val}-${idx}`}
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs ${badgeBgColor}`}
            >
              <span>{val}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${val}`}
                  onClick={() => handleRemove(idx)}
                  className="rounded p-0.5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
