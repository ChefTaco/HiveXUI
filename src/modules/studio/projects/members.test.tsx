// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { reduceStreamFrame } from '../api/stream';
import { studioFailure } from '../api/client';
import { resetProjectStores } from '../state/project-store';
import { PROJECT_ID, project, serveStudio, snapshot, summary, type StudioRequest } from '../test-fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productEnabled: () => true,
}));

beforeAll(async () => {
  const { preloadStudioAreas } = await import('../pages');
  await preloadStudioAreas();
}, 60_000);

const ISSUER = 'https://identity.example.com';
const members = (overrides: Record<string, unknown> = {}) => ({ project_id: PROJECT_ID, mode: 'everyone', revision: 3, members: [], access: { mode: 'everyone', role: 'owner' }, ...overrides });
let view: Mounted | undefined;
let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
beforeEach(() => {
  stubBrowser();
  server = serveStudio((request) => route(request));
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});
async function open(path: string) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  for (let index = 0; index < 4; index += 1) await settle();
  return view.container;
}
const field = (label: string) => [...document.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label))?.querySelector('input');
const owned = (status: 'active' | 'archived' = 'active') => snapshot({ project: project({ status }), summary: summary({ status, access: { mode: 'everyone', role: 'owner' } } as never) });

describe('project members', () => {
  it('limits a project to listed members, adds a person and a role, and saves with the revision', async () => {
    let current = members();
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return owned();
      if (request.path === `/projects/${PROJECT_ID}/members` && request.method === 'GET') return current;
      if (request.path.startsWith('/people')) return { people: [{ user_id: 'usr_alice', subject: 'alice-sub', issuer: ISSUER, display_name: 'Alice Example' }], truncated: false };
      if (request.path === `/projects/${PROJECT_ID}/members` && request.method === 'PUT') {
        const body = request.body as { members: unknown[] };
        current = members({ mode: 'members', revision: 4, members: (body.members as Array<Record<string, unknown>>).map((member) => ({ ...member, added_by: 'admin', added_at: '2026-11-26T10:00:00.000Z', ...(member.kind === 'subject' ? { user_id: 'usr_alice', display_name: 'Alice Example' } : {}) })), access: { mode: 'members', role: 'owner' } });
        return current;
      }
      return undefined;
    };
    await open(`/studio/p/${PROJECT_ID}/review`);
    await click(button('Members'));
    await settle(20);
    const drawer = document.querySelector('aside[aria-label="Members"]')!;
    await click([...drawer.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1]!);
    await settle(300);
    await click(button('Add Alice Example', drawer));
    await settle();
    (drawer.querySelector('select[aria-label="Role of Alice Example"]') as HTMLSelectElement).value = 'owner';
    (drawer.querySelector('select[aria-label="Role of Alice Example"]') as HTMLSelectElement).dispatchEvent(new Event('change', { bubbles: true }));
    await type(field('Oathweave role'), 'analysts');
    await click(button('Add role', drawer));
    await click(button('Save members', drawer));
    await settle(20);
    const put = server.mutations().find((request) => request.method === 'PUT')!;
    expect(put.body).toEqual({ base_revision: 3, mode: 'members', members: [{ kind: 'subject', subject: 'alice-sub', issuer: ISSUER, role: 'owner' }, { kind: 'oathweave_role', name: 'analysts', role: 'viewer' }] });
    expect(drawer.querySelector('[role="status"]')?.textContent).toBe('Only the 2 listed members can open this project.');
  });

  it('reloads after a version conflict and words each refusal', async () => {
    let refusal = { code: 'VERSION_CONFLICT', status: 409 };
    let reads = 0;
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return owned();
      if (request.path === `/projects/${PROJECT_ID}/members` && request.method === 'GET') return members({ revision: 3 + reads++ });
      if (request.path.startsWith('/people')) return { people: [], truncated: false };
      if (request.method === 'PUT') return Response.json({ error: { code: refusal.code, message: 'Refused' } }, { status: refusal.status });
      return undefined;
    };
    await open(`/studio/p/${PROJECT_ID}/review`);
    await click(button('Members'));
    await settle(20);
    const drawer = document.querySelector('aside[aria-label="Members"]')!;
    await click(button('Save members', drawer));
    await settle(20);
    expect(drawer.querySelector('[role="alert"]')?.textContent).toContain('Someone else changed the members meanwhile');
    expect(reads).toBe(2);
    refusal = { code: 'SELF_LOCKOUT', status: 422 };
    await click(button('Save members', drawer));
    await settle(20);
    expect(drawer.querySelector('[role="alert"]')?.textContent).toContain('without owner access');
    // The retry after the conflict sent the revision it reloaded.
    expect(server.mutations().map((request) => (request.body as { base_revision: number }).base_revision)).toEqual([3, 4]);
  });

  it('is offered to owners only', async () => {
    route = (request) => (request.path === `/projects/${PROJECT_ID}/snapshot` ? snapshot({ summary: summary({ access: { mode: 'members', role: 'editor' } } as never) }) : undefined);
    await open(`/studio/p/${PROJECT_ID}/review`);
    expect(button('Members')).toBeUndefined();
    expect(button('Purge')).toBeUndefined();
  });
});

describe('purging an archived project', () => {
  it('needs the exact name typed, words a refusal, and leaves for the project list when it is gone', async () => {
    let refuse = true;
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return owned('archived');
      if (request.path === `/projects/${PROJECT_ID}/purge`) {
        if (refuse) return Response.json({ error: { code: 'FILE_IN_USE', message: 'In use', details: { agents: ['node-1~lead'] } } }, { status: 409 });
        return { project_id: PROJECT_ID, name: 'Sunken Archive', purged_at: '2026-11-26T10:00:00.000Z', removed: { events: 12 }, knowledge: { sources_retiring: 2 } };
      }
      if (request.path.startsWith('/projects')) return { projects: [] };
      return undefined;
    };
    await open(`/studio/p/${PROJECT_ID}/review`);
    await click(button('Purge'));
    const confirm = () => button('Purge project', dialog()!)!;
    expect(confirm().disabled).toBe(true);
    await type(dialog()!.querySelector('input'), 'Sunken');
    expect(confirm().disabled).toBe(true);
    await type(dialog()!.querySelector('input'), 'Sunken Archive');
    expect(confirm().disabled).toBe(false);
    await click(confirm());
    await settle(20);
    expect(document.querySelector('.studio-tool-error')?.textContent).toContain('An agent portrait uses one of this project’s files (node-1~lead)');
    expect(server.mutations().at(-1)?.body).toEqual({ confirm_name: 'Sunken Archive' });

    refuse = false;
    await click(button('Purge'));
    await type(dialog()!.querySelector('input'), 'Sunken Archive');
    await click(confirm());
    await settle(20);
    expect(location.pathname).toBe('/studio');
  });
});

describe('membership events and refusals', () => {
  it('reads a purge from the stream and a project role refusal in words', async () => {
    expect(reduceStreamFrame(7, { event: 'project.purged', data: JSON.stringify({ project_id: PROJECT_ID, at: '2026-11-26T10:00:00.000Z' }), id: '' } as never)).toEqual({ seq: 7, action: { kind: 'purged', at: '2026-11-26T10:00:00.000Z' } });
    const error = await studioFailure(Response.json({ error: { code: 'PROJECT_ROLE_REQUIRED', message: 'Forbidden', details: { required: 'editor', role: 'viewer' } } }, { status: 403 }));
    expect(error.message).toBe('You need editor access to this project for that; you have viewer access. Ask a project owner.');
  });
});
