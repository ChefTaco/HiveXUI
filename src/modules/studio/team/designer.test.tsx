// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { agent, PROJECT_ID, project, revision, serveStudio, snapshot, task, team, type StudioRequest } from '../test-fixtures';
import type { Deliverable, TeamState } from '../api/endpoints';
import { deliverable } from '../review/fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

let server: ReturnType<typeof serveStudio>;
let state: TeamState;
let produced: Deliverable[];
let view: Mounted | undefined;
const AGENTS = { agents: [agent(), agent({ agent_ref: 'node-1~world', profile: 'world', display_name: 'Worldsmith' }), agent({ agent_ref: 'node-2~editor', node_id: 'node-2', profile: 'editor', display_name: 'Editor' })], available_count: 3, magnus: { state: 'ok', error: null } };

function route(request: StudioRequest): unknown {
  const base = `/projects/${PROJECT_ID}`;
  if (request.path === `${base}/snapshot`) return snapshot({ team: state });
  if (request.path === '/agents') return AGENTS;
  if (request.path === `${base}/deliverables`) return { deliverables: produced, imports: [] };
  if (request.path === `${base}/team/validate`) return { issues: [], can_publish: true, can_start_room: true, agent_facts: 'complete' };
  if (request.path === `${base}/team/draft`) {
    const body = (request.body as { body: TeamState['current'] extends infer R ? R extends { body: infer B } ? B : never : never }).body;
    state = { ...state, draft: revision({ revision: (state.current?.revision ?? 0) + 1, status: 'draft', body: { ...body, roles: body.roles.map((role) => ({ ...role, binding_id: null })) } as never }) };
    return state;
  }
  if (request.path === `${base}/team/publish`) {
    state = { current: { ...state.draft!, status: 'published' }, draft: null, validation: state.validation };
    return state;
  }
  return undefined;
}

beforeEach(() => {
  stubBrowser();
  state = team();
  produced = [];
  server = serveStudio(route);
  vi.stubGlobal('fetch', server.fetch);
  localStorage.clear();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

async function open(search = '?view=table') {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  history.replaceState({ studioOrigin: '/' }, '', `/studio/p/${PROJECT_ID}/team${search}`);
  view = await mount(<StudioModule />);
  await settle(50);
  await settle(50);
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const drafts = () => server.requests.filter((request) => request.method === 'PUT');
const input = (label: string, root: ParentNode = document) => root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
async function choose(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error('No select');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const saveSoon = () => settle(1000);

describe('Team Assignment', () => {
  it('edits in the table save to the draft after a pause, against the published revision', async () => {
    const root = await open();
    expect(root.querySelectorAll('.studio-table tbody tr').length).toBeGreaterThan(0);
    await type(input('Name of Worldbuilder', root), 'World Architect');
    expect(drafts()).toHaveLength(0);
    await saveSoon();
    expect(drafts()).toHaveLength(1);
    const body = drafts()[0]!.body as { base_revision: number; body: { roles: Array<{ key: string; name: string; agent_ref: string | null; binding_id?: unknown }> } };
    expect(body.base_revision).toBe(1);
    expect(body.body.roles.find((role) => role.key === 'world')).toMatchObject({ name: 'World Architect', agent_ref: 'node-1~world' });
    expect(body.body.roles.some((role) => 'binding_id' in role)).toBe(false);
    expect(text(root)).toContain('Draft r2');
  });

  it('shows the mirrored rules at once and blocks Publish on errors', async () => {
    const root = await open();
    await choose(root.querySelector('[aria-label="Stage for Worldbuilder"]'), 'deliver');
    // Removing the only producer of a requested deliverable is an error before any answer arrives.
    const deliverables = input('Deliverables of Worldbuilder, comma separated', root)!;
    await type(deliverables, '');
    await act(async () => {
      deliverables.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      deliverables.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await click(button(/Validate/, root));
    expect(text(root)).toContain('No role produces the deliverable Adventure book');
    expect(button('Publish', root)?.disabled).toBe(true);
  });

  it('publishes the draft and says which revision is current', async () => {
    const root = await open();
    await choose(root.querySelector('[aria-label="Stage for Continuity Editor"]'), 'revise');
    await saveSoon();
    await click(button('Publish', root));
    await settle(50);
    const publish = server.requests.find((request) => request.path.endsWith('/team/publish'));
    expect(publish).toMatchObject({ method: 'POST', body: { draft_revision: 2 } });
    expect(publish!.headers.get('x-idempotency-key')).toBeTruthy();
    expect(text(root)).toContain('Current r2');
    expect(text(root)).not.toContain('Draft r');
  });

  it('binds an existing agent from the picker', async () => {
    const root = await open();
    await click(button('Choose the agent for Continuity Editor', root));
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(text(drawer)).toContain('Editor');
    await click(button('Bind Editor', drawer));
    await saveSoon();
    const body = drafts().at(-1)!.body as { body: { roles: Array<{ key: string; agent_ref: string | null }> } };
    expect(body.body.roles.find((role) => role.key === 'editor')!.agent_ref).toBe('node-2~editor');
  });

  it('starts in the Room only with a published, bound and available coordinator', async () => {
    let root = await open();
    const start = [...root.querySelectorAll('a')].find((link) => link.textContent?.includes('Start in Room'));
    expect(start?.getAttribute('href')).toBe(`/studio/p/${PROJECT_ID}/room`);
    await view!.unmount();
    view = undefined;
    resetProjectStores();
    state = team({ current: revision({ body: { ...revision().body, roles: revision().body.roles.map((role) => (role.coordinator ? { ...role, agent_ref: null, binding_id: null } : role)) } }) });
    root = await open();
    expect(button('Start in Room', root)?.disabled).toBe(true);
    expect(text(root)).toContain('Start in Room: Bind an agent to Story Lead, then publish.');
  });

  it('deletes a role without work at once, with its relationships, and Undo puts it back', async () => {
    const root = await open();
    await click(button('Delete Continuity Editor', root));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await saveSoon();
    const body = drafts().at(-1)!.body as { body: { roles: Array<{ key: string }>; relationships: Array<{ from: string; to: string }> } };
    expect(body.body.roles.map((role) => role.key)).toEqual(['lead', 'world']);
    expect(body.body.relationships.every((edge) => edge.from !== 'editor' && edge.to !== 'editor')).toBe(true);
    const toast = document.querySelector('.toast')!;
    expect(toast.textContent).toContain('Deleted Continuity Editor');
    await click(button('Undo', toast as HTMLElement));
    await saveSoon();
    const restored = drafts().at(-1)!.body as { body: { roles: Array<{ key: string }>; relationships: Array<{ from: string; to: string }> } };
    expect(restored.body.roles.map((role) => role.key)).toEqual(['lead', 'world', 'editor']);
    expect(restored.body.relationships.some((edge) => edge.from === 'editor' || edge.to === 'editor')).toBe(true);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('asks first when the role has active tasks or delivered files', async () => {
    produced = [deliverable({ producer_role: 'editor' })];
    const root = await open();
    await click(button('Delete Continuity Editor', root));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Delete Continuity Editor?');
    expect(dialog.textContent).toContain('Continuity Editor has 1 deliverable.');
    expect(dialog.textContent).toContain('Delivered files stay in Review.');
    await click(button('Delete role', dialog as HTMLElement));
    await saveSoon();
    const body = drafts().at(-1)!.body as { body: { roles: Array<{ key: string }> } };
    expect(body.body.roles.map((role) => role.key)).toEqual(['lead', 'world']);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('opens the inspector from the table, with the same fields the canvas edits', async () => {
    const root = await open();
    await click(button('Details of Worldbuilder', root));
    expect(location.search).toContain('role=world');
    const inspector = root.querySelector('aside[aria-label="Role Worldbuilder"]')!;
    const instructions = [...inspector.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === 'Instructions')!.querySelector('textarea');
    await type(instructions, 'Cite every source.');
    await saveSoon();
    const body = drafts().at(-1)!.body as { body: { roles: Array<{ key: string; instructions_md: string }> } };
    expect(body.body.roles.find((role) => role.key === 'world')!.instructions_md).toBe('Cite every source.');
  });
});

describe('work under an older revision', () => {
  it('says which revision a task works under and reassigns it to the current one after confirmation', async () => {
    state = team({ current: revision({ revision: 2 }) });
    const reassigned: unknown[] = [];
    vi.stubGlobal('fetch', serveStudio((request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ team: state, tasks: [task()] });
      if (request.path === `/tasks/${task().id}/reassign`) {
        reassigned.push(request.body);
        return task({ id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W002', assignment_revision: 2, reassigned_from: task().id });
      }
      return route(request);
    }).fetch);
    const root = await open();
    expect(text(root)).toContain('Working under r1 (current r2)');
    await click(button('Reassign', root));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('creates the same work for Worldbuilder under r2');
    await click(button('Reassign', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(reassigned).toEqual([{ role_key: 'world' }]);
  });
});

describe('the team canvas', () => {
  it('draws every role in reporting order with its binding, and moves focus with the arrow keys', async () => {
    const root = await open('?view=team');
    await settle(100);
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-role-key]')];
    expect(nodes.map((node) => node.dataset.roleKey)).toEqual(['lead', 'world', 'editor']);
    expect(nodes[0]!.getAttribute('aria-label')).toContain('Story Lead, coordinator. Bound to Lead, available.');
    nodes[0]!.focus();
    await act(async () => {
      nodes[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('data-role-key')).toBe('world');
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('data-role-key')).toBe('editor');
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(root.querySelector('aside[aria-label="Role Continuity Editor"]')).not.toBeNull();
  });

  it('duplicates with Ctrl+D and deletes with Delete, the same edits as the table', async () => {
    const root = await open('?view=team');
    await settle(100);
    const world = root.querySelector<HTMLElement>('[data-role-key="world"]')!;
    world.focus();
    await act(async () => {
      world.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    });
    await settle(20);
    expect([...root.querySelectorAll<HTMLElement>('[data-role-key]')].map((node) => node.dataset.roleKey)).toContain('worldbuilder_copy');
    const editor = root.querySelector<HTMLElement>('[data-role-key="editor"]')!;
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    await saveSoon();
    const canvasBody = (drafts().at(-1)!.body as { body: { roles: Array<{ key: string; agent_ref: string | null }> } }).body;
    expect(canvasBody.roles.map((role) => role.key)).toEqual(['lead', 'world', 'worldbuilder_copy']);
    expect(canvasBody.roles[2]!.agent_ref).toBeNull();

    // The table makes the same edits through the same functions.
    await view!.unmount();
    view = undefined;
    resetProjectStores();
    state = team();
    server.requests.length = 0;
    const table = await open();
    await click(button('Duplicate Worldbuilder', table));
    await click(button('Delete Continuity Editor', table));
    await saveSoon();
    expect((drafts().at(-1)!.body as { body: unknown }).body).toEqual(canvasBody);
  });
});

describe('a project that is archived', () => {
  it('shows its team read-only', async () => {
    const archived = snapshot({ project: project({ status: 'archived' }) });
    vi.stubGlobal('fetch', serveStudio((request) => (request.path === `/projects/${PROJECT_ID}/snapshot` ? archived : route(request))).fetch);
    const root = await open();
    expect(input('Name of Worldbuilder', root)?.disabled).toBe(true);
    expect(button('Publish', root)?.disabled).toBe(true);
  });
});
