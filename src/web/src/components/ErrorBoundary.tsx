import { Component, type ReactNode } from 'react'

/** Keeps one broken panel (e.g. the map) from taking down the whole page. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Panel crashed:', error)
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children
  }
}
