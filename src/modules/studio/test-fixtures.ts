// Fake Studio service records for tests. Tests only; nothing in the console imports it.
import type { Activity, Agent, Conversation, Decision, Message, Project, Task, ProjectSummary, Snapshot, StudioFile, TeamRevision, TeamState, TemplateDetail, TemplateSummary } from './api/endpoints';

const id = (prefix: string, n: number) => `${prefix}_01HZX3K6Q1V8R2M4N6P8T0W${String(n).padStart(3, '0')}`;
export const PROJECT_ID = id('prj', 1);
export const OTHER_PROJECT_ID = id('prj', 2);
export const TEMPLATE_ID = id('tpl', 1);
export const AT = '2026-11-08T10:00:00.000Z';

export const project = (overrides: Partial<Project> = {}): Project => ({
  id: PROJECT_ID,
  name: 'Sunken Archive',
  brief_md: 'Write a one-shot adventure set in a drowned library.',
  audience: 'Game masters',
  constraints: ['Four sessions at most'],
  tags: ['adventure'],
  status: 'active',
  created_by: 'operator',
  hivemem: { workspace_id: 'ws-1', state: 'ready', error: null },
  chattermost_channel_id: null,
  last_area: null,
  deliverables: [{ id: id('req', 1), name: 'Adventure book', kind: 'document', formats: ['docx'], stage: 'deliver', producer_role_key: null }],
  created_at: AT,
  updated_at: AT,
  archived_at: null,
  ...overrides,
});

export const summary = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => {
  const { deliverables: _deliverables, brief_md, ...rest } = project();
  return {
    ...rest,
    brief_excerpt: brief_md,
    file_count: 1,
    link_count: 0,
    deliverable_count: 1,
    team: { revision: 1, role_count: 3, bound_count: 2 },
    open_questions: 0,
    review_pending: 0,
    active_tasks: 0,
    last_activity: { type: 'team.revision.published', at: AT, text: 'Team revision 1 published' },
    ...overrides,
  };
};

export const file = (overrides: Partial<StudioFile> = {}): StudioFile => ({
  id: id('fil', 1),
  project_id: PROJECT_ID,
  name: 'map-notes.md',
  mime: 'text/markdown',
  size: 2048,
  sha256: 'a'.repeat(64),
  purpose: 'reference',
  created_by: 'operator',
  created_at: AT,
  knowledge: { state: 'indexed', source_id: 'src-1', revision: 'r1', chunks: 4, error: null, attempts: 1, updated_at: AT },
  ...overrides,
});

const role = (key: string, name: string, extra: Partial<TeamRevision['body']['roles'][number]> = {}): TeamRevision['body']['roles'][number] => ({
  key,
  name,
  coordinator: false,
  responsibilities_md: `${name} responsibilities`,
  instructions_md: '',
  contributions: [],
  deliverables: [],
  agent_template_ref: null,
  skills: [],
  stage: null,
  agent_ref: null,
  binding_id: null,
  knowledge: [],
  ...extra,
});

export const teamBody = (): TeamRevision['body'] => ({
  roles: [
    role('lead', 'Story Lead', { coordinator: true, agent_ref: 'node-1~lead', binding_id: id('bnd', 1), stage: 'create' }),
    role('world', 'Worldbuilder', { agent_ref: 'node-1~world', binding_id: id('bnd', 2), deliverables: ['Adventure book'], stage: 'research' }),
    role('editor', 'Continuity Editor', { stage: 'review' }),
  ],
  relationships: [
    { from: 'world', to: 'lead', type: 'reports_to' },
    { from: 'editor', to: 'lead', type: 'reports_to' },
    { from: 'lead', to: 'world', type: 'delegates_to' },
    { from: 'world', to: 'editor', type: 'hands_off_to' },
    { from: 'editor', to: 'world', type: 'reviews' },
  ],
  stages: ['create', 'research', 'review', 'deliver'],
});

export const revision = (overrides: Partial<TeamRevision> = {}): TeamRevision => ({
  id: id('trv', 1),
  project_id: PROJECT_ID,
  revision: 1,
  status: 'published',
  source_template: null,
  body: teamBody(),
  created_by: 'operator',
  created_at: AT,
  updated_at: AT,
  published_by: 'operator',
  published_at: AT,
  ...overrides,
});

export const team = (overrides: Partial<TeamState> = {}): TeamState => ({
  current: revision(),
  draft: null,
  validation: { issues: [{ severity: 'warning', code: 'unbound_role', message: 'Continuity Editor has no agent bound', role_key: 'editor' }], can_publish: true, can_start_room: true, agent_facts: 'complete' },
  ...overrides,
});

export const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({ seq: 5, project: project(), files: [file()], team: team(), conversations: [], tasks: [], decisions: [], activity: [], layout: null, summary: summary(), links: [], team_proposals: [], ...overrides });

export const templateSummary = (overrides: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: TEMPLATE_ID,
  kind: 'team',
  slug: 'adventure-studio',
  source: 'seed',
  archived: false,
  name: 'Adventure Studio',
  category: 'creative',
  purpose: 'Write and lay out a tabletop adventure.',
  latest_version: 1,
  used_by: 0,
  created_at: AT,
  updated_at: AT,
  ...overrides,
});

export const templateDetail = (overrides: Partial<TemplateDetail> = {}): TemplateDetail => {
  const body = teamBody();
  return {
    ...templateSummary(),
    versions: [{ version: 1, changelog: 'Initial seed', created_by: 'seed', created_at: AT }],
    latest: {
      template_id: TEMPLATE_ID,
      version: 1,
      changelog: 'Initial seed',
      created_by: 'seed',
      created_at: AT,
      kind: 'team',
      body: {
        name: 'Adventure Studio',
        category: 'creative',
        purpose: 'Write and lay out a tabletop adventure.',
        example_uses: ['A one-shot'],
        roles: body.roles.map(({ agent_ref: _a, binding_id: _b, knowledge: _k, ...item }) => item),
        relationships: body.relationships,
        stages: body.stages,
        integrations: ['hivemem'],
        runtime_req: { ardent: '>=2.2.0', backend: 'any' },
      },
    },
    ...overrides,
  };
};

export const task = (overrides: Partial<Task> = {}): Task => ({
  id: id('tsk', 1),
  project_id: PROJECT_ID,
  title: 'Draft the drowned stacks',
  mode: 'assignment',
  role_key: 'world',
  binding_id: id('bnd', 2),
  assignment_revision: 1,
  conversation_id: null,
  trigger_message_id: null,
  instructions_md: '',
  source: {},
  state: 'running',
  dispatch: 'mission',
  ardent: { agent_ref: 'node-1~world', task_id: 'task-1', session_id: null },
  outcome: null,
  reassigned_from: null,
  group_id: null,
  group_position: 0,
  created_by: 'operator',
  created_at: AT,
  updated_at: AT,
  finished_at: null,
  ...overrides,
});

export const TEAM_CONVERSATION_ID = id('cnv', 1);
export const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: TEAM_CONVERSATION_ID,
  project_id: PROJECT_ID,
  kind: 'team',
  parent_id: null,
  title: 'Team room',
  role_key: null,
  discussion: null,
  last_message_seq: 0,
  created_by: 'operator',
  created_at: AT,
  updated_at: AT,
  stopped_at: null,
  ...overrides,
});

export const messageId = (n: number) => id('msg', n);
export const BINDING = { lead: id('bnd', 1), world: id('bnd', 2) } as const;
export const message = (overrides: Partial<Message> = {}): Message => ({
  id: messageId(1),
  project_id: PROJECT_ID,
  conversation_id: TEAM_CONVERSATION_ID,
  seq: 6,
  author: { kind: 'user', user_id: 'operator' },
  addressees: [],
  reply_to: null,
  thread_root: null,
  kind: 'message',
  body_md: 'Where does the adventure start?',
  attachments: [],
  links: {},
  ardent: null,
  state: 'complete',
  created_at: AT,
  updated_at: AT,
  ...overrides,
});

export const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: id('dec', 1),
  project_id: PROJECT_ID,
  title: 'Tone',
  statement_md: 'Keep the tone eerie but hopeful.',
  rationale_md: '',
  sources: [],
  decided_by: 'operator',
  superseded_by: null,
  created_at: AT,
  ...overrides,
});

export const activity = (overrides: Partial<Activity> = {}): Activity => ({
  binding_id: BINDING.lead,
  agent_ref: 'node-1~lead',
  state: 'available',
  label: 'Available',
  source: { kind: 'presence' },
  since: AT,
  ...overrides,
});

/** One persisted stream frame, as the service sends it. */
export const frame = (seq: number, type: string, payload: Record<string, unknown>) => ({
  event: type,
  id: String(seq),
  data: JSON.stringify({ seq, project_id: PROJECT_ID, type, at: AT, payload }),
});
export const deltaFrame = (messageId: string, text: string, mode: 'append' | 'replace' = 'append', step = 0) => ({
  event: 'message.delta',
  data: JSON.stringify({ message_id: messageId, text, mode, step }),
});

export const agent = (overrides: Partial<Agent> = {}): Agent => ({
  agent_ref: 'node-1~lead',
  node_id: 'node-1',
  node_name: 'node one',
  profile: 'lead',
  backend: 'llamacpp',
  running: true,
  reachable: true,
  available: true,
  installation_version: '2.2.0',
  error: null,
  display_name: 'Lead',
  portrait: null,
  binding_id: id('bnd', 1),
  roles: [],
  ...overrides,
});

export interface StudioRequest {
  method: string;
  /** Relative to /api/ardentstudio/v1, with the query. */
  path: string;
  body: unknown;
  headers: Headers;
}
/**
 * Stubs fetch for the Studio service and Magnus's profile list, and records every Studio request.
 * The route answers a request with a Response, a JSON value, or undefined for a 404.
 */
export function serveStudio(route: (request: StudioRequest) => unknown) {
  const requests: StudioRequest[] = [];
  const ready = { status: 'ready', checks: { database: { status: 'ok', error: null }, magnus: { status: 'ok', error: null }, hivemem: { status: 'ok', error: null }, agents: { status: 'ok', available: 1 } } };
  const profile = { id: 'lead', name: 'Lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null, nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', installationVersion: '2.2.0', reachable: true };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'https://console.example.com');
    if (url.pathname === '/api/magnus/ardent/profiles') return Response.json({ success: true, data: [profile] });
    if (url.pathname === '/api/ardentstudio/v1/health/ready') return Response.json(ready);
    if (!url.pathname.startsWith('/api/ardentstudio/v1/')) return new Response('Not found', { status: 404 });
    const raw = init?.body;
    const request: StudioRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.slice('/api/ardentstudio/v1'.length) + url.search,
      body: typeof raw === 'string' ? JSON.parse(raw) : raw ?? null,
      headers: new Headers(init?.headers),
    };
    requests.push(request);
    const answer = await route(request);
    if (answer instanceof Response) return answer;
    return answer === undefined ? Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }) : Response.json(answer);
  };
  return {
    fetch,
    requests,
    mutations: () => requests.filter((item) => item.method !== 'GET'),
  };
}
