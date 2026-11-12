import { useEffect, useState, type ReactElement } from 'react';
import { FusionNav } from './components/security-fusion/fusion-nav';
import { usePathname } from './navigation';
import { productEnabled } from '../../lib/runtime';
import { labEnabled } from './lib/security-fusion';
import { EmptyState, LoadingRows } from '@ui';

const pages = {
  overview: () => import('./pages/page'),
  cases: () => import('./pages/cases/page'),
  detail: () => import('./pages/cases/[caseId]/page'),
  events: () => import('./pages/events/page'),
  entities: () => import('./pages/entities/page'),
  evidence: () => import('./pages/evidence/page'),
  sources: () => import('./pages/sources/page'),
  policies: () => import('./pages/policies/page'),
  audit: () => import('./pages/audit/page'),
  lab: () => import('./pages/lab/page'),
};
type Render = (props: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ date?: string; page?: string }>;
}) => Promise<ReactElement>;
export default function SecurityModule() {
  if (!productEnabled('cindertrace'))
    return (
      <EmptyState
        framed
        title="Cindertrace is not configured"
        message="Connect the security service to review investigations and evidence."
      />
    );
  return <ConfiguredSecurityModule />;
}
function ConfiguredSecurityModule() {
  const path = usePathname();
  const [revision, setRevision] = useState(0);
  const [content, setContent] = useState<ReactElement | null>(null);
  const [error, setError] = useState('');
  const [lab, setLab] = useState(false);
  useEffect(() => {
    let current = true;
    void labEnabled().then((enabled) => {
      if (current) setLab(enabled);
    });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('security-refresh', refresh);
    return () => window.removeEventListener('security-refresh', refresh);
  }, []);
  useEffect(() => {
    let current = true;
    setContent(null);
    setError('');
    const parts = path.split('/').filter(Boolean);
    const key =
      parts[1] === 'cases' && parts[2] ? 'detail' : (parts[1] ?? 'overview');
    const load = pages[key as keyof typeof pages];
    if (!load) {
      setError('This security page is unavailable');
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    const query: { date?: string; page?: string } = {};
    if (searchParams.has('date')) query.date = searchParams.get('date')!;
    if (searchParams.has('page')) query.page = searchParams.get('page')!;
    void load()
      .then((module) =>
        (module.default as Render)({
          params: Promise.resolve({ caseId: parts[2] ?? '' }),
          searchParams: Promise.resolve(query),
        }),
      )
      .then((value) => {
        if (current) setContent(value);
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Security information could not be loaded',
          );
      });
    return () => {
      current = false;
    };
  }, [path, revision]);
  return (
    <section className="security-module">
      <FusionNav labEnabled={lab} />
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : (
        (content ?? (
          <div role="status" aria-label="Loading security information">
            <LoadingRows />
          </div>
        ))
      )}
    </section>
  );
}
