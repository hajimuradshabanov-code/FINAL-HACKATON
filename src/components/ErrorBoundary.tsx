import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Contains a failure of an optional part of the screen (e.g. the WebGL suit model: no GPU, lost
 * context, a chunk that failed to load) so that it shows a note instead of taking the health
 * dashboard down with it.
 */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A part of the dashboard failed to render:', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
