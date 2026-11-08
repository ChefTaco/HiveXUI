// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { PROJECT_ID, serveStudio, snapshot, type StudioRequest } from '../test-fixtures';
import type { Deliverable, ReviewComment } from './api';
import { comment, deliverable, revision, REVISION_ID } from './fixtures';
import { DOCX_MIME } from './logic';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

const TEXT = 'The old bridge creaks over dark water.';
const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;
let bytes: Uint8Array<ArrayBuffer>;
let sha: string;
let item: Deliverable;
let comments: ReviewComment[];

function serve(extra: (request: StudioRequest) => unknown = () => undefined) {
  route = (request) => {
    const answer = extra(request);
    if (answer !== undefined) return answer;
    if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot();
    if (request.path === `/projects/${PROJECT_ID}/deliverables`) return { deliverables: [item], imports: [] };
    if (request.path === `/revisions/${REVISION_ID}`) return { revision: item.revisions[0], deliverable: item, comments, decisions: [] };
    if (request.path === `/blobs/${sha}`) return new Response(bytes as BodyInit, { headers: { 'content-type': 'application/octet-stream', 'x-blob-mime': item.revisions[0]!.mime } });
    return undefined;
  };
}

beforeEach(async () => {
  stubBrowser();
  bytes = new TextEncoder().encode(TEXT);
  sha = await hex(bytes);
  item = deliverable({ revisions: [revision({ blob_sha256: sha, size: bytes.length })] });
  comments = [];
  serve();
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

async function open(path = `/studio/p/${PROJECT_ID}/review`) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  // Renderers are lazy chunks: the first one a test run imports takes a moment.
  for (let index = 0; index < 200 && !view.container.querySelector('.review-text, .review-regions, .review-viewer .empty-state, .review-docx'); index += 1) await settle(10);
  await settle(5);
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const field = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('label.field')].find((node) => node.querySelector('.field-label')?.textContent === label)?.querySelector('input, textarea, select') as HTMLTextAreaElement | null;
const sent = (method: string, path: string) => server.requests.filter((request) => request.method === method && request.path === path);
const drawer = () => document.querySelector<HTMLElement>('.drawer')!;

describe('Deliverable Review', () => {
  it('lists deliverables with their status and shows the verified text', async () => {
    const root = await open();
    const list = root.querySelector('.review-list')!;
    expect(text(list)).toContain('Adventure notes');
    expect(text(list)).toContain('New');
    expect(root.querySelector('.review-text')?.textContent).toBe(TEXT);
    expect(text(root.querySelector('.review-meta')!)).toContain('verified');
  });

  it('anchors a comment to the selected text at its source offsets', async () => {
    serve((request) => (request.method === 'POST' && request.path === `/revisions/${REVISION_ID}/comments` ? comment({ anchor: (request.body as { anchor: ReviewComment['anchor'] }).anchor }) : undefined));
    const root = await open();
    const pre = root.querySelector('.review-text')!;
    await act(async () => {
      const range = document.createRange();
      range.setStart(pre.firstChild!, 4);
      range.setEnd(pre.firstChild!, 14);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      pre.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(text(root.querySelector('.review-composer')!)).toContain('“old bridge”');
    await type(field('Comment', root), 'Name the bridge.');
    await click(button('Comment', root));
    await settle();
    expect(sent('POST', `/revisions/${REVISION_ID}/comments`)[0]!.body).toEqual({ anchor: { kind: 'text', start: 4, end: 14, quote: 'old bridge', source_sha256: sha }, body_md: 'Name the bridge.' });
  });

  it('turns a drag on an image into a normalized region comment', async () => {
    bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    sha = await hex(bytes);
    item = deliverable({ name: 'Region map', revisions: [revision({ blob_sha256: sha, size: bytes.length, mime: 'image/png' })] });
    serve((request) => (request.method === 'POST' && request.path === `/revisions/${REVISION_ID}/comments` ? comment({ anchor: (request.body as { anchor: ReviewComment['anchor'] }).anchor }) : undefined));
    const root = await open();
    const layer = root.querySelector<SVGSVGElement>('.review-regions')!;
    layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => {
      layer.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 10 }));
      layer.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 60 }));
      layer.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 120, clientY: 60 }));
    });
    expect(text(root.querySelector('.review-composer')!)).toContain('Region at 10%, 10% · 50% × 50%');
    await type(field('Comment', root), 'Move the tower here.');
    await click(button('Comment', root));
    await settle();
    expect(sent('POST', `/revisions/${REVISION_ID}/comments`)[0]!.body).toEqual({ anchor: { kind: 'image', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, body_md: 'Move the tower here.' });
  });

  it('needs a note to request changes when no open comment says what to change', async () => {
    serve((request) => (request.method === 'POST' && request.path === `/revisions/${REVISION_ID}/decisions` ? { id: 'rvd_01HZX3K6Q1V8R2M4N6P8T0W001', project_id: PROJECT_ID, revision_id: REVISION_ID, decision: 'changes_requested', note_md: 'Shorter.', decided_by: 'operator', created_at: '2026-11-08T10:00:00.000Z' } : undefined));
    const root = await open();
    await click(button('Request changes', root.querySelector('.review-decisions')!));
    const confirm = button('Request changes', drawer().querySelector('.drawer-footer')!)!;
    expect(confirm.disabled).toBe(true);
    expect(text(drawer())).toContain('Required: there are no open comments');
    await type(field('Note', drawer()), 'Shorter.');
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    await settle();
    expect(sent('POST', `/revisions/${REVISION_ID}/decisions`)[0]!.body).toEqual({ decision: 'changes_requested', note_md: 'Shorter.' });
    expect(text(root)).toContain('Revision 1: Changes requested.');
  });

  it('sends ticked comments to the producer as a revision task', async () => {
    comments = [comment({ anchor: { kind: 'text', start: 4, end: 14, quote: 'old bridge', source_sha256: 'a'.repeat(64) } })];
    item = { ...item, comments: { open: 1, resolved: 0 } };
    serve((request) =>
      request.method === 'POST' && request.path === `/projects/${PROJECT_ID}/revision-requests`
        ? { message: { id: 'msg_1' }, task: { id: 'tsk_9', title: 'Revise Adventure notes' }, comments }
        : undefined,
    );
    const root = await open();
    const card = root.querySelector('.review-comment')!;
    expect(text(card)).toContain('“old bridge”');
    await click(card.querySelector('input[type="checkbox"]'));
    await click(button('Request revision (1)', root));
    expect(text(drawer())).toContain('Worldbuilder · producer');
    await click(button('Send revision task', drawer()));
    await settle();
    expect(sent('POST', `/projects/${PROJECT_ID}/revision-requests`)[0]!.body).toEqual({ comment_ids: [comments[0]!.id], role_key: 'world', instructions_md: 'Please address this comment on Adventure notes.' });
  });

  it('marks a final revision and exports once one exists', async () => {
    serve((request) => (request.method === 'POST' && request.path === `/deliverables/${item.id}/final` ? { ...item, final_revision_id: REVISION_ID } : undefined));
    const root = await open();
    const bar = root.querySelector('.review-decisions')!;
    expect(button('Export package', bar)!.disabled).toBe(true);
    expect(text(bar)).toContain('Mark a final revision first');
    await click(button('Mark final', bar));
    await settle();
    expect(sent('POST', `/deliverables/${item.id}/final`)[0]!.body).toEqual({ revision_id: REVISION_ID });
  });

  it("says Word preview isn't available yet when the service cannot convert DOCX", async () => {
    item = deliverable({ name: 'Adventure book', revisions: [revision({ blob_sha256: sha, size: bytes.length, mime: DOCX_MIME })] });
    serve((request) => (request.path === `/revisions/${REVISION_ID}/docx` ? Response.json({ error: { code: 'DOCX_CONVERTER_UNAVAILABLE', message: 'The canvas Word codec is not installed' } }, { status: 501 }) : undefined));
    const root = await open();
    expect(text(root)).toContain("Word preview isn't available yet");
    expect(button('Download', root.querySelector('.review-viewer')!)).toBeDefined();
    expect(text(root.querySelector('.review-composer')!)).toContain('Whole file');
  });

  it("filters Agent Studio's Review tab to the agent's own deliverables", async () => {
    const other = deliverable({ id: 'dlv_01HZX3K6Q1V8R2M4N6P8T0W009', name: 'Lead summary', producer_role: 'lead', revisions: [revision({ id: 'drv_01HZX3K6Q1V8R2M4N6P8T0W009', deliverable_id: 'dlv_01HZX3K6Q1V8R2M4N6P8T0W009', blob_sha256: sha, ardent: { agent_ref: 'node-1~lead' } })] });
    serve((request) => {
      if (request.path === `/projects/${PROJECT_ID}/deliverables`) return { deliverables: [item, other], imports: [] };
      if (request.path === '/agents') return { agents: [], available_count: 0, magnus: { state: 'ok', error: null } };
      return undefined;
    });
    const root = await open(`/studio/p/${PROJECT_ID}/agents/node-1~world?tab=review`);
    const list = root.querySelector('.review-list')!;
    expect(text(list)).toContain('Adventure notes');
    expect(text(list)).not.toContain('Lead summary');
  });
});
