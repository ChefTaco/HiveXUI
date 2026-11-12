// Agent 360's module: the page for the agent its address names. The shell renders it for /agents/*.
import { useSyncExternalStore } from 'react';
import { EmptyState } from '@ui';
import { AGENT_PAGES, matchSubroute } from '../../lib/routes';
import { AgentPage } from './page';
import { AGENTS_PREFIX, parseAgentRef } from './paths';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const currentPath = () => location.pathname;

export default function AgentsModule() {
  const pathname = useSyncExternalStore(subscribe, currentPath);
  const match = matchSubroute(AGENTS_PREFIX, AGENT_PAGES, pathname.replace(/\/+$/, ''));
  const agent = parseAgentRef(match?.params.agentRef);
  if (!agent)
    return (
      <EmptyState
        framed
        tone="warning"
        title="This agent link is not valid"
        message="An agent's address names its Magnus node and profile: /agents/<node>~<profile>."
      />
    );
  // A new agent starts the page afresh, as following a link always has.
  return <AgentPage key={agent.agentRef} agent={agent} />;
}
