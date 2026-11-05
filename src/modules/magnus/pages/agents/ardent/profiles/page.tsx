import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, BookOpen, Radio } from 'lucide-react';
import { Badge, Button, EmptyState, Field, PageHeader, Select, TextInput } from '@ui';
import { errorMessage } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import Link, { useRouter } from '../../../../navigation';
import { LoadingRows, ResourceError } from '../../../../ui/resource-state';
import { ardentAction, listInstallations, listProfiles } from '../api';
import { isProfileId, profileHref } from '../logic';
import { profileCreatedSchema, type ArdentInstallation } from '../schemas';

function CreateProfile({ installations }: { installations: readonly ArdentInstallation[] }) {
  const router = useRouter();
  const installed = installations.filter((item) => item.installed && item.reachable);
  const [nodeId, setNodeId] = useState('');
  const [profileId, setProfileId] = useState('default');
  const [apiPort, setApiPort] = useState('9910');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setNodeId((current) => current || installed[0]?.nodeId || ''), [installed[0]?.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    const port = Number(apiPort);
    if (!nodeId || !isProfileId(profileId) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
      setError('Choose an installed node, a valid profile ID, and an API port from 1024 to 65535.');
      return;
    }
    setCreating(true);
    try {
      const created = await ardentAction(nodeId, profileId, 'profile-create', profileCreatedSchema, { body: { api_port: port } });
      if (!created.initialized || created.profile !== profileId || created.apiPort !== port) throw new Error('The node did not confirm the profile');
      router.push(profileHref(nodeId, profileId));
    } catch (caught) {
      setError(errorMessage(caught, 'The profile could not be created'));
    } finally {
      setCreating(false);
    }
  }
  return (
    <FxPanel title="Create profile" description="Initialize a node-local Ardent profile with a private management token. Channels remain disabled until configured." interactive={false}>
      <form className="grid items-end gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_auto]" onSubmit={(event) => void create(event)}>
        <Field label="Managed node"><Select value={nodeId} onChange={setNodeId} options={[{ value: '', label: installed.length ? 'Select an installed node' : 'No installed nodes' }, ...installed.map((item) => ({ value: item.nodeId, label: `${item.nodeName} (${item.hostname})` }))]} /></Field>
        <Field label="Profile ID"><TextInput value={profileId} onChange={setProfileId} maxLength={64} /></Field>
        <Field label="API port"><TextInput type="number" min={1024} max={65535} value={apiPort} onChange={setApiPort} /></Field>
        <Button type="submit" variant="primary" loading={creating} disabled={!nodeId}>{creating ? 'Creating…' : 'Create'}</Button>
      </form>
      {error ? <p role="alert" className="m-0 mt-3 text-sm text-danger">{error}</p> : null}
    </FxPanel>
  );
}

export default function ArdentProfilesPage() {
  const inventory = useMagnusResource(async (signal) => {
    const [profiles, installations] = await Promise.all([listProfiles(signal), listInstallations(signal)]);
    return { profiles, installations };
  });
  const data = inventory.data;
  const unreachable = data?.installations.filter((item) => !item.reachable) ?? [];
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader eyebrow="Magnus Ardent" title="Profiles" description={data ? `${data.profiles.length} profiles reported by managed nodes` : 'Reading node profiles…'} />
      </PageItem>
      {!data ? (
        <PageItem><FxPanel interactive={false}>{inventory.loading ? <LoadingRows /> : <ResourceError error={inventory.error} title="Ardent profiles are unavailable" onRetry={() => void inventory.refresh()} />}</FxPanel></PageItem>
      ) : (
        <>
          <PageItem><CreateProfile installations={data.installations} /></PageItem>
          {unreachable.length > 0 ? (
            <PageItem>
              <FxPanel tone="warning" fxTone="warning" title="Node inventory needs attention" description="Profiles on disconnected nodes cannot be inspected or managed.">
                <div className="grid gap-2">
                  {unreachable.map((item) => (
                    <div key={item.nodeId} className="rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm">
                      <p className="m-0 font-semibold">{item.nodeName} ({item.hostname})</p>
                      <p className="m-0 mt-1 text-danger">{item.error ?? 'Node inventory is unavailable'}</p>
                    </div>
                  ))}
                </div>
              </FxPanel>
            </PageItem>
          ) : null}
          <PageItem>
            {data.profiles.length === 0 ? (
              <FxPanel interactive={false}><EmptyState icon={<BookOpen className="size-5" />} title="No Ardent profiles reported" message="Check installations for node errors." action={<Link href="/ardent/installations" className="btn btn--sm no-underline">Installations</Link>} /></FxPanel>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {data.profiles.map((profile) => (
                  <Link key={`${profile.nodeId}:${profile.id}`} href={profileHref(profile.nodeId, profile.id)} className="glow-hover group block rounded-panel border border-border bg-surface p-4 text-text no-underline hover:border-accent">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <BookOpen className="mt-0.5 size-4 shrink-0 text-accent" />
                        <div className="min-w-0"><p className="m-0 text-base font-semibold group-hover:text-accent">{profile.name}</p><p className="m-0 mt-1 break-all font-mono text-xs text-text-muted">{profile.hostname} · {profile.id}</p></div>
                      </div>
                      <ArrowUpRight className="size-4 shrink-0 text-text-muted group-hover:text-accent" />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge tone={profile.running ? 'success' : 'neutral'} dot>{profile.running ? 'Running' : 'Stopped'}</Badge>
                      <Badge>{profile.backend ?? 'Unknown backend'}</Badge>
                      <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Radio className="size-3" /> A2A {profile.a2aEnabled ? 'configured' : 'disabled'}</span>
                    </div>
                    {profile.error ? <p className="m-0 mt-3 text-sm text-danger">{profile.error}</p> : null}
                  </Link>
                ))}
              </div>
            )}
          </PageItem>
        </>
      )}
    </div>
  );
}
