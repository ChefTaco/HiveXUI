// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { acquireProjectStore, resetProjectStores } from '../state/project-store';
import { AT, link, project, PROJECT_ID, serveStudio, snapshot, type StudioRequest } from '../test-fixtures';
import { linkErrors, normalizeUrl, titleFromUrl } from './links';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

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
  await settle();
  await settle();
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const field = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)?.querySelector('input, textarea, select') as HTMLInputElement | null;
const SECOND = 'lnk_01HZX3K6Q1V8R2M4N6P8T0W002';
const links = () => document.querySelector('[aria-label="Links"]');

function serve(initial = [link()]) {
  route = (request) => {
    if (request.path === `/projects/${PROJECT_ID}`) return project();
    if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ files: [], links: initial });
    if (request.method === 'POST' && request.path === `/projects/${PROJECT_ID}/links`) {
      const body = request.body as { url: string; title: string; note_md: string };
      if (normalizeUrl(body.url) === initial[0]!.url) return Response.json({ error: { code: 'LINK_EXISTS', message: 'This project already has this URL' } }, { status: 409 });
      return Response.json(link({ id: SECOND, url: normalizeUrl(body.url), title: body.title, note_md: body.note_md, knowledge: { ...link().knowledge, state: 'pending', chunks: null } }), { status: 201 });
    }
    if (request.method === 'PATCH' && request.path === `/links/${link().id}`) return link({ ...(request.body as object), updated_at: AT });
    if (request.method === 'DELETE' && request.path === `/links/${link().id}`) return link({ deleted_at: AT, knowledge: { ...link().knowledge, state: 'not_indexed' } });
    if (request.method === 'POST' && request.path === `/links/${link().id}/reindex`) return link({ knowledge: { ...link().knowledge, state: 'pending', error: null } });
    return undefined;
  };
}

describe('link references in the create flow', () => {
  it('adds a link, and names the existing one when the address is already there', async () => {
    serve();
    const root = await open(`/studio/new?project=${PROJECT_ID}&step=2`);
    expect(text(links()!)).toContain('Tide tables');
    expect(text(links()!)).toContain('Indexed');

    await type(field('Address', root), 'ftp://example.com/charts');
    await click(button('Add link', root));
    expect(text(root)).toContain('Use an http or https address');
    expect(server.mutations()).toHaveLength(0);

    await type(field('Address', root), 'https://example.com/charts');
    await type(field('Title', root), 'Sea charts');
    await type(field('Note', root), 'Depths near the archive.');
    await click(button('Add link', root));
    await settle();
    expect(server.mutations()[0]).toMatchObject({ method: 'POST', path: `/projects/${PROJECT_ID}/links`, body: { url: 'https://example.com/charts', title: 'Sea charts', note_md: 'Depths near the archive.' } });
    expect(server.mutations()[0]!.headers.get('x-idempotency-key')).toBeTruthy();
    expect(text(links()!)).toContain('Sea charts');
    expect(text(links()!)).toContain('Queued');
    // The form is cleared for the next link.
    expect(field('Address', root)!.value).toBe('');

    await type(field('Address', root), 'HTTPS://EXAMPLE.com/tides');
    expect(field('Title', root)!.placeholder).toBe('example.com/tides');
    await click(button('Add link', root));
    await settle();
    expect(text(root)).toContain('This project already has this address as “Tide tables”.');
    expect((server.mutations().at(-1)!.body as { title: string }).title).toBe('example.com/tides');
    await click(button('Edit that link', root));
    expect(button('Save link', root)).toBeDefined();
    expect((links()!.querySelector('[data-link-id] input') as HTMLInputElement).value).toBe('https://example.com/tides');
  });

  it('edits only what changed, removes after confirmation, and retries failed indexing', async () => {
    serve([link({ knowledge: { ...link().knowledge, state: 'failed', error: 'HiveMem did not answer', chunks: null } })]);
    const root = await open(`/studio/new?project=${PROJECT_ID}&step=2`);
    expect(text(links()!)).toContain('HiveMem did not answer');
    await click(button('Retry', links()!));
    await settle();
    expect(server.mutations().map((request) => `${request.method} ${request.path}`)).toEqual([`POST /links/${link().id}/reindex`]);
    expect(text(links()!)).toContain('Queued');

    await click(button('Edit Tide tables', root));
    const row = links()!.querySelector('[data-link-id]')!;
    await type(field('Title', row), 'Tide charts');
    await click(button('Save link', row));
    await settle();
    expect(server.mutations().at(-1)).toMatchObject({ method: 'PATCH', path: `/links/${link().id}`, body: { title: 'Tide charts' } });
    expect(text(links()!)).toContain('Tide charts');
    expect(button('Save link', root)).toBeUndefined();

    await click(button('Remove Tide charts', root));
    expect(dialog()?.textContent).toContain('Remove Tide charts?');
    expect(server.mutations().filter((request) => request.method === 'DELETE')).toHaveLength(0);
    await click(button('Remove link', dialog()!));
    await settle();
    expect(server.mutations().at(-1)).toMatchObject({ method: 'DELETE', path: `/links/${link().id}` });
    expect(links()).toBeNull();
    expect(text(root)).toContain('No links yet');
  });

  it('follows sync state from the stream and never renders a non-web address as a link', async () => {
    serve([link(), link({ id: SECOND, url: 'javascript:alert(1)', title: 'Odd entry' })]);
    await open(`/studio/new?project=${PROJECT_ID}&step=2`);
    const anchors = [...links()!.querySelectorAll('a')];
    expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual(['https://example.com/tides']);
    expect(anchors[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(text(links()!)).toContain('Odd entry');

    const { store, release } = acquireProjectStore(PROJECT_ID);
    await act(async () => {
      store.receive({ event: 'link.updated', data: JSON.stringify({ seq: 6, project_id: PROJECT_ID, type: 'link.updated', at: AT, payload: { link: link({ knowledge: { ...link().knowledge, state: 'indexing' } }) } }) });
      store.receive({ event: 'link.deleted', data: JSON.stringify({ seq: 7, project_id: PROJECT_ID, type: 'link.deleted', at: AT, payload: { link: link({ id: SECOND, url: 'javascript:alert(1)', title: 'Odd entry', deleted_at: AT }) } }) });
    });
    release();
    expect(text(links()!)).toContain('Indexing');
    expect(text(links()!)).not.toContain('Odd entry');
  });
});

describe('link references in the Files drawer', () => {
  it('lists links beside files and counts both on the button', async () => {
    serve();
    const root = await open(`/studio/p/${PROJECT_ID}/room`);
    const files = button(/^Files/, root)!;
    expect(files.getAttribute('aria-label')).toBe('Files and links, 1');
    await click(files);
    const drawer = document.querySelector('aside[aria-label="Files and links"]')!;
    expect(text(drawer)).toContain('Tide tables');
    expect(button('Add link', drawer)).toBeDefined();
  });
});

describe('link rules', () => {
  it('accepts http and https without credentials, and offers a title from the address', () => {
    expect(linkErrors({ url: 'https://example.com/a', title: 'A', note: '' })).toEqual({});
    expect(linkErrors({ url: 'https://user:secret@example.com/', title: 'A', note: '' }).url).toBeDefined();
    expect(linkErrors({ url: 'mailto:someone@example.com', title: 'A', note: '' }).url).toBeDefined();
    expect(linkErrors({ url: '', title: '', note: '' })).toEqual({ url: 'Enter the address.', title: 'Give the link a title.' });
    // An empty title falls back to the one suggested from the address.
    expect(linkErrors({ url: 'https://example.com/a', title: '', note: '' })).toEqual({});
    expect(titleFromUrl('https://www.example.com/guides/tides/')).toBe('example.com/guides/tides');
    expect(normalizeUrl('HTTPS://Example.com')).toBe('https://example.com/');
  });
});
