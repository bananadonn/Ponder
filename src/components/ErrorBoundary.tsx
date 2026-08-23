import { Component, type ReactNode } from 'react'
import PonderMark from './PonderMark'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// The only safety net between a render-phase crash and a silent blank white
// screen -- React unmounts the whole tree on an uncaught error with nothing
// standing in for it otherwise. Most likely to matter right after sign-in,
// when the app is doing the most first-load work (session restore, DEK
// derivation) with the least already cached.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Unhandled error in render tree:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-mist-50 px-6 text-center">
        <PonderMark className="h-7 w-auto text-mist-300" />
        <div>
          <h1 className="font-display text-lg font-bold text-mist-900">Something went wrong</h1>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-mist-600">
            Ponder hit an unexpected error loading this page. Reloading usually fixes it.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-soft bg-mist-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-mist-700"
        >
          Reload
        </button>
      </div>
    )
  }
}
