// What a legacy recovery installation adds to the overview. It has no suite identity or Registry and
// reports its products, its public certificate and its security exporter through one native status
// API, which the shared store reads.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/transport';
import { Badge, Panel } from '../../components/ui';
import type { HiveAppStatus, HiveStatus, TlsCertificateStatus } from '../../lib/types';
import type { OverviewRow } from './index';

export function legacyRows(status: HiveStatus | null): OverviewRow[] {
  return (status?.apps ?? []).map((app) => ({
    key: app.key,
    name: app.name,
    state: app.status === 'online' ? 'ready' : app.status === 'degraded' ? 'degraded' : 'unavailable',
    message: app.summary,
    latencyMs: app.latencyMs,
    href: app.consoleUrl || undefined,
  }));
}

function tlsCertificateFrom(app: HiveAppStatus | undefined): TlsCertificateStatus | null {
  const value = app?.details?.tlsCertificate;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cert = value as Partial<TlsCertificateStatus>;
  if (typeof cert.configured !== 'boolean' || !cert.status || typeof cert.message !== 'string' || !Array.isArray(cert.domains)) return null;
  return cert as TlsCertificateStatus;
}

interface JwksLifetimeStatus {
  state: 'uninitialized' | 'healthy' | 'warning' | 'critical' | 'expired';
  remainingMs: number;
  trustedKeyCount: number;
}
function jwksLifetimeFrom(app: HiveAppStatus | undefined): JwksLifetimeStatus | null {
  const value = app?.details?.securityExporterJwks;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Partial<JwksLifetimeStatus>;
  if (!status.state || typeof status.remainingMs !== 'number' || typeof status.trustedKeyCount !== 'number') return null;
  return status as JwksLifetimeStatus;
}

const certTone = (status: TlsCertificateStatus['status']) => (status === 'pass' ? 'success' : status === 'warn' ? 'warning' : 'danger');
function formatCertDate(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface SkillsStatus {
  configured?: boolean;
  ready?: boolean;
  publicUrl?: string;
  error?: string;
  catalog?: Array<{ slug: string; name: string }>;
}

/** The skills registry, the public certificate and the security exporter's signing keys. */
export function LegacyDetails({ status }: { status: HiveStatus | null }) {
  const [skills, setSkills] = useState<SkillsStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/hive/skills', { signal: controller.signal })
      .then((response) => response.json())
      .then(setSkills)
      .catch(() => {
        if (!controller.signal.aborted) setSkills({ configured: true, ready: false, error: 'Registry status unavailable' });
      });
    return () => controller.abort();
  }, [status?.generatedAt]);
  const router = status?.apps.find((app) => app.key === 'router');
  const certificate = tlsCertificateFrom(router);
  const jwks = jwksLifetimeFrom(router);
  return (
    <>
      {skills?.configured ? (
        <Panel title="Skills registry" eyebrow={skills.ready ? 'Ready' : 'Unavailable'}>
          {skills.error ? <p role="alert">{skills.error}</p> : null}
          <p>{skills.catalog?.length ?? 0} enabled skills on this installation.</p>
          {skills.publicUrl ? <a href={skills.publicUrl} target="_blank" rel="noreferrer">Open catalog and release channels</a> : null}
        </Panel>
      ) : null}
      <Panel title="Public endpoint" eyebrow="Certificate and signing keys">
        <div className="check-list">
          <div className="check-row">
            <div>
              <strong>TLS certificate{certificate?.expectedHost ? ` · ${certificate.expectedHost}` : ''}</strong>
              <span>
                {certificate
                  ? `${certificate.message} Expires ${formatCertDate(certificate.validTo)}${typeof certificate.daysRemaining === 'number' ? ` (${certificate.daysRemaining} days)` : ''}. Domains: ${certificate.domains.join(', ') || certificate.expectedHost || 'unknown'}. Issuer: ${certificate.issuer ?? 'unknown'}.`
                  : 'Not reported'}
              </span>
            </div>
            <Badge tone={certificate ? certTone(certificate.status) : 'neutral'} dot>
              {certificate ? (certificate.hostnameMatched === false ? 'mismatch' : certificate.status) : 'unknown'}
            </Badge>
          </div>
          <div className="check-row">
            <div>
              <strong>Exporter JWKS</strong>
              <span>{jwks ? `${Math.ceil(jwks.remainingMs / 1000)}s remaining; ${jwks.trustedKeyCount} keys` : 'Not reported'}</span>
            </div>
            <Badge tone={jwks?.state === 'healthy' ? 'success' : jwks?.state === 'expired' ? 'danger' : jwks ? 'warning' : 'neutral'} dot>
              {jwks?.state ?? 'unknown'}
            </Badge>
          </div>
        </div>
      </Panel>
    </>
  );
}
