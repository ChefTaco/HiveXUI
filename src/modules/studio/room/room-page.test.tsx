// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { acquireProjectStore, resetProjectStores } from '../state/project-store';
import { activity, BINDING, conversation, deltaFrame, frame, message, messageId, project, PROJECT_ID, serveStudio, snapshot, task, TEAM_CONVERSATION_ID, type StudioRequest } from '../test-fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;
let messages = [message()];
let roomSnapshot = snapshot();

const ROOM = `/studio/p/${PROJECT_ID}/room`;
const agentReply = (overrides: Parameters<typeof message>[0] = {}) =>
  message({ id: messageId(2), seq: 6, author: { kind: 'agent', binding_id: BINDING.lead, role_key: 'lead' }, kind: 'reply', body_md: '', state: 'streaming', ...overrides });

beforeEach(() => {
  stubBrowser();
  messages = [message()];
  roomSnapshot = snapshot({ conversations: [conversation()], activity: [activity(), activity({ binding_id: BINDING.world, agent_ref: 'node-1~world', state: 'working', label: 'Working: Draft the drowned stacks' })] });
  route = () => undefined;
  server = serveStudio((request) => {
    const answer = route(request);
    if (answer !== undefined) return answer;
    if (request.path === `/projects/${PROJECT_ID}/snapshot`) return roomSnapshot;
    if (request.path === `/projects/${PROJECT_ID}` && request.method === 'PATCH') return project({ last_area: 'room' });
    if (request.path.startsWith(`/conversations/${TEAM_CONVERSATION_ID}/messages?`)) return { messages, next_after: null };
    if (request.path === `/projects/${PROJECT_ID}/tasks?state=all`) return { tasks: roomSnapshot.tasks };
    if (request.path === `/projects/${PROJECT_ID}/deliverables`) return { deliverables: [], imports: [] };
    if (request.path === '/agents') return { agents: [], available_count: 0, magnus: { state: 'ok', error: null } };
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

async function open(path = ROOM) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  await settle();
  await settle();
  await settle();
  return view.container;
}
function store() {
  const acquired = acquireProjectStore(PROJECT_ID);
  acquired.release();
  return acquired.store;
}
const receive = (item: { event: string; data: string; id?: string }) => act(() => store().receive(item));
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const posts = (path: string) => server.mutations().filter((request) => request.path === path);
const composerInput = (root: ParentNode) => root.querySelector<HTMLTextAreaElement>('.room-composer__input');

describe('the conversation room', () => {
  it('shows the team room transcript and the agents from their stored activity, and records the area', async () => {
    const root = await open();
    expect(root.querySelector('[data-message]')?.textContent).toContain('Where does the adventure start?');
    expect(root.querySelector('[data-agent="node-1~world"][role="button"]')?.getAttribute('aria-label')).toBe('Worldbuilder, Working: Draft the drowned stacks');
    expect(root.querySelector('[data-agent="node-1~lead"][role="button"]')?.getAttribute('aria-label')).toBe('Story Lead, Available');
    expect(posts(`/projects/${PROJECT_ID}`)[0]?.body).toEqual({ last_area: 'room' });
  });

  it('streams a reply into its bubble, lets the stored message replace it, and announces it once', async () => {
    const root = await open();
    await receive(frame(6, 'message.created', { message: agentReply() }));
    expect(root.querySelector(`[data-message="${messageId(2)}"]`)?.textContent).toContain('Working…');
    expect(root.querySelector('[data-agent="node-1~lead"][role="button"]')?.getAttribute('aria-label')).toBe('Story Lead, Replying…');
    await receive(deltaFrame(messageId(2), 'Start at the '));
    await receive(deltaFrame(messageId(2), 'flooded gate'));
    expect(root.querySelector(`[data-message="${messageId(2)}"] .room-msg__text`)?.textContent).toBe('Start at the flooded gate');
    const live = () => root.querySelector('[data-transcript-live]')!.textContent;
    expect(live()).toBe('');
    await receive(frame(7, 'message.updated', { message: agentReply({ state: 'complete', body_md: 'Start at the flooded gate, by night.', updated_at: '2026-11-08T10:05:00.000Z' }) }));
    expect(root.querySelector(`[data-message="${messageId(2)}"] .room-msg__text`)?.textContent).toBe('Start at the flooded gate, by night.');
    expect(live()).toBe('Story Lead replied: Start at the flooded gate, by night.');
    expect(root.querySelector('[data-agent="node-1~lead"][role="button"]')?.getAttribute('aria-label')).toBe('Story Lead, Replied');
  });

  it('renders a finished reply as Markdown without raw HTML', async () => {
    const root = await open();
    await receive(frame(6, 'message.created', { message: agentReply({ state: 'complete', body_md: 'Regions: **Ashen Fen** and *Glowmere*.\n\n- one\n- two\n\n<img src=x onerror=alert(1)>[site](https://example.com)' }) }));
    const body = root.querySelector(`[data-message="${messageId(2)}"] .room-msg__text`)!;
    expect(body.querySelector('strong')?.textContent).toBe('Ashen Fen');
    expect(body.querySelector('em')?.textContent).toBe('Glowmere');
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelector('img')).toBeNull();
    expect(body.textContent).not.toContain('**');
    expect(body.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('reads the conversation again when the stream skips an event', async () => {
    await open();
    const reads = () => server.requests.filter((request) => request.path.startsWith(`/conversations/${TEAM_CONVERSATION_ID}/messages`)).length;
    expect(reads()).toBe(1);
    await receive(frame(9, 'message.created', { message: agentReply() }));
    await settle();
    await settle(200);
    expect(reads()).toBe(2);
  });

  it('says who answers, sends with one idempotency key, and reuses it when a failed send is retried', async () => {
    let attempt = 0;
    route = (request) => {
      if (request.method !== 'POST' || request.path !== `/conversations/${TEAM_CONVERSATION_ID}/messages`) return undefined;
      attempt += 1;
      if (attempt === 1) return Response.json({ error: { code: 'INTERNAL', message: 'Magnus timed out' } }, { status: 503 });
      return Response.json({ message: message({ id: messageId(5), seq: 6, body_md: 'Draft it, @world', addressees: ['world'] }), tasks: [task()] }, { status: 201 });
    };
    const root = await open();
    expect(text(root.querySelector('.room-composer')!)).toContain('Story Lead answers.');
    await type(composerInput(root), 'Draft it, @world');
    expect(text(root.querySelector('.room-composer')!)).toContain('Worldbuilder answers.');
    await click(button(/^Send$/, root));
    await settle();
    expect(root.querySelector('.room-composer [role="alert"]')?.textContent).toContain('Magnus timed out');
    await click(button(/^Send$/, root));
    await settle();
    const sent = posts(`/conversations/${TEAM_CONVERSATION_ID}/messages`);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toEqual({ body_md: 'Draft it, @world', to: { kind: 'team' }, attachments: [] });
    expect(sent[1]!.headers.get('x-idempotency-key')).toBe(sent[0]!.headers.get('x-idempotency-key'));
    expect(composerInput(root)!.value).toBe('');
  });

  it('addresses a role chosen in the recipient list, and completes an @mention from the list', async () => {
    route = (request) => (request.method === 'POST' ? Response.json({ message: message({ id: messageId(5) }), tasks: [] }, { status: 201 }) : undefined);
    const root = await open();
    const to = root.querySelector<HTMLSelectElement>('.room-composer select')!;
    await act(async () => {
      to.value = 'role:world';
      to.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const input = composerInput(root)!;
    await act(async () => {
      input.focus();
    });
    await type(input, 'Ask @le');
    const options = [...root.querySelectorAll('[role="option"]')];
    expect(options.map((item) => item.textContent)).toEqual(['@leadStory Lead']);
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle(20);
    expect(input.value).toBe('Ask @lead ');
    await click(button(/^Send$/, root));
    await settle();
    expect(posts(`/conversations/${TEAM_CONVERSATION_ID}/messages`)[0]!.body).toMatchObject({ body_md: 'Ask @lead', to: { kind: 'roles', roles: ['world'] } });
  });

  it('answers a clarification with a chosen option', async () => {
    messages = [message(), message({ id: messageId(3), seq: 7, author: { kind: 'agent', binding_id: BINDING.world, role_key: 'world' }, kind: 'clarification', body_md: 'Which tone?', links: { task_id: task().id, question: 'Which tone?', options: ['Eerie', 'Hopeful'], answer_message_id: null } })];
    route = (request) => (request.path === `/messages/${messageId(3)}/answer` ? Response.json({ message: message({ id: messageId(4), kind: 'answer' }), tasks: [] }, { status: 201 }) : undefined);
    const root = await open();
    const card = root.querySelector(`[data-message="${messageId(3)}"]`)!;
    await click([...card.querySelectorAll('[role="radio"]')].find((item) => item.textContent === 'Hopeful'));
    await click(button('Send answer', card));
    await settle();
    const [answer] = posts(`/messages/${messageId(3)}/answer`);
    expect(answer!.body).toEqual({ body_md: 'Hopeful' });
    expect(answer!.headers.get('x-idempotency-key')).toBeTruthy();
    // The answer arrives as an event: the card then says it was answered.
    await receive(frame(6, 'message.updated', { message: { ...messages[1]!, links: { ...messages[1]!.links, answer_message_id: messageId(4) }, updated_at: '2026-11-08T10:06:00.000Z' } }));
    expect(card.textContent).toContain('Answered');
  });

  it('pins a decision proposal only when a person asks', async () => {
    messages = [message({ id: messageId(3), author: { kind: 'agent', binding_id: BINDING.world, role_key: 'world' }, kind: 'decision_proposal', body_md: 'Keep it hopeful.', links: { proposal: { title: 'Tone', statement: 'Keep it hopeful.', rationale: 'Young readers' }, decision_id: null } })];
    route = (request) => (request.path === `/projects/${PROJECT_ID}/decisions` && request.method === 'POST' ? Response.json({ id: 'dec_01HZX3K6Q1V8R2M4N6P8T0W005', project_id: PROJECT_ID, title: 'Tone', statement_md: 'Keep it hopeful.', rationale_md: 'Young readers', sources: [], decided_by: 'operator', superseded_by: null, created_at: '2026-11-08T10:00:00.000Z' }, { status: 201 }) : undefined);
    const root = await open();
    expect(posts(`/projects/${PROJECT_ID}/decisions`)).toHaveLength(0);
    await click(button('Pin as decision', root.querySelector('.room-card__body')!));
    await click(button(/^Pin decision$/));
    await settle();
    expect(posts(`/projects/${PROJECT_ID}/decisions`)[0]!.body).toEqual({ title: 'Tone', statement_md: 'Keep it hopeful.', rationale_md: 'Young readers', source_message_id: messageId(3) });
  });

  it('says a pause was requested until the task reports it paused', async () => {
    roomSnapshot = { ...roomSnapshot, tasks: [task()] };
    route = (request) => (request.path === `/tasks/${task().id}/pause` ? task({ state: 'pausing', updated_at: '2026-11-08T10:01:00.000Z' }) : undefined);
    const root = await open();
    await click(button(/^Tasks/, root));
    const drawer = document.querySelector('.drawer')!;
    await click(button(`Pause ${task().title}`, drawer));
    await settle();
    expect(posts(`/tasks/${task().id}/pause`)).toHaveLength(1);
    expect(drawer.querySelector(`[data-task="${task().id}"] [role="status"]`)?.textContent).toBe('Pause requested…');
    await receive(frame(6, 'task.updated', { task: task({ state: 'paused', updated_at: '2026-11-08T10:02:00.000Z' }) }));
    expect(drawer.querySelector(`[data-task="${task().id}"] [role="status"]`)?.textContent).toBe('Paused');
    expect(button(`Resume ${task().title}`, drawer)).toBeDefined();
  });

  it('opens an agent card from the address, with its task, Agent Studio and a direct conversation', async () => {
    roomSnapshot = { ...roomSnapshot, tasks: [task()] };
    const direct = conversation({ id: 'cnv_01HZX3K6Q1V8R2M4N6P8T0W002', kind: 'direct', role_key: 'world', title: 'Worldbuilder' });
    route = (request) => (request.method === 'POST' && request.path === `/projects/${PROJECT_ID}/conversations` ? Response.json(direct, { status: 201 }) : request.path.startsWith(`/conversations/${direct.id}/messages`) ? { messages: [], next_after: null } : undefined);
    const root = await open(`${ROOM}?agent=node-1~world`);
    const card = root.querySelector('[data-popover="node-1~world"]')!;
    expect(card.getAttribute('aria-label')).toBe('Worldbuilder, Working: Draft the drowned stacks');
    expect(card.textContent).toContain('Draft the drowned stacks');
    expect(card.querySelector('a')?.getAttribute('href')).toBe(`/studio/p/${PROJECT_ID}/agents/node-1~world?from=room&c=${TEAM_CONVERSATION_ID}`);
    expect(button(`Pause ${task().title}`, card)).toBeDefined();
    await click(button('Message directly', card));
    await settle();
    expect(posts(`/projects/${PROJECT_ID}/conversations`)[0]!.body).toEqual({ kind: 'direct', role_key: 'world' });
    expect(new URLSearchParams(location.search).get('c')).toBe(direct.id);
    expect(new URLSearchParams(location.search).get('agent')).toBeNull();
    expect(text(root.querySelector('.room-composer')!)).toContain('To Worldbuilder');
  });

  it('opens the card from an avatar and closes it with Escape', async () => {
    const root = await open();
    await act(async () => void root.querySelector('[data-agent="node-1~lead"][role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(new URLSearchParams(location.search).get('agent')).toBe('node-1~lead');
    const card = root.querySelector<HTMLElement>('[data-popover="node-1~lead"]')!;
    expect(document.activeElement).toBe(card);
    await act(async () => void card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(root.querySelector('[data-popover]')).toBeNull();
  });

  it('moves focus with g c, g t and g r', async () => {
    const root = await open();
    const press = (key: string) => act(async () => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    await press('g');
    await press('c');
    await settle(20);
    expect(document.activeElement).toBe(composerInput(root));
    (document.activeElement as HTMLElement).blur();
    await press('g');
    await press('t');
    await settle(20);
    expect(document.activeElement?.classList.contains('room-messages')).toBe(true);
    await press('g');
    await press('r');
    await settle(20);
    expect(document.activeElement?.getAttribute('data-agent')).toBe('node-1~lead');
  });
});

describe('a room opened while a reply streams', () => {
  it('starts the bubble from all the text so far, not only what follows', async () => {
    messages = [message(), agentReply()];
    const early = acquireProjectStore(PROJECT_ID);
    await settle();
    await settle();
    await act(async () => {
      early.store.receive(deltaFrame(messageId(2), 'The whole reply ', 'replace'));
    });
    const root = await open();
    await receive(deltaFrame(messageId(2), 'so far'));
    expect(root.querySelector(`[data-message="${messageId(2)}"] .room-msg__text`)?.textContent).toBe('The whole reply so far');
    early.release();
  });
});
