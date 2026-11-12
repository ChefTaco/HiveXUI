// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HiveApiError } from '../../lib/api-error';
import type { Product } from '../../lib/transport';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../magnus/test-dom';
import type { AgentIdentity, AgentSources, FleetTarget, FusionCase, MemoryRecord, ProjectSummary, Trace } from './api';
import { AgentPage, AgentSourcesContext, type AgentTab } from './page';
import { parseAgentRef } from './paths';
import { summary } from '../studio/test-fixtures';

vi.mock('../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/runtime')>()),
  productInstalled: () => true,
}));

const AGENT = parseAgentRef('node-1~lead')!;
const T1 = '2026-11-10T14:30:00.000Z';

const identity = (overrides: Partial<AgentIdentity> = {}): AgentIdentity => ({
  agentRef: 'node-1~lead', nodeId: 'node-1', profile: 'lead', runtime: 'ardent', actorId: 'ardent-lead', workspaceId: 'ardent-agents',
  oathweaveSubject: null, emberpathClientKeyId: null, ...overrides,
});
const memory = (id: string, agentId = 'ardent-lead'): MemoryRecord => ({
  agent_id: agentId, confidence: 0.9, confidence_provenance: [], content: `Remembered fact ${id}`, corroborated_by: [], created_at: T1, deleted_at: null,
  effective_confidence: null, endorsed_by: [], endorsements: 0, expires_at: null, id, importance: 0.5, metadata: {}, observed_at: null, opposed_by: [],
  redaction_policy: 'none', relationships: [], retention_class: 'standard', sanitization_warnings: null, scope: 'private', sensitivity: 'internal',
  session_id: null, source: 'conversation', superseded_at: null, superseded_by: null, supersedes: null, tags: [], type: 'semantic', updated_at: T1,
  valid_from: null, valid_to: null, workspace_id: 'ardent-agents',
});
const project = (name: string): ProjectSummary => summary({ name, team: { revision: 1, role_count: 3, bound_count: 2 } });
const fusionCase = (id: string, title: string): FusionCase => ({
  id, title, severity: 'high', status: 'open', confidence: 0.82, summary: '', firstSeenAt: T1, lastSeenAt: T1, recommendedInvestigation: [], evidenceSteps: [],
});
const trace = (id: string): Trace => ({
  id, requestId: `req-${id}`, method: 'POST', path: '/v1/chat/completions', endpointKind: 'chat', routeKey: 'default', statusCode: 200, outcome: 'success',
  estimatedUsage: false, providerId: null, providerKind: null, providerModel: 'model-large', clientApiKeyId: null, decisionJson: '{}', requestHeadersJson: null,
  responseHeadersJson: null, requestMetaJson: null, responseMetaJson: null, usageJson: null, retentionJson: null, requestBodyPath: null, responseBodyPath: null,
  reasoningBodyPath: null, startedAt: T1, endedAt: T1, durationMs: 840, createdAt: T1,
});
const target = (name: string, agentRefs?: string[]): FleetTarget => ({ name, host: `${name}.example.internal`, username: 'deploy', enabled: true, magnusNodeId: 'node-1', ...(agentRefs ? { agentRefs } : {}) });

const forbidden = () => new HiveApiError(403, 'Missing permission');
const notFound = () => new HiveApiError(404, 'Agent not found');

/** Every product installed, every answer present; a test replaces what it is about. */
function sources(overrides: Partial<AgentSources> = {}, missing: readonly Product[] = []): AgentSources {
  return {
    installed: (product) => !missing.includes(product),
    role: async () => 'ADMIN',
    identity: async () => identity(),
    node: async () => ({
      id: 'node-1', name: 'Node One', hostname: 'node-1.example.internal', ipAddress: '192.0.2.10', port: 4000, status: 'ONLINE', os: 'linux', arch: 'x64',
      tags: '[]', metadata: '{}', roleId: null, lastHeartbeatAt: T1, createdAt: T1, updatedAt: T1, agent: null, role: null, upgradeReadiness: null,
    }),
    ardentProfile: async () => ({ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 8100, running: true, a2aEnabled: false, channels: { web: true }, error: null }),
    hermesProfile: async () => null,
    memories: async () => ({ supported: true, data: { memories: [memory('m1'), memory('m2')], total: 2 } }),
    memoryStats: async () => null,
    projects: async () => ({ supported: true, data: [project('Sunken Archive')] }),
    cases: async () => ({ supported: true, data: [fusionCase('case-1', 'Repeated sign-in failures')] }),
    traces: async () => ({ supported: true, data: { traces: [trace('tr_1')], nextCursor: null } }),
    skillTargets: async () => ({ supported: true, data: [target('target-a', ['node-1~lead']), target('target-b')] }),
    profileSkills: async () => [{ name: 'summarize', description: 'Condense documents', hash: '', enabled: true }],
    ...overrides,
  };
}

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  history.replaceState(null, '', '/agents/node-1~lead');
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  history.replaceState(null, '', '/');
});

async function open(given: AgentSources, tab: AgentTab = 'overview') {
  view = await mount(
    <AgentSourcesContext.Provider value={given}>
      <AgentPage agent={AGENT} />
    </AgentSourcesContext.Provider>,
  );
  await settle();
  if (tab !== 'overview') {
    await click([...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent?.toLowerCase().startsWith(tab === 'traffic' ? 'traffic' : tab)));
    await settle();
  }
  await settle();
  return document.querySelector('[role="tabpanel"]')!;
}
const text = (root: ParentNode) => root.textContent ?? '';
const rows = (root: ParentNode) => [...root.querySelectorAll('tbody tr')];
const hrefs = (root: ParentNode) => [...root.querySelectorAll('a')].map((link) => link.getAttribute('href'));

describe('Agent 360', () => {
  it('names the agent and opens the tab in its address', async () => {
    history.replaceState(null, '', '/agents/node-1~lead?tab=cases');
    const panel = await open(sources());
    expect(document.querySelector('h2')?.textContent).toBe('lead');
    expect(text(document.body)).toContain('node-1~lead');
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Cases');
    expect(text(panel)).toContain('Repeated sign-in failures');
  });

  it('keeps the chosen tab in the address', async () => {
    await open(sources(), 'traffic');
    expect(location.search).toBe('?tab=traffic');
  });
});

describe('the Overview tab (Magnus)', () => {
  it('shows the identity, the node and the profile, with links to their Magnus pages', async () => {
    const panel = await open(sources());
    expect(text(panel)).toContain('ardent-lead');
    expect(text(panel)).toContain('ardent-agents');
    expect(text(panel)).toContain('Node One');
    expect(text(panel)).toContain('Running');
    expect(hrefs(panel)).toEqual(expect.arrayContaining(['/fleet/nodes/node-1', '/fleet/ardent/profiles/node-1~lead']));
  });

  it('links a Hermes profile to the Hermes profiles page', async () => {
    const hermes = sources({
      identity: async () => identity({ runtime: 'hermes', actorId: null, workspaceId: null }),
      hermesProfile: async () => ({ id: 'h1', installationId: 'i1', name: 'lead', description: '', profileHome: '', isDefault: false, providerSummary: 'router', modelSummary: 'model-large', distribution: null, gatewayStatus: 'running', apiServerEnabled: false, apiServerHost: '', apiServerPort: null, apiServerKeyConfigured: false, capabilities: {}, envStatus: {}, metadata: {}, lastSyncedAt: null, createdAt: T1, updatedAt: T1 }),
    });
    const panel = await open(hermes);
    expect(text(panel)).toContain('Hermes');
    expect(text(panel)).toContain('model-large');
    expect(hrefs(panel)).toContain('/fleet/orchestra/profiles');
  });

  it('says Magnus is not installed', async () => {
    const panel = await open(sources({}, ['magnus']));
    expect(text(panel)).toContain('Magnus is not installed');
  });

  it('says an Ardent agent is not visible to a role other than ADMIN', async () => {
    const panel = await open(sources({ identity: async () => { throw notFound(); }, role: async () => 'VIEWER' }));
    expect(text(panel)).toContain('Not visible to your role');
    expect(text(panel)).toContain('ADMIN');
    // Nodes are for every role.
    expect(text(panel)).toContain('Node One');
  });

  it('says Magnus does not know the agent when ADMIN gets a 404', async () => {
    const panel = await open(sources({ identity: async () => { throw notFound(); } }));
    expect(text(panel)).toContain('Magnus does not know this agent');
  });

  it('offers Retry when Magnus fails', async () => {
    let calls = 0;
    const panel = await open(sources({ identity: async () => { calls += 1; throw new HiveApiError(502, 'Bad gateway'); } }));
    expect(text(panel)).toContain('Magnus could not name this agent');
    await click(button('Retry', panel));
    await settle();
    expect(calls).toBe(2);
  });
});

// The states every tab that matches by HiveMem actor shares.
const ACTOR_TABS: ReadonlyArray<{ tab: AgentTab; product: Product; name: string; read: keyof AgentSources; newer: string; empty: string; first: string }> = [
  { tab: 'memories', product: 'hivemem', name: 'HiveMem', read: 'memories', newer: 'Needs a newer HiveMem', empty: 'This agent has no memories yet', first: 'Remembered fact m1' },
  { tab: 'cases', product: 'cindertrace', name: 'Cindertrace', read: 'cases', newer: 'Needs a newer Cindertrace', empty: 'No case involves this agent', first: 'Repeated sign-in failures' },
  { tab: 'traffic', product: 'emberpath', name: 'Emberpath', read: 'traces', newer: 'Needs a newer Emberpath', empty: 'No traffic from this agent', first: 'POST /v1/chat/completions' },
];
const EMPTY: Partial<Record<keyof AgentSources, AgentSources[keyof AgentSources]>> = {
  memories: async () => ({ supported: true, data: { memories: [], total: 0 } }),
  cases: async () => ({ supported: true, data: [] }),
  traces: async () => ({ supported: true, data: { traces: [], nextCursor: null } }),
  projects: async () => ({ supported: true, data: [] }),
  skillTargets: async () => ({ supported: true, data: [] }),
};

describe.each(ACTOR_TABS)('the $tab tab ($name)', ({ tab, product, name, read, newer, empty, first }) => {
  it('lists what the product has for this actor', async () => {
    const calls: unknown[][] = [];
    const given = sources();
    const original = given[read] as (...args: unknown[]) => unknown;
    const panel = await open({ ...given, [read]: (...args: unknown[]) => { calls.push(args); return original(...args); } }, tab);
    expect(rows(panel).length).toBeGreaterThan(0);
    expect(text(rows(panel)[0]!)).toContain(first);
    expect(calls[0]![0]).toBe('ardent-lead');
  });

  it('says when there is nothing', async () => {
    const panel = await open(sources({ [read]: EMPTY[read] }), tab);
    expect(text(panel)).toContain(empty);
  });

  it(`says ${name} is not installed`, async () => {
    const panel = await open(sources({}, [product]), tab);
    expect(text(panel)).toContain(`${name} is not installed`);
  });

  it('says the agent is not linked when Magnus records no actor', async () => {
    const panel = await open(sources({ identity: async () => identity({ runtime: 'hermes', actorId: null, workspaceId: null }) }), tab);
    expect(text(panel)).toContain('Not linked to a HiveMem actor');
    expect(text(panel)).toContain('Hermes profiles');
  });

  it('says the agent is not linked when its identity is hidden from this role', async () => {
    const panel = await open(sources({ identity: async () => { throw notFound(); }, role: async () => 'OPERATOR' }), tab);
    expect(text(panel)).toContain('Not linked to a HiveMem actor');
    expect(text(panel)).toContain('not visible to your role');
  });

  it(`says a release that cannot filter needs a newer ${name}, and shows nothing of it`, async () => {
    const panel = await open(sources({ [read]: async () => ({ supported: false }) }), tab);
    expect(text(panel)).toContain(newer);
    expect(rows(panel)).toHaveLength(0);
  });

  it('says when the product refuses this person', async () => {
    const panel = await open(sources({ [read]: async () => { throw forbidden(); } }), tab);
    expect(text(panel)).toContain('Not visible to your role');
    expect(text(panel)).toContain('Missing permission');
  });
});

describe('the Memories tab', () => {
  it('searches this agent only and links to the Memories page for it', async () => {
    const queries: string[] = [];
    const panel = await open(sources({ memories: async (_actor, query) => { queries.push(query); return { supported: true, data: { memories: [memory('m9')], total: null } }; } }), 'memories');
    await type(panel.querySelector('input'), 'deploy notes');
    await click(button('Search', panel));
    await settle();
    expect(queries).toEqual(['', 'deploy notes']);
    expect(hrefs(panel)).toContain('/?page=memories&agent=ardent-lead');
  });

  it('shows the per-agent figures only when HiveMem gives them', async () => {
    const panel = await open(sources({ memoryStats: async () => ({ agents: 1, conclusions: 0, episodes: 0, memories: 42, messages: 0, queue_jobs: 0, sessions: 3, webhook_deliveries: 0, webhooks: 0, workspaces: 1 }) }), 'memories');
    expect(text(panel)).toContain('42 memories in 3 sessions');
  });
});

describe('the Projects tab (Ardent Project Studio)', () => {
  it('lists projects by agent reference and links each into Studio', async () => {
    const refs: string[] = [];
    const panel = await open(sources({ projects: async (ref) => { refs.push(ref); return { supported: true, data: [project('Sunken Archive')] }; } }), 'projects');
    expect(refs).toEqual(['node-1~lead']);
    expect(text(rows(panel)[0]!)).toContain('Sunken Archive');
    expect(text(rows(panel)[0]!)).toContain('2 of 3 roles bound');
    expect(hrefs(panel)).toContain(`/studio/p/${summary().id}`);
  });

  it('needs no HiveMem actor', async () => {
    const panel = await open(sources({ identity: async () => identity({ runtime: 'hermes', actorId: null }) }), 'projects');
    expect(text(panel)).toContain('Sunken Archive');
  });

  it('says when no project uses the agent', async () => {
    expect(text(await open(sources({ projects: EMPTY.projects as AgentSources['projects'] }), 'projects'))).toContain('No project team includes this agent');
  });

  it('says Studio is not installed', async () => {
    expect(text(await open(sources({}, ['ardentstudio']), 'projects'))).toContain('Ardent Project Studio is not installed');
  });

  it('says an older Studio needs a newer release', async () => {
    const panel = await open(sources({ projects: async () => ({ supported: false }) }), 'projects');
    expect(text(panel)).toContain('Needs a newer Ardent Project Studio');
    expect(rows(panel)).toHaveLength(0);
  });

  it('says when Studio refuses this person', async () => {
    expect(text(await open(sources({ projects: async () => { throw forbidden(); } }), 'projects'))).toContain('Not visible to your role');
  });
});

describe('the Cases tab', () => {
  it('links each case to its Cindertrace page', async () => {
    expect(hrefs(await open(sources(), 'cases'))).toContain('/security-fusion/cases/case-1');
  });
});

describe('the Traffic tab', () => {
  it('links each trace to Emberpath and says when there are older ones', async () => {
    const panel = await open(sources({ traces: async () => ({ supported: true, data: { traces: [trace('tr_1')], nextCursor: 'abc' } }) }), 'traffic');
    expect(hrefs(panel)).toContain('/?page=traces&trace=tr_1');
    expect(text(panel)).toContain('Older traces are in Emberpath');
  });
});

describe('the Skills tab (HiveSkills and Magnus)', () => {
  it("lists the node's targets, marks the ones linked to this agent, and the profile's skills", async () => {
    const panel = await open(sources(), 'skills');
    const [first, second, skill] = rows(panel);
    expect(text(first!)).toContain('target-a');
    expect(text(first!)).toContain('Linked');
    expect(text(second!)).toContain('Node only');
    expect(text(skill!)).toContain('summarize');
  });

  it('says when no target is bound to the node', async () => {
    expect(text(await open(sources({ skillTargets: EMPTY.skillTargets as AgentSources['skillTargets'] }), 'skills'))).toContain('No HiveSkills target is bound to this node');
  });

  it('says HiveSkills is not installed, and still shows the profile skills', async () => {
    const panel = await open(sources({}, ['hiveskills']), 'skills');
    expect(text(panel)).toContain('HiveSkills is not installed');
    expect(text(panel)).toContain('summarize');
  });

  it('says an older HiveSkills needs a newer release', async () => {
    const panel = await open(sources({ skillTargets: async () => ({ supported: false }) }), 'skills');
    expect(text(panel)).toContain('Needs a newer HiveSkills');
    expect(text(panel)).not.toContain('target-a');
  });

  it('says when HiveSkills refuses this person', async () => {
    expect(text(await open(sources({ skillTargets: async () => { throw forbidden(); } }), 'skills'))).toContain('Not visible to your role');
  });

  it('hides Ardent profile skills from a role that may not see them', async () => {
    const panel = await open(sources({ identity: async () => { throw notFound(); }, role: async () => 'VIEWER' }), 'skills');
    expect(text(panel)).toContain('Magnus shows Ardent profiles to its ADMIN role only');
  });

  it('says neither product is installed', async () => {
    expect(text(await open(sources({}, ['hiveskills', 'magnus']), 'skills'))).toContain('HiveSkills is not installed');
  });
});
