// The profile's HiveMem credential as Magnus reports it: when it expires and how renewal goes.
import { Badge } from '@ui';
import { cn } from '@lib/cn';
import { FxPanel } from '../../../../effects';
import { ADMIN_ONLY, useMagnusSession } from '../../../../session';
import { Fact } from '../../shared/fx';
import { hiveMemCredentialView, type CredentialTime } from '../hivemem-credential';
import type { ArdentHiveMemCredentialField } from '../schemas';

const BADGE = { ok: 'Renewing', expiring: 'Expiring soon', failing: 'Renewal failing', expired: 'Expired', unmanaged: 'Not managed', unknown: 'Unknown' } as const;

function When({ value }: { value: CredentialTime | null }) {
  return value ? <time title={value.absolute}>{value.relative}</time> : <>—</>;
}

/** Nothing from a Magnus without credential renewal (the field is absent). The last error is for ADMINs. */
export function HiveMemCredential({ credential }: { credential: ArdentHiveMemCredentialField }) {
  const admin = useMagnusSession().can(ADMIN_ONLY);
  const view = hiveMemCredentialView(credential);
  if (!view) return null;
  if (view.kind === 'unmanaged')
    return (
      <FxPanel padding="sm" interactive={false} data-hivemem-credential={view.kind}>
        <p className="m-0 text-sm text-text-muted">HiveMem credential: {view.headline}.</p>
      </FxPanel>
    );
  const panelTone = view.tone === 'danger' || view.tone === 'warning' ? view.tone : undefined;
  const fxTone = view.tone === 'neutral' ? 'accent' : view.tone;
  return (
    <FxPanel
      padding="sm"
      tone={panelTone}
      fxTone={fxTone}
      title="HiveMem credential"
      description="Magnus renews this profile's HiveMem credential before it expires."
      actions={<Badge tone={view.tone} dot>{BADGE[view.kind]}</Badge>}
      interactive={false}
      data-hivemem-credential={view.kind}
    >
      <p role={view.kind === 'expired' ? 'alert' : 'status'} className={cn('m-0 text-sm font-semibold', view.tone === 'danger' && 'text-danger', view.tone === 'warning' && 'text-warning')}>
        {view.expires && view.kind !== 'expired' && view.kind !== 'failing' ? <span title={view.expires.absolute}>{view.headline}</span> : view.headline}
        {view.kind === 'failing' && admin && view.lastError ? <span className="break-words font-normal">: {view.lastError}</span> : null}
      </p>
      {view.kind === 'expired' ? (
        <p className="m-0 mt-1 text-sm text-text-muted">
          Memory calls from this profile are refused until it is enrolled again. {admin ? 'Enable HiveMem re-enrolls it with a new credential.' : 'An ADMIN can re-enroll it with Enable HiveMem.'}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Fact label="Expires"><When value={view.expires} /></Fact>
        <Fact label="Last renewed"><When value={view.lastRenewed} /></Fact>
        <Fact label="Next renewal"><When value={view.nextRenewal} /></Fact>
        <Fact label="Agent"><span className="break-all font-mono text-xs">{view.agentId ?? '—'}{view.workspaceId ? ` · ${view.workspaceId}` : ''}</span></Fact>
      </div>
    </FxPanel>
  );
}
