// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { AT, OTHER_PROJECT_ID, PROJECT_ID, serveStudio, summary, type StudioRequest } from '../test-fixtures';
import { summaryAction, watchedProjects } from './live-summaries';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  route = () => undefined;
  server = serveStudio((request) => route(request));
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

async function open(path: string) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  await settle();
  await settle();
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const reads = (prefix: string) => server.requests.filter((request) => request.method === 'GET' && request.path.startsWith(prefix));
const frame = (seq: number, type: string, payload: Record<string, unknown>) => ({ event: type, data: JSON.stringify({ seq, project_id: PROJECT_ID, type, at: AT, payload }) });

/** An open event stream the test writes frames into. */
function liveStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = () =>
    new Response(new ReadableStream<Uint8Array>({ start: (value) => void (controller = value) }), { headers: { 'content-type': 'text/event-stream' } });
  const send = async (event: { event: string; data: string }) => {
    controller!.enqueue(encoder.encode(`event: ${event.event}\ndata: ${event.data}\n\n`));
    await settle(10);
  };
  return { response, send };
}

const busy = summary({
  open_questions: 2,
  review_pending: 1,
  active_tasks: 3,
  link_count: 2,
  last_activity: { type: 'message.created', at: AT, text: 'Story Lead asked: Which tone?' },
});
const quiet = summary({ id: OTHER_PROJECT_ID, name: 'Market scan', last_activity: null });

describe('project cards', () => {
  it('show question and review badges, active work, links and the last real activity', async () => {
    route = (request) => (request.path.startsWith('/projects?') ? { projects: [busy, quiet] } : undefined);
    const root = await open('/studio');
    const [first, second] = [...root.querySelectorAll('.studio-card')];
    expect(text(first!.querySelector('.studio-card__badges')!)).toBe('2 open questions1 to review');
    expect(text(first)).toContain('3 active tasks');
    expect(text(first)).toContain('1 file · 2 links · 1 deliverable requested');
    expect(text(first!.querySelector('.studio-card__activity')!)).toContain('Story Lead asked: Which tone?');
    expect(first!.querySelector('.studio-card__activity time')?.getAttribute('datetime')).toBe(AT);
    expect(second!.querySelector('.studio-card__badges')).toBeNull();
    expect(text(second)).toContain('No active tasks');
    expect(text(second)).toContain('No recorded activity');
  });

  it('filters to projects that need review through the service, and says when none do', async () => {
    route = (request) => (request.path.startsWith('/projects?') ? { projects: request.path.includes('needs_review=true') ? [] : [busy] } : undefined);
    const root = await open('/studio');
    const filter = button(/Needs review/, root)!;
    expect(filter.getAttribute('aria-pressed')).toBe('false');
    await click(filter);
    await settle();
    expect(new URLSearchParams(location.search).get('review')).toBe('1');
    expect(button(/Needs review/, root)!.getAttribute('aria-pressed')).toBe('true');
    expect(reads('/projects?status=active&needs_review=true')).toHaveLength(1);
    expect(text(root)).toContain('Nothing needs review');
    await click(button('Show all projects', root));
    await settle();
    expect(location.search).toBe('');
    expect(root.querySelectorAll('.studio-card')).toHaveLength(1);
  });
});

describe('live project cards', () => {
  it('patch counts from project.updated and re-read the list after a record event', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stream = liveStream();
    let listed = [busy, quiet];
    route = (request) => {
      if (request.path.startsWith('/projects?')) return { projects: listed };
      if (request.path === `/projects/${PROJECT_ID}/stream` || request.path === `/projects/${OTHER_PROJECT_ID}/stream`) return request.path.includes(PROJECT_ID) ? stream.response() : new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
      return undefined;
    };
    const root = await open('/studio');
    await settle(20);
    // Each listed active project's stream is followed from the present, without a cursor.
    expect(reads(`/projects/${PROJECT_ID}/stream`).map((request) => request.path)).toEqual([`/projects/${PROJECT_ID}/stream`]);
    expect(reads('/projects?')).toHaveLength(1);

    await stream.send(frame(40, 'project.updated', { fields: ['counts'], counts: { open_questions: 0, review_pending: 4, active_tasks: 1 } }));
    const card = root.querySelector('.studio-card')!;
    expect(text(card)).toContain('4 to review');
    expect(text(card)).not.toContain('open question');
    expect(text(card)).toContain('1 active task');
    expect(reads('/projects?')).toHaveLength(1);

    listed = [{ ...busy, last_activity: { type: 'decision.created', at: AT, text: 'Decision pinned: Eerie tone' } }, quiet];
    await stream.send(frame(41, 'decision.created', { decision_id: 'dec_1' }));
    await stream.send(frame(42, 'presence.updated', {}));
    await settle(500);
    expect(reads('/projects?')).toHaveLength(2);
    expect(text(root.querySelector('.studio-card')!)).toContain('Decision pinned: Eerie tone');
  });

  it('reads only frames that change a card', () => {
    const event = (type: string, payload: Record<string, unknown>) => summaryAction(frame(1, type, payload));
    expect(event('project.updated', { fields: ['counts'], counts: { open_questions: 1, review_pending: 0, active_tasks: 0 } })).toEqual({ kind: 'counts', counts: { open_questions: 1, review_pending: 0, active_tasks: 0 } });
    expect(event('project.updated', { fields: ['name'] })).toEqual({ kind: 'refresh' });
    for (const type of ['message.created', 'decision.created', 'deliverable.revision.created', 'review.decision.created', 'file.created', 'link.created', 'team.revision.published', 'export.created']) expect(event(type, {})).toEqual({ kind: 'refresh' });
    expect(event('presence.updated', {})).toBeNull();
    expect(event('file.updated', {})).toBeNull();
    expect(summaryAction({ event: 'heartbeat', data: '{"seq":3}' })).toBeNull();
    expect(summaryAction({ event: 'message.delta', data: 'not json' })).toBeNull();
  });

  it('follows the active projects with the newest activity, a few at a time', () => {
    const at = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();
    const list = [1, 2, 3, 4, 5, 6].map((n) => summary({ id: `prj_01HZX3K6Q1V8R2M4N6P8T0W10${n}`, last_activity: { type: 'message.created', at: at(n), text: '' } }));
    list.push(summary({ id: 'prj_01HZX3K6Q1V8R2M4N6P8T0W199', status: 'archived', last_activity: { type: 'project.archived', at: at(99), text: '' } }));
    expect(watchedProjects(list)).toEqual(['prj_01HZX3K6Q1V8R2M4N6P8T0W106', 'prj_01HZX3K6Q1V8R2M4N6P8T0W105', 'prj_01HZX3K6Q1V8R2M4N6P8T0W104', 'prj_01HZX3K6Q1V8R2M4N6P8T0W103']);
  });
});
