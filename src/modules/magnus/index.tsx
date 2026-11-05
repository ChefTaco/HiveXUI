import { Component, lazy, Suspense, useEffect, useMemo, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from 'react';
import { Button, EmptyState, Panel } from '@ui';
import { Compass, ShieldAlert } from 'lucide-react';
import './effects/effects.css';
import { browserIdentity, productEnabled } from '../../lib/runtime';
import { setAuthExpiredHandler } from './api/client';
import { errorMessage, MagnusApiError } from './api/errors';
import { applyStoredFxLevel } from './effects';
import { LiveBand } from './live/live-band';
import { useLiveEvents } from './live/use-live-events';
import Link, { MagnusNotFound, RouteParams, usePathname } from './navigation';
import { matchRoute, type MagnusRoute } from './routes';
import { sessionStore } from './session-store';
import { useMagnusSession } from './session';

const pages = new Map<MagnusRoute, LazyExoticComponent<ComponentType>>();
function pageFor(route: MagnusRoute) {
  let page = pages.get(route);
  if (!page) pages.set(route, (page = lazy(route.load)));
  return page;
}

function Missing({ title, message, glitch = false }: { title: string; message: string; glitch?: boolean }) {
  return (
    <EmptyState
      framed
      icon={<Compass className="size-6" />}
      title={glitch ? <span className="fx-glitch inline-block">{title}</span> : title}
      message={message}
      action={<Link href="/" className="btn">Fleet overview</Link>}
    />
  );
}

class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn('A Magnus page failed:', errorMessage(error), info.componentStack?.split('\n')[1]?.trim());
  }
  override render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (error instanceof MagnusNotFound || (error instanceof MagnusApiError && error.notFound)) return <Missing glitch title="Not found" message="This page or record does not exist." />;
    return (
      <EmptyState
        framed
        tone="danger"
        title="This page could not be shown"
        message={errorMessage(error)}
        action={<Button onClick={() => this.setState({ error: undefined })}>Try again</Button>}
      />
    );
  }
}

function Page() {
  const path = usePathname();
  const session = useMagnusSession();
  const found = useMemo(() => matchRoute(path), [path]);
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    target?.scrollIntoView();
  }, [path]);
  if (!found) return <Missing glitch title="Not found" message="This Magnus page does not exist here." />;
  const { route, params } = found;
  if (route.capability === 'hermes' && !session.hermes) return <Missing title="Hermes is not enabled" message="This installation has not turned on Hermes Agent management." />;
  if (route.roles && !session.can(route.roles)) return <Missing title="Not available for your role" message="Your Magnus role does not include this page." />;
  const Content = pageFor(route);
  return (
    <RouteParams.Provider value={params}>
      <PageBoundary key={path}>
        <Suspense fallback={<p role="status">Loading {route.title}…</p>}>
          <Content />
        </Suspense>
      </PageBoundary>
    </RouteParams.Provider>
  );
}

function ConfiguredModule() {
  const path = usePathname();
  const session = useMagnusSession();
  useEffect(() => {
    void sessionStore.load();
    applyStoredFxLevel();
  }, []);
  if (session.state.status === 'loading') return <p role="status">Checking Magnus access…</p>;
  if (session.state.status !== 'ready')
    return (
      <Panel title="Magnus access unavailable">
        <EmptyState
          compact
          tone="warning"
          icon={<ShieldAlert className="size-4" />}
          title={session.state.status === 'denied' ? 'This identity has no Magnus access' : 'Magnus could not be reached'}
          message={session.state.message}
          action={<Button onClick={() => { browserIdentity()?.retryConsent(); void session.retry(); }}>Retry access</Button>}
        />
      </Panel>
    );
  return <Ready path={path} />;
}

function Ready({ path }: { path: string }) {
  useLiveEvents();
  return (
    <section className="grid min-w-0 gap-4">
      <LiveBand />
      <Page key={path} />
    </section>
  );
}

export default function MagnusModule({ onAuthExpired }: { onAuthExpired?: () => void }) {
  useEffect(() => {
    setAuthExpiredHandler(onAuthExpired);
    return () => setAuthExpiredHandler(undefined);
  }, [onAuthExpired]);
  // Navigation never routes here for an absent product; render nothing rather than a trace of it.
  if (!productEnabled('magnus')) return null;
  return <ConfiguredModule />;
}
