import { useState } from 'react';
import { ArrowUpRight, BookOpen, Plus, Radio } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, LoadingRows, ResourceError } from '@ui';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, PageItem } from '../../../../effects';
import Link, { useRouter } from '../../../../navigation';
import { ADMIN_ONLY, RequireRole } from '../../../../session';
import { listInstallations, listProfiles } from '../api';
import { parseProfileRef, profileHref } from '../logic';
import { NewAgentWizard } from './new-agent';

export default function ArdentProfilesPage() {
  const inventory = useMagnusResource(async (signal) => {
    const [profiles, installations] = await Promise.all([listProfiles(signal), listInstallations(signal)]);
    return { profiles, installations };
  });
  const router = useRouter();
  const data = inventory.data;
  // Open by default on an empty fleet, where creating an agent is the only thing to do.
  const [creating, setCreating] = useState<boolean | null>(null);
  const showWizard = creating ?? (data !== undefined && data.profiles.length === 0);
  const unreachable = data?.installations.filter((item) => !item.reachable) ?? [];
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Magnus Ardent"
          title="Profiles"
          description={data ? `${data.profiles.length} profiles reported by managed nodes` : 'Reading node profiles…'}
          actions={data && !showWizard ? <RequireRole roles={ADMIN_ONLY}><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New Agent</Button></RequireRole> : undefined}
        />
      </PageItem>
      {!data ? (
        <PageItem><FxPanel interactive={false}>{inventory.loading ? <LoadingRows /> : <ResourceError error={inventory.error} title="Ardent profiles are unavailable" onRetry={() => void inventory.refresh()} />}</FxPanel></PageItem>
      ) : (
        <>
          {showWizard ? (
            <RequireRole roles={ADMIN_ONLY}>
              <PageItem>
                <FxPanel title="New Agent" description="Deploy an Ardent agent on a fleet node with its identity, model, skills and HiveMem memory." interactive={false}>
                  <NewAgentWizard
                    installations={data.installations}
                    onCancel={() => setCreating(false)}
                    onDone={(ref) => {
                      const parsed = parseProfileRef(ref);
                      if (parsed) router.push(profileHref(parsed.nodeId, parsed.profileId));
                    }}
                  />
                </FxPanel>
              </PageItem>
            </RequireRole>
          ) : null}
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
