import type { ReactNode } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { Button, EmptyState, Panel } from '@ui';
import { productInstalled } from '../../lib/runtime';
import { useMagnusResource, type Resource } from '../magnus/api/use-resource';
import { listProfiles } from '../magnus/pages/agents/ardent/api';
import type { ArdentProfileSummary } from '../magnus/pages/agents/ardent/schemas';
import { LoadingRows, ResourceError } from '../magnus/ui/resource-state';
import { StudioLink } from './link';

export type ArdentProfile = ArdentProfileSummary & { nodeId: string; nodeName: string; reachable: boolean };
export const ARDENT_PROFILES_HREF = '/fleet/ardent/profiles';

/** The Ardent agents Magnus reports. Studio needs at least one it can reach. */
export function useArdentAgents(): Resource<readonly ArdentProfile[]> & { magnus: boolean } {
  const magnus = productInstalled('magnus');
  const resource = useMagnusResource<readonly ArdentProfile[]>((signal) => listProfiles(signal), [], { enabled: magnus });
  return { ...resource, magnus };
}

const NEEDS_AGENT = 'Ardent Project Studio needs at least one Ardent agent.';

/** Every Studio page waits behind this. Without an agent there is nothing Studio can do. */
export function AgentGate({ agents, children }: { agents: ReturnType<typeof useArdentAgents>; children: ReactNode }) {
  if (!agents.magnus)
    return (
      <EmptyState
        framed
        tone="warning"
        icon={<Bot className="size-6" />}
        title={NEEDS_AGENT}
        message="Studio works with the Ardent agents that Magnus manages, and this console is not configured for Magnus."
      />
    );
  if (!agents.data) {
    if (agents.loading)
      return (
        <Panel title="Checking Ardent agents" aria-busy="true">
          <LoadingRows rows={3} />
        </Panel>
      );
    return (
      <Panel>
        <ResourceError error={agents.error} title="Ardent agents could not be checked" onRetry={() => void agents.refresh()} />
      </Panel>
    );
  }
  const reachable = agents.data.filter((profile) => profile.reachable);
  if (reachable.length > 0) return <>{children}</>;
  const offline = agents.data.length;
  return (
    <EmptyState
      framed
      icon={<Bot className="size-6" />}
      title={NEEDS_AGENT}
      message={
        offline > 0
          ? `Magnus reports ${offline} Ardent ${offline === 1 ? 'profile' : 'profiles'}, but on nodes it cannot reach right now. Reconnect the node or create a profile on another one, then refresh.`
          : 'Studio works with the Ardent agents that Magnus manages. Create a profile on a managed node, then refresh.'
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button icon={<RefreshCw className="size-4" />} loading={agents.refreshing} onClick={() => void agents.refresh()}>
            Refresh
          </Button>
          <StudioLink href={ARDENT_PROFILES_HREF} className="btn btn--primary no-underline">
            Ardent profiles
          </StudioLink>
        </div>
      }
    />
  );
}
