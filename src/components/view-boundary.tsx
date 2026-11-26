import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from '@ui';
import { isChunkLoadError, reloadConsole, reloadOnceForNewVersion, reloadStarted } from '../lib/chunk-reload';

interface State {
  error: unknown;
  /** The guarded reload has started; the page is about to be replaced. */
  reloading: boolean;
}

/**
 * Keeps one failing page from unmounting the whole console. A page whose chunk is gone after an
 * upgrade reloads once to fetch the new build; past that, and for any other failure, the page says
 * what happened and offers a reload, while the shell around it keeps working. A new `resetKey`
 * (the page and its address) tries a failed page again. `quiet` is for a control in the shell's frame (the
 * search palette, the inbox bell): it still reloads once for a new build, but otherwise shows nothing.
 */
interface Props {
  children: ReactNode;
  label?: string | undefined;
  quiet?: boolean | undefined;
  /** A failed page is tried again when this changes: the address inside a product, for example. */
  resetKey?: string | undefined;
}

export class ViewBoundary extends Component<Props, State> {
  override state: State = { error: undefined, reloading: false };
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }
  override componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== undefined && !this.state.reloading)
      this.setState({ error: undefined });
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) {
      this.setState({ reloading: true });
      return;
    }
    console.warn(`${this.props.label ?? 'A console page'} failed:`, error instanceof Error ? error.message : error, info.componentStack?.split('\n')[1]?.trim());
  }
  override render() {
    const { error, reloading } = this.state;
    if (error === undefined) return this.props.children;
    if (this.props.quiet) return null;
    if (reloading || reloadStarted()) return <p role="status">Loading the new HiveXUI version…</p>;
    const reload = <Button variant="primary" onClick={() => reloadConsole()}>Reload console</Button>;
    if (isChunkLoadError(error))
      return (
        <EmptyState
          framed
          tone="warning"
          title="A new HiveXUI version is available"
          message="This page belongs to a newer version of the console than the one open in this tab. Reload to continue."
          action={reload}
        />
      );
    return (
      <EmptyState
        framed
        tone="danger"
        title="This page could not be shown"
        message={error instanceof Error && error.message ? error.message : 'An unexpected error stopped this page.'}
        action={
          <>
            <Button onClick={() => this.setState({ error: undefined })}>Try again</Button>
            {reload}
          </>
        }
      />
    );
  }
}
