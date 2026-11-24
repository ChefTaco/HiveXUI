// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../../magnus/test-dom';
import { downloadOriginal, DigestMismatchError, MAX_RESUMES, type ArtifactImport } from './api';
import { displayRendition, DownloadOriginal, ImportStrip, importFailure, previewLabel, provenanceOf } from './delivery';
import { revision } from './fixtures';

const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const BYTES = new Uint8Array(Array.from({ length: 1000 }, (_, index) => index % 251));

/** A body that sends `bytes` and then fails like a dropped connection when `dropAt` is given. */
function body(bytes: Uint8Array<ArrayBuffer>, dropAt?: number): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(bytes.slice(0, dropAt ?? bytes.length));
        return;
      }
      if (dropAt !== undefined) controller.error(new TypeError('network error'));
      else controller.close();
    },
  });
}

describe('Download original', () => {
  let sha: string;
  beforeEach(async () => {
    sha = await hex(BYTES);
  });

  it('resumes with Range from the bytes received after the connection drops, and returns the verified bytes', async () => {
    const ranges: Array<string | null> = [];
    let call = 0;
    const send = vi.fn(async (_path: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range');
      ranges.push(range);
      call += 1;
      if (call === 1) return new Response(body(BYTES, 400), { status: 200, headers: { 'content-length': '1000' } });
      // A second drop before any byte, then the rest.
      if (call === 2) return Promise.reject(new TypeError('Failed to fetch'));
      const start = Number(/bytes=(\d+)-/.exec(range ?? '')![1]);
      return new Response(body(BYTES.slice(start)), { status: 206, headers: { 'content-range': `bytes ${start}-999/1000` } });
    });
    const progress: string[] = [];
    const blob = await downloadOriginal(sha, { mime: 'image/png', size: 1000, send, onProgress: (item) => progress.push(`${item.phase}:${item.received}:${item.resumes}`) });
    expect(ranges).toEqual([null, 'bytes=400-', 'bytes=400-']);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
    expect(blob.type).toBe('image/png');
    expect(progress).toContain('resuming:400:1');
    expect(progress).toContain('resuming:400:2');
    expect(progress.at(-1)).toBe('verifying:1000:2');
  });

  it('gives up after the fifth resume', async () => {
    const send = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(downloadOriginal(sha, { mime: 'image/png', size: 1000, send })).rejects.toThrow('Failed to fetch');
    expect(send).toHaveBeenCalledTimes(MAX_RESUMES + 1);
  });

  it('starts over when a server answers the range with the whole file', async () => {
    let call = 0;
    const send = vi.fn(async () => {
      call += 1;
      return call === 1 ? new Response(body(BYTES, 300), { status: 200, headers: { 'content-length': '1000' } }) : new Response(body(BYTES), { status: 200, headers: { 'content-length': '1000' } });
    });
    const blob = await downloadOriginal(sha, { mime: 'image/png', size: 1000, send });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
  });

  it('refuses bytes that do not match the digest', async () => {
    const send = vi.fn(async () => new Response(body(BYTES), { status: 200 }));
    await expect(downloadOriginal('0'.repeat(64), { mime: 'image/png', send })).rejects.toBeInstanceOf(DigestMismatchError);
  });

  it('does not resume a refusal from the service', async () => {
    const send = vi.fn(async () => Response.json({ error: { code: 'FORBIDDEN', message: 'Not yours' } }, { status: 403 }));
    await expect(downloadOriginal(sha, { mime: 'image/png', send })).rejects.toThrow('Not yours');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('the Download original button', () => {
  let view: Mounted | undefined;
  beforeEach(() => stubBrowser());
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
  });

  it('saves nothing when the digest does not match, and says why', async () => {
    const save = vi.fn();
    const download = vi.fn(async () => Promise.reject(new DigestMismatchError()));
    view = await mount(<DownloadOriginal revision={revision({ mime: 'image/png', size: 1000 })} name="map.png" download={download} save={save} />);
    await click(button('Download original', view.container));
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('does not match its recorded SHA-256');
  });

  it('shows progress while it downloads and saves the verified original under its name', async () => {
    const save = vi.fn();
    let finish!: () => void;
    const download = vi.fn(
      async (_sha: string, options: Parameters<typeof downloadOriginal>[1]) =>
        new Promise<Blob>((resolve) => {
          options.onProgress?.({ received: 400, total: 1000, resumes: 1, phase: 'downloading' });
          finish = () => resolve(new Blob(['x']));
        }),
    );
    view = await mount(<DownloadOriginal revision={revision({ mime: 'image/png', size: 1000 })} name="map.png" download={download} save={save} />);
    await click(button('Download original', view.container));
    expect(view.container.querySelector('progress')?.getAttribute('value')).toBe('400');
    expect(view.container.textContent).toContain('400 B of 1000 B · resumed 1 time');
    await click(button('Stop downloading map.png', view.container));
    finish();
    await settle();
    // A stopped download is never saved.
    expect(save).not.toHaveBeenCalled();
    await click(button('Download original', view.container));
    finish();
    await settle();
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'map.png');
    expect(view.container.textContent).toContain('Saved; the SHA-256 matches.');
  });
});

describe('renditions and provenance', () => {
  const original = { role: 'original' as const, sha256: 'a'.repeat(64), mime: 'image/png', size: 18_400_000, purpose: 'download', width: 8000, height: 8000, has_alpha: true };
  const preview = { role: 'preview' as const, sha256: 'b'.repeat(64), mime: 'image/png', size: 400_000, purpose: 'display', width: 1600, height: 1600, has_alpha: true };

  it('shows a fitting preview inline and keeps the original for download', () => {
    const item = revision({ blob_sha256: original.sha256, mime: 'image/png', size: original.size, renditions: [original, preview] });
    expect(displayRendition(item).preview?.sha256).toBe(preview.sha256);
    expect(previewLabel(item)).toBe('Preview · original 17.5 MB PNG');
  });

  it('keeps showing the original when no preview keeps a PNG transparent, or there are none', () => {
    const flat = { ...preview, mime: 'image/jpeg', has_alpha: false };
    expect(displayRendition(revision({ blob_sha256: original.sha256, mime: 'image/png', renditions: [original, flat] })).preview).toBeNull();
    expect(displayRendition(revision({ renditions: [] })).preview).toBeNull();
    // Studio sends null for what it does not know.
    expect(displayRendition(revision({ blob_sha256: original.sha256, mime: 'image/webp', renditions: [{ ...original, mime: 'image/webp' }, { ...preview, mime: 'image/webp', width: null, height: null, has_alpha: null, purpose: null }] })).preview?.sha256).toBe(preview.sha256);
  });

  it('reads manifest 1.1 provenance', () => {
    const facts = provenanceOf(revision({ ardent: { agent_ref: 'node-1~world', task_id: 'task-9', manifest: { schema_version: '1.1', revision: 2, supersedes_sha256: 'c'.repeat(64), license: 'CC-BY-4.0', provenance: { producer: 'world', producer_task_id: 'task-9', execution: { root: 'hx1:studio:i:request:m', step: 'hx1:ardent:n.p:step:task-9/3' } } } } }));
    expect(facts).toMatchObject({ schemaVersion: '1.1', agent: 'node-1~world', producerTask: 'task-9', executionRoot: 'hx1:studio:i:request:m', manifestRevision: 2, license: 'CC-BY-4.0' });
    expect(provenanceOf(revision({ ardent: null }))).toMatchObject({ schemaVersion: null, executionRoot: null });
  });
});

describe('the import strip', () => {
  let view: Mounted | undefined;
  beforeEach(() => stubBrowser());
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
  });
  const item = (overrides: Partial<ArtifactImport> = {}): ArtifactImport => ({
    artifact_id: 'f'.repeat(32), task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W001', agent_ref: 'node-1~world', name: 'world-map.png', mime: 'image/png', size: 20 * 1024 * 1024,
    sha256: 'a'.repeat(64), state: 'pending', attempts: 1, error: null, revision_id: null, updated_at: '2026-11-08T10:00:00.000Z', received_bytes: 10 * 1024 * 1024, transfer: 'range', resumes: 1, error_code: null, ...overrides,
  });
  it('shows a transfer resuming with its progress, and a failure with what it means', async () => {
    view = await mount(<ImportStrip imports={[item(), item({ artifact_id: 'e'.repeat(32), name: 'notes.md', state: 'failed', error: 'digest', error_code: 'DIGEST_MISMATCH' }), item({ artifact_id: 'd'.repeat(32), state: 'imported' })]} />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('10.0 MB of 20.0 MB · resumed 1 time');
    expect(view.container.querySelector('progress[aria-label="Receiving world-map.png"]')?.getAttribute('value')).toBe(String(10 * 1024 * 1024));
    expect(text).toContain('Not received: the bytes did not match their recorded digest.');
    expect(view.container.querySelectorAll('[data-import]')).toHaveLength(2);
  });
  it('names the compatibility outcome', () => {
    expect(importFailure(item({ state: 'failed', error_code: 'TRANSFER_REQUIRES_V2' }))).toContain('artifact transfer v2');
  });
});
