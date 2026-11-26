// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../../../magnus/test-dom';
import StudioModule from '../../index';
import { acquireProjectStore, resetProjectStores } from '../../state/project-store';
import { AT, conversation, frame, PROJECT_ID, recovery, serveStudio, snapshot, task, TEAM_CONVERSATION_ID, type StudioRequest } from '../../test-fixtures';
import type { Task } from '../../api/endpoints';

// The project areas load on demand; load them once up front so each page renders as it opens.
beforeAll(async () => {
  const { preloadStudioAreas } = await import('../../pages');
  await preloadStudioAreas();
}, 60_000);

vi.mock('../../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/runtime')>()),
  // Emberpath is left out here: provider traces have their own test.
  productInstalled: (product: string) => product !== 'emberpath',
}));

const TASK_ID = task().id;
const ROOT = 'hx1:studio:inst-1:request:msg_01HZX3K6Q1V8R2M4N6P8T0W001';
const SELF = `hx1:studio:inst-1:task:${TASK_ID}`;
const ARDENT_REF = 'hx1:ardent:node-1.world:task:0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e';

/** A Studio 0.5.0 lineage answer, as PR #40 serves it. */
const lineageAnswer = (overrides: Record<string, unknown> = {}) => ({
  task_id: TASK_ID,
  studio: {
    self: SELF, root: ROOT, parent: null, execution: { root: ROOT, parent: null, self: SELF, attempt: 1, inputs: [] },
    children: [{ task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W002', ref: 'hx1:studio:inst-1:task:tsk_01HZX3K6Q1V8R2M4N6P8T0W002', role_key: 'editor', state: 'queued', mode: 'assignment' }],
    reassigned_from: null, reassigned_to: [], handoffs: [], assignment_revision: 1, revisions: [], workflow: null,
  },
  ardent: {
    agent_ref: 'node-1~world',
    attempts: [{
      ardent_task_id: '0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e', ref: ARDENT_REF, current: true, error: null,
      lineage: {
        task_id: '0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e', children: [], continuations: [],
        model_attempts: [{ step: 1, attempt: 1, backend: 'llamacpp', request_id: 'req-1', ref: 'hx1:ardent:node-1.world:attempt:0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e/1/1', started_ms: 1, usage: { prompt_tokens: 120, completion_tokens: 40 } }],
        tools: [{ call_id: 'call-1', name: 'publish_post', effect: 'write', state: 'attempted' }, { call_id: 'call-2', name: 'read_notes', effect: 'read', state: 'not_dispatched' }],
        artifacts: [{ sha256: 'c'.repeat(64), name: 'stacks-map.png', mime: 'image/png', size: 2048, artifact_id: null, source: 'manifest', created_ms: 1, schema_version: '1.1' }],
      },
    }],
  },
  ardent_unavailable: null,
  emberpath: { filter: { executionRoot: ROOT } },
  ...overrides,
});

let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;
let tasks: Task[];
let lineage: unknown;
let route: (request: StudioRequest) => unknown;

beforeEach(() => {
  stubBrowser();
  tasks = [task({ state: 'unknown', recovery: recovery(), execution: { root: ROOT, parent: null, self: SELF, attempt: 1, inputs: [] } })];
  lineage = lineageAnswer();
  route = () => undefined;
  server = serveStudio((request) => {
    const answer = route(request);
    if (answer !== undefined) return answer;
    if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ conversations: [conversation()], tasks });
    if (request.path === `/projects/${PROJECT_ID}` && request.method === 'PATCH') return snapshot().project;
    if (request.path.startsWith(`/conversations/${TEAM_CONVERSATION_ID}/messages?`)) return { messages: [], next_after: null };
    if (request.path === `/projects/${PROJECT_ID}/tasks?state=all`) return { tasks };
    if (request.path === `/projects/${PROJECT_ID}/deliverables`) return { deliverables: [], imports: [] };
    if (request.path === '/agents') return { agents: [], available_count: 0, magnus: { state: 'ok', error: null } };
    if (request.path === `/tasks/${TASK_ID}/lineage`) return lineage;
    return undefined;
  });
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function open(query = `?lineage=${TASK_ID}`) {
  history.replaceState({ studioOrigin: '/' }, '', `/studio/p/${PROJECT_ID}/room${query}`);
  view = await mount(<StudioModule />);
  for (let index = 0; index < 4; index += 1) await settle();
  return view.container;
}
const store = () => {
  const acquired = acquireProjectStore(PROJECT_ID);
  acquired.release();
  return acquired.store;
};
const drawer = () => document.querySelector<HTMLElement>('.drawer')!;
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const lineageReads = () => server.requests.filter((request) => request.path === `/tasks/${TASK_ID}/lineage`).length;

describe('the lineage drawer', () => {
  it('follows the task from its originating request to its model attempts, tools and artifacts', async () => {
    await open();
    const body = drawer();
    expect(body.getAttribute('aria-label')).toBe(`Execution history: ${task().title}`);
    const steps = [...body.querySelectorAll('[aria-label="Execution chain"] > li')].map((item) => item.querySelector('span')?.textContent);
    expect(steps).toEqual(['Originating request', 'This task', 'Started']);
    expect(text(body)).toContain(ROOT);
    expect(text(body)).toContain('Step 1, attempt 1 · llamacpp · 120 in · 40 out');
    expect(text(body)).toContain('publish_post');
    expect(text(body)).toContain('Outcome unknown');
    expect(text(body)).toContain('Not dispatched');
    expect(text(body)).toContain('stacks-map.png · image/png · 2.0 KB · manifest 1.1');
    expect(text(body)).not.toContain('No execution history recorded');
  });

  it('renders an old task without ancestry with the fallback', async () => {
    tasks = [task({ state: 'completed', recovery: null })];
    lineage = lineageAnswer({
      studio: { self: null, root: null, parent: null, execution: null, children: [], reassigned_from: null, reassigned_to: [], handoffs: [], assignment_revision: 1, revisions: [], workflow: null },
      ardent: null,
      ardent_unavailable: { code: 'NOT_STARTED', message: 'The task never reached an agent.' },
    });
    await open();
    expect(text(drawer())).toContain('No execution history recorded');
    expect(text(drawer())).toContain('Agent history unavailable: The task never reached an agent.');
    expect([...drawer().querySelectorAll('[aria-label="Execution chain"] > li')]).toHaveLength(1);
  });

  it('falls back on a Studio that serves no lineage', async () => {
    tasks = [task({ state: 'unknown' })];
    lineage = undefined;
    await open();
    expect(text(drawer())).toContain('No execution history recorded');
    expect(text(drawer())).toContain('This Studio release does not record execution history');
  });

  it('reads the lineage again when the stream resets while the drawer is open, keeping what it shows', async () => {
    await open();
    expect(lineageReads()).toBe(1);
    let release!: () => void;
    route = (request) => (request.path === `/tasks/${TASK_ID}/lineage` ? new Promise((resolve) => { release = () => resolve(lineageAnswer()); }) : undefined);
    await act(async () => store().receive({ event: 'reset', data: JSON.stringify({ seq: 0, reason: 'cursor_expired' }) }));
    await settle();
    expect(lineageReads()).toBe(2);
    // The earlier copy stays on screen while the new read is in flight.
    expect(text(drawer())).toContain('publish_post');
    expect(text(drawer())).toContain('Refreshing…');
    await act(async () => release());
    await settle();
    expect(text(drawer())).not.toContain('Refreshing…');
  });

  it('reads the lineage again on a recovery event for this task', async () => {
    await open();
    await act(async () => store().receive(frame(6, 'task.recovery', { task_id: TASK_ID, change: 'continued', recovery: recovery({ status: 'resolved', actions: [] }), ardent_task_id: 'next', previous_ardent_task_id: 'prev' })));
    await settle();
    expect(lineageReads()).toBe(2);
    expect(text(drawer())).toContain('Decided');
  });
});

describe('the recovery panel', () => {
  it('offers only the actions the backend lists, and confirms what each does before it posts once with an idempotency key', async () => {
    let posts = 0;
    route = (request) => {
      if (request.method === 'POST' && request.path === `/tasks/${TASK_ID}/recovery`) {
        posts += 1;
        if (posts === 1) return new Response(JSON.stringify({ error: { code: 'MAGNUS_UNAVAILABLE', message: 'Magnus is unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
        return { task: { ...tasks[0], state: 'running', recovery: recovery({ status: 'resolved', actions: [], continuation_task_id: 'next', decided: { action: 'mark_not_applied', by: 'operator', at: AT } }) }, recovery: recovery({ status: 'resolved', actions: [] }) };
      }
      return undefined;
    };
    await open();
    const panel = drawer().querySelector('[data-recovery]')!;
    expect(text(panel)).toContain('Needs a decision');
    expect([...panel.querySelectorAll('[aria-label="Recovery decisions"] button')].map((item) => item.textContent)).toEqual(['It applied', 'It did not apply', 'Abandon']);
    expect(button(/^Retry with a new deadline/, panel)).toBeUndefined();
    await click(button(`It did not apply: ${task().title}`, panel));
    expect(dialog()?.textContent).toContain('It is not retried');
    await type(dialog()!.querySelector('textarea'), 'Checked the blog: no post.');
    await click(button('It did not apply', dialog()!));
    expect(dialog()?.textContent).toContain('Magnus is unavailable');
    await click(button('It did not apply', dialog()!));
    const sent = server.requests.filter((request) => request.method === 'POST' && request.path === `/tasks/${TASK_ID}/recovery`);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toEqual({ action: 'mark_not_applied', note: 'Checked the blog: no post.' });
    // The retry replays the same decision.
    expect(sent[1]!.headers.get('x-idempotency-key')).toBe(sent[0]!.headers.get('x-idempotency-key'));
    expect(dialog()).toBeNull();
    expect(text(panel)).toContain('It did not apply: recorded.');
  });

  it('offers no decision when the agent cannot take one, and says why', async () => {
    tasks = [task({ state: 'unknown', recovery: recovery({ actions: [], supported: false }), execution: { root: ROOT, parent: null, self: SELF, attempt: 1, inputs: [] } })];
    await open();
    const panel = drawer().querySelector('[data-recovery]')!;
    expect(panel.querySelector('[aria-label="Recovery decisions"]')).toBeNull();
    expect(text(panel)).toContain('cannot take recovery decisions');
  });

  it('is not shown for a task from a Studio without recovery, which also hides the history link', async () => {
    // A Studio before 0.5.0 sends neither recovery nor execution.
    const { recovery: _recovery, execution: _execution, ...older } = task({ state: 'unknown' });
    tasks = [{ ...older, ardent: { agent_ref: 'node-1~world', task_id: 'task-1', session_id: null } } as Task];
    await open('?task=' + TASK_ID);
    expect(document.querySelector('[data-recovery]')).toBeNull();
    expect(button(`Execution history of ${task().title}`)).toBeUndefined();
    expect(text(drawer())).toContain('Unknown');
  });

  it('shows the recovery chip and opens the history from the Tasks drawer', async () => {
    await open('?task=' + TASK_ID);
    const row = drawer().querySelector(`[data-task="${TASK_ID}"]`)!;
    expect(row.querySelector('.badge')?.textContent).toBe('Needs decision (effect unknown)');
    expect(row.querySelector('[data-recovery]')).not.toBeNull();
    await click(button(`Execution history of ${task().title}`, row));
    await settle();
    expect(location.search).toContain(`lineage=${TASK_ID}`);
    expect(drawer().getAttribute('aria-label')).toBe(`Execution history: ${task().title}`);
  });
});

describe('the room workflow panel', () => {
  const RUN = 'wfr_01HZX3K6Q1V8R2M4N6P8T0W001';
  const node = (key: string, state: string, extra: Record<string, unknown> = {}) => ({ key, role: 'world', title: key, prompt: 'Go', needs: [], required: true, join_rule: 'all', attempt: 1, state, task_id: null, attempts: [], result: null, error: null, blocked_by: [], actions: [], updated_at: AT, ...extra });
  const run = (nodes: unknown[], state = 'running') => ({ id: RUN, project_id: PROJECT_ID, name: 'Research and synthesis', state, output: 'synthesis', spec: { nodes: [{ key: 'research_a', role: 'world', prompt: 'Go', needs: [], required: true }, { key: 'synthesis', role: 'world', prompt: 'Go', needs: ['research_a'], required: true }], output: 'synthesis' }, spec_sha256: 'a'.repeat(64), inputs: {}, source_template: null, root_ref: null, created_by: 'operator', created_at: AT, updated_at: AT, finished_at: null, nodes });

  it('opens from the room header and follows node updates from the stream', async () => {
    route = (request) => (request.path === `/projects/${PROJECT_ID}/workflow-runs?state=all` ? { runs: [run([node('research_a', 'running'), node('synthesis', 'waiting', { needs: ['research_a'] })])] } : undefined);
    const root = await open('');
    await click(button('Workflows, 1 active', root));
    expect(text(drawer())).toContain('Waiting for research_a');
    await act(async () => store().receive(frame(6, 'workflow.node.updated', { run_id: RUN, run_state: 'blocked', node: node('research_a', 'failed', { error: 'The agent run failed', actions: ['retry'] }) })));
    expect(text(drawer())).toContain('The agent run failed');
    expect(text(drawer())).toContain('Blocked');
    expect(button('Retry: research_a', drawer())).toBeDefined();
  });

  it('is not offered by a Studio without workflow runs', async () => {
    const root = await open('');
    expect(button(/^Workflows/, root)).toBeUndefined();
  });
});
