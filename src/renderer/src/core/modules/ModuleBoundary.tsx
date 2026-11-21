import { Component, type ReactNode } from 'react'
import { translate } from '@renderer/i18n'
import { Button } from '@renderer/ui/controls'
import { ErrorCard } from '@renderer/ui/layout'
import { reportModuleError, useModules } from './registry'

interface Props {
  moduleId: string
  children: ReactNode
  /** Render nothing on error (for overlays drawn over the viewer). */
  silent?: boolean
}

/**
 * Error boundary around every module contribution: a crashing panel shows a small error card
 * with a retry button instead of taking down the editor.
 */
export class ModuleBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    reportModuleError(this.props.moduleId, error)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.silent) return null
    const name = useModules.getState().records[this.props.moduleId]?.def?.name() ?? this.props.moduleId
    return (
      <ErrorCard
        title={translate('module.crashed', { name })}
        message={this.state.error.message}
        action={
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            {translate('common.retry')}
          </Button>
        }
      />
    )
  }
}
