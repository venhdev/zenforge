import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface WorkbenchErrorBoundaryProps {
  panelId: string
  children: React.ReactNode
}

interface WorkbenchErrorBoundaryState {
  error: Error | null
}

/**
 * Isolates a workbench panel so a render error inside one view (bad data, a
 * hook-order bug, a vendor crash) cannot black-screen the whole cockpit. The
 * tab strip, ActivityBar, and every other panel stay usable.
 */
export class WorkbenchErrorBoundary extends React.Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): WorkbenchErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[workbench:${this.props.panelId}] render failed`, error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center select-none"
        data-testid={`panel-error-${this.props.panelId}`}
        role="alert"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-200">
            {this.props.panelId} view failed to render
          </p>
          <p className="max-w-md break-words font-mono text-[11px] text-rose-300/90">
            {error.message}
          </p>
        </div>
        <button
          type="button"
          onClick={this.reset}
          className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
        <p className="text-[10px] text-zinc-500">
          Other panels keep running. Use Panels → OFF to close this view.
        </p>
      </div>
    )
  }
}
