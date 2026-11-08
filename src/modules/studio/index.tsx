import { useEffect, useRef } from 'react';
import { Workflow, X } from 'lucide-react';
import { StatusDot } from '@ui';
import { cn } from '@lib/cn';
import './studio.css';
import { setAuthExpiredHandler } from '../magnus/api/client';
import { useStudioConnection, type StudioConnection } from './api/client';
import { AgentGate, useArdentAgents } from './gate';
import { StudioLink, useStudioPathname } from './link';
import { StudioNotFound, StudioPage } from './pages';
import { leaveStudio, STUDIO_PREFIX } from './paths';
import { ProjectSwitcher, ProjectTools } from './projects/header';
import { areaHref, matchStudioRoute, type StudioArea, type StudioMatch } from './routes';

const AREAS: ReadonlyArray<{ area: StudioArea; label: string }> = [
  { area: 'team', label: 'Team' },
  { area: 'room', label: 'Room' },
  { area: 'agents', label: 'Agents' },
];
/** The agent each project last opened, so the Agents tab returns to it. */
const lastAgent = new Map<string, string>();

const CONNECTION: Record<StudioConnection['state'], { status: string; label: string }> = {
  checking: { status: 'PENDING', label: 'Connecting…' },
  ready: { status: 'ONLINE', label: 'Connected' },
  denied: { status: 'OFFLINE', label: 'No access' },
  unavailable: { status: 'OFFLINE', label: 'Offline' },
};

function ConnectionState({ connection }: { connection: StudioConnection }) {
  const { status, label } = CONNECTION[connection.state];
  return (
    <span className="studio-connection text-xs text-text-muted" role="status" title={'message' in connection ? connection.message : undefined}>
      <StatusDot status={status} pulse={connection.state === 'checking'} />
      <span>{label}</span>
    </span>
  );
}

function StudioBar({ match, connection }: { match: StudioMatch | null; connection: StudioConnection }) {
  const projectId = match?.projectId;
  function close() {
    leaveStudio();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.topbar .title')?.focus({ preventScroll: true }));
  }
  return (
    <header className="topbar studio-bar">
      <h1 className="sr-only">Ardent Project Studio</h1>
      <StudioLink href={STUDIO_PREFIX} className="studio-mark text-text-strong no-underline" aria-label="Ardent Project Studio home">
        <Workflow className="studio-mark__icon text-accent glow-text-accent" aria-hidden="true" />
        <span className="studio-mark__text">
          <span className="font-display text-lg">Studio</span>
          <span className="studio-mark__sub text-xs text-text-muted">Ardent Project Studio</span>
        </span>
      </StudioLink>
      {projectId ? (
        <div className="studio-project">
          <ProjectSwitcher projectId={projectId} />
          <nav aria-label="Project areas" className="tabs studio-tabs border-b-0">
            {AREAS.map(({ area, label }) => {
              const current = match.route.area === area;
              return (
                <StudioLink key={area} href={areaHref(area, projectId, lastAgent.get(projectId))} className={cn('tab no-underline', current && 'tab--active')} aria-current={current ? 'page' : undefined}>
                  {label}
                </StudioLink>
              );
            })}
          </nav>
          <ProjectTools projectId={projectId} />
        </div>
      ) : null}
      <div className="studio-bar__end">
        <ConnectionState connection={connection} />
        <button type="button" className="topbar-icon studio-close" aria-label="Close Studio" title="Close Studio" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

/**
 * Ardent Project Studio: a fullscreen page with its own top bar, rendered by the console in place of
 * its shell. ✕ returns to the console page it was opened from. Escape deliberately does nothing here,
 * so a stray key cannot throw away a room or a review in progress.
 */
export default function StudioModule({ onAuthExpired }: { onAuthExpired?: () => void }) {
  useEffect(() => {
    setAuthExpiredHandler(onAuthExpired);
    return () => setAuthExpiredHandler(undefined);
  }, [onAuthExpired]);
  const pathname = useStudioPathname();
  const match = matchStudioRoute(pathname);
  const { connection, retry } = useStudioConnection();
  const agents = useArdentAgents();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (match?.projectId && match.agentRef) lastAgent.set(match.projectId, match.agentRef);
  }, [match?.projectId, match?.agentRef]);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [pathname]);
  return (
    <>
      <div className="console-backdrop" aria-hidden="true" />
      <div className="console-scanlines" aria-hidden="true" />
      <div className="studio-shell">
        <StudioBar match={match} connection={connection} />
        <main ref={main} tabIndex={-1} className="studio-main" aria-label={match?.route.title ?? 'Studio'}>
          {match ? (
            <AgentGate agents={agents}>
              <StudioPage key={pathname} match={match} connection={connection} onRetry={retry} />
            </AgentGate>
          ) : (
            <StudioNotFound />
          )}
        </main>
      </div>
    </>
  );
}
