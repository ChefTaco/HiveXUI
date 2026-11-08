// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { acquireProjectStore, resetProjectStores } from '../state/project-store';
import { file, OTHER_PROJECT_ID, PROJECT_ID, project, serveStudio, snapshot, summary, team, templateSummary, type StudioRequest } from '../test-fixtures';

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
/** The control inside the labelled field. */
const field = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)?.querySelector('input, textarea, select') as HTMLInputElement | null;
const reads = (path: string) => server.requests.filter((request) => request.method === 'GET' && request.path === path);

describe('the projects home', () => {
  it('shows a card per project from its summary, with no invented data', async () => {
    route = (request) => (request.path.startsWith('/projects?') ? { projects: [summary(), summary({ id: OTHER_PROJECT_ID, name: 'Market scan', team: { revision: null, role_count: 0, bound_count: 0 }, last_activity: null, file_count: 0, tags: [] })] } : undefined);
    const root = await open('/studio');
    const cards = [...root.querySelectorAll('.studio-card')];
    expect(cards).toHaveLength(2);
    expect(text(cards[0])).toContain('Sunken Archive');
    expect(text(cards[0])).toContain('r1 · 2 of 3 roles bound');
    expect(text(cards[0])).toContain('Team revision 1 published');
    expect(text(cards[1])).toContain('No team yet');
    expect(text(cards[1])).toContain('No recorded activity');
    expect(cards[0]!.querySelector('a')?.getAttribute('href')).toBe(`/studio/p/${PROJECT_ID}`);
    expect(reads('/projects?status=active')).toHaveLength(1);
  });

  it('searches through the service and keeps the filter in the address', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    route = (request) => (request.path.startsWith('/projects?') ? { projects: request.path.includes('q=') ? [] : [summary()] } : undefined);
    const root = await open('/studio');
    await type(root.querySelector('input[type="search"]'), 'drowned');
    await settle(300);
    expect(location.search).toBe('?q=drowned');
    expect(reads('/projects?status=active&q=drowned')).toHaveLength(1);
    expect(text(root)).toContain('No projects match');
    await click(button('Archived', root));
    await settle();
    expect(new URLSearchParams(location.search).get('status')).toBe('archived');
    expect(reads('/projects?status=archived&q=drowned')).toHaveLength(1);
  });

  it('guides a first visit to create a project or browse templates', async () => {
    route = (request) => (request.path.startsWith('/projects?') ? { projects: [] } : undefined);
    const root = await open('/studio');
    expect(text(root)).toContain('Start your first project');
    expect(root.querySelector('.empty-state a[href="/studio/new"]')?.textContent).toContain('Create project');
    expect(root.querySelector('.empty-state a[href="/studio/gallery"]')?.textContent).toContain('Browse templates');
  });

  it('says why the list is missing, with Retry', async () => {
    route = () => Response.json({ error: { code: 'INTERNAL', message: 'Database locked' } }, { status: 500 });
    const root = await open('/studio');
    expect(text(root)).toContain('Projects could not be loaded');
    expect(text(root)).toContain('Database locked');
    expect(button('Retry', root)).toBeDefined();
  });
});

describe('creating a project', () => {
  it('creates the project on the brief, so a refresh resumes at references, then applies a template', async () => {
    let files = [file()];
    const applied = team({ current: null });
    route = (request) => {
      if (request.method === 'POST' && request.path === '/projects') return Response.json(project({ name: 'Sunken Archive' }), { status: 201 });
      if (request.path === `/projects/${PROJECT_ID}`) return project();
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ files, team: team({ current: null, validation: null }) });
      if (request.method === 'POST' && request.path.startsWith(`/projects/${PROJECT_ID}/files?`)) {
        const created = file({ id: 'fil_01HZX3K6Q1V8R2M4N6P8T0W009', name: 'brief.pdf', mime: 'application/pdf', knowledge: { ...file().knowledge, state: 'pending', chunks: null } });
        files = [...files, created];
        return Response.json(created, { status: 201 });
      }
      if (request.path === '/templates?kind=team') return { templates: [templateSummary()] };
      if (request.path === `/projects/${PROJECT_ID}/team/apply-template`) return applied;
      return undefined;
    };
    const root = await open('/studio/new');
    await click(button(/Create and continue/, root));
    expect(text(root)).toContain('Name the project.');
    expect(server.mutations()).toHaveLength(0);

    await type(field('Project name', root), 'Sunken Archive');
    await type(field('Brief', root), 'A drowned library.');
    await click(button(/Add deliverable/, root));
    await type(field('Deliverable 1 name', root), 'Adventure book');
    await type(field('Kind', root), 'document');
    await click(button(/Create and continue/, root));
    await settle();
    const [created] = server.mutations();
    expect(created).toMatchObject({ path: '/projects', body: { name: 'Sunken Archive', brief_md: 'A drowned library.', deliverables: [{ name: 'Adventure book', kind: 'document', formats: ['md'], stage: null }] } });
    expect(created!.headers.get('x-idempotency-key')).toBeTruthy();
    expect(location.pathname + location.search).toBe(`/studio/new?project=${PROJECT_ID}&step=2`);
    expect(text(root)).toContain('map-notes.md');
    expect(text(root)).toContain('Indexed');

    // A refresh lands on the same step.
    await view!.unmount();
    view = undefined;
    resetProjectStores();
    const again = await open(location.pathname + location.search);
    expect(again.querySelector('[aria-current="step"]')?.textContent).toContain('References');

    const picker = again.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pdf = new File(['%PDF-1.7'], 'brief.pdf', { type: 'application/pdf' });
    const huge = new File(['x'], 'notes.exe', { type: 'application/octet-stream' });
    Object.defineProperty(picker, 'files', { value: [pdf, huge], configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(text(again)).toContain('notes.exe');
    expect(text(again)).toContain('This type is not accepted');
    const upload = server.mutations().find((request) => request.path.includes('/files?'));
    expect(upload?.path).toBe(`/projects/${PROJECT_ID}/files?name=brief.pdf&purpose=reference`);
    expect(upload?.headers.get('content-type')).toBe('application/pdf');
    expect(text(again)).toContain('brief.pdf');
    expect(text(again)).toContain('Queued');

    await click(button('Continue', again));
    await settle();
    expect(text(again)).toContain('Adventure Studio');
    await click(button('Open Team Assignment', again));
    await settle();
    expect(server.mutations().at(-1)).toMatchObject({ path: `/projects/${PROJECT_ID}/team/apply-template`, body: { template_id: templateSummary().id, version: 1, replace_draft: false } });
    expect(location.pathname + location.search).toBe(`/studio/p/${PROJECT_ID}/team?start=1`);
    // The designer starts from the applied team, not the snapshot from before it (still empty here).
    const { store, release } = acquireProjectStore(PROJECT_ID);
    expect(store.getState().snapshot?.team).toEqual(applied);
    release();
  });

  it('retries indexing for a reference that failed', async () => {
    const failed = file({ knowledge: { ...file().knowledge, state: 'failed', error: 'HiveMem refused the source', chunks: null } });
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}`) return project();
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ files: [failed] });
      if (request.path === `/files/${failed.id}/reindex`) return file({ knowledge: { ...file().knowledge, state: 'pending', chunks: null } });
      return undefined;
    };
    const root = await open(`/studio/new?project=${PROJECT_ID}&step=2`);
    expect(text(root)).toContain('HiveMem refused the source');
    await click(button('Retry', root));
    await settle();
    expect(server.mutations().map((request) => request.path)).toEqual([`/files/${failed.id}/reindex`]);
    expect(text(root)).toContain('Queued');
  });

  it('copies another project’s team without its bindings unless asked', async () => {
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}`) return project();
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot();
      if (request.path === '/templates?kind=team') return { templates: [] };
      if (request.path === '/projects?status=all') return { projects: [summary(), summary({ id: OTHER_PROJECT_ID, name: 'Market scan' })] };
      if (request.path === `/projects/${OTHER_PROJECT_ID}/team`) return team();
      if (request.path === `/projects/${PROJECT_ID}/team`) return request.method === 'PUT' ? team() : team({ current: null, validation: null });
      if (request.path === `/projects/${PROJECT_ID}/team/draft`) return team();
      return undefined;
    };
    const root = await open(`/studio/new?project=${PROJECT_ID}&step=3`);
    await click(root.querySelector<HTMLInputElement>('.studio-start-options label:nth-child(2) input'));
    await settle();
    const select = field('Project', root) as unknown as HTMLSelectElement;
    await act(async () => {
      select.value = OTHER_PROJECT_ID;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Open Team Assignment', root));
    await settle();
    const put = server.mutations().find((request) => request.method === 'PUT');
    const body = put!.body as { base_revision: null; body: { roles: Array<{ agent_ref: string | null; knowledge: unknown[]; binding_id?: unknown }> } };
    expect(body.base_revision).toBeNull();
    expect(body.body.roles.map((role) => role.agent_ref)).toEqual([null, null, null]);
    expect(body.body.roles.every((role) => role.knowledge.length === 0 && !('binding_id' in role))).toBe(true);
  });
});

describe('a project in the top bar', () => {
  it('shows the project name and switches to another project', async () => {
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot();
      if (request.path === '/projects?status=active') return { projects: [summary(), summary({ id: OTHER_PROJECT_ID, name: 'Market scan' })] };
      return undefined;
    };
    const root = await open(`/studio/p/${PROJECT_ID}/room`);
    const switcher = root.querySelector<HTMLButtonElement>('.studio-switcher')!;
    expect(switcher.textContent).toContain('Sunken Archive');
    await click(switcher);
    await settle();
    expect(switcher.getAttribute('aria-expanded')).toBe('true');
    await click([...root.querySelectorAll('.studio-menu a')].find((link) => link.textContent?.includes('Market scan')));
    expect(location.pathname).toBe(`/studio/p/${OTHER_PROJECT_ID}`);
  });

  it('opens the project where it was left: Room once the coordinator is bound, Team before', async () => {
    route = (request) => (request.path === `/projects/${PROJECT_ID}/snapshot` ? snapshot() : undefined);
    await open(`/studio/p/${PROJECT_ID}`);
    expect(location.pathname).toBe(`/studio/p/${PROJECT_ID}/room`);
    await view!.unmount();
    view = undefined;
    resetProjectStores();
    route = (request) => (request.path === `/projects/${PROJECT_ID}/snapshot` ? snapshot({ team: team({ current: null }) }) : undefined);
    await open(`/studio/p/${PROJECT_ID}`);
    expect(location.pathname).toBe(`/studio/p/${PROJECT_ID}/team`);
  });

  it('archives after confirmation, lists the tasks that block it, and reopens', async () => {
    let status: 'active' | 'archived' = 'active';
    let blocked = true;
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ project: project({ status }) });
      if (request.path === `/projects/${PROJECT_ID}/archive`) {
        if (blocked) return Response.json({ error: { code: 'ACTIVE_TASKS', message: 'Cancel the running tasks first', details: { tasks: [{ id: 'tsk_1', title: 'Draft chapter one' }] } } }, { status: 409 });
        status = 'archived';
        return project({ status, archived_at: '2026-11-08T11:00:00.000Z' });
      }
      if (request.path === `/projects/${PROJECT_ID}/reopen`) {
        status = 'active';
        return project();
      }
      return undefined;
    };
    const root = await open(`/studio/p/${PROJECT_ID}/review`);
    await click(button('Archive', root));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Archive Sunken Archive?');
    expect(server.mutations()).toHaveLength(0);
    await click(button('Archive', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(text(root)).toContain('Cancel the running tasks first');
    expect(text(root)).toContain('Draft chapter one');

    blocked = false;
    await click(button('Archive', root));
    await click(button('Archive', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(root.querySelector('.studio-switcher')?.textContent).toContain('Archived');
    expect(text(root)).toContain('This project is archived and read-only');
    await click(button('Reopen', root));
    await click(button('Reopen', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(server.mutations().map((request) => request.path.split('/').at(-1))).toEqual(['archive', 'archive', 'reopen']);
    expect(server.mutations().every((request) => request.headers.get('x-idempotency-key'))).toBe(true);
    expect(root.querySelector('.studio-switcher')?.textContent).not.toContain('Archived');
  });
});
