import { describe, expect, it } from 'vitest';
import { loadContent } from './content';
import { diffStats, diffText, sides } from './diff';
import type { Revision } from './api';
import { comment, deliverable, revision, REVISION_2_ID, REVISION_ID } from './fixtures';
import { canExport, decisionRules, DOCX_MIME, filterDeliverables, latestRevision, rendererKind } from './logic';

describe('the renderer registry', () => {
  it('picks a renderer by MIME type, with metadata and download for the rest', () => {
    expect(rendererKind('text/markdown; charset=utf-8')).toBe('markdown');
    expect(rendererKind('text/csv')).toBe('text');
    expect(rendererKind('image/svg+xml')).toBe('image');
    expect(rendererKind('application/pdf')).toBe('pdf');
    expect(rendererKind(DOCX_MIME)).toBe('docx');
    expect(rendererKind('application/zip')).toBe('fallback');
  });
});

describe('the decision bar', () => {
  const rules = (status: Revision['review_status'], extra: { final?: boolean; open?: boolean; readOnly?: boolean } = {}) => {
    const current = revision({ review_status: status });
    return decisionRules({
      deliverable: deliverable({ revisions: [current], final_revision_id: extra.final ? REVISION_ID : null }),
      revision: current,
      comments: extra.open ? [comment()] : [comment({ state: 'resolved' })],
      readOnly: extra.readOnly ?? false,
    });
  };

  it('needs a note to request changes unless an open comment says what to change', () => {
    expect(rules('unreviewed').changes).toEqual({ enabled: true, needsNote: true });
    expect(rules('unreviewed', { open: true }).changes).toEqual({ enabled: true, needsNote: false });
  });

  it('never repeats the decision a revision already has', () => {
    expect(rules('accepted').accept).toEqual({ enabled: false, reason: 'Already accepted' });
    expect(rules('rejected').reject.enabled).toBe(false);
    expect(rules('changes_requested').changes.enabled).toBe(false);
  });

  it('keeps a rejected revision from being final, and marks the final one', () => {
    expect(rules('rejected').final).toMatchObject({ enabled: false, reason: 'A rejected revision cannot be final' });
    expect(rules('accepted', { final: true }).final).toMatchObject({ enabled: false, isFinal: true });
    expect(rules('accepted').final).toMatchObject({ enabled: true, isFinal: false });
  });

  it('allows nothing in an archived project', () => {
    const archived = rules('unreviewed', { readOnly: true });
    expect([archived.accept, archived.changes, archived.reject, archived.final].every((rule) => !rule.enabled)).toBe(true);
  });

  it('exports only once a deliverable has a final revision', () => {
    expect(canExport([deliverable()])).toEqual({ enabled: false, reason: 'Mark a final revision first' });
    expect(canExport([deliverable({ final_revision_id: REVISION_ID })]).enabled).toBe(true);
  });
});

describe('the deliverable list', () => {
  const second = deliverable({ id: 'dlv_2', name: 'Map', kind: 'image', producer_role: 'lead', revisions: [revision({ id: REVISION_2_ID, deliverable_id: 'dlv_2', review_status: 'accepted', ardent: { agent_ref: 'node-1~lead' } })] });
  const all = [deliverable(), second];

  it('filters by status, producer and kind', () => {
    expect(filterDeliverables(all, { status: 'accepted', producer: '', kind: '' }).map((item) => item.name)).toEqual(['Map']);
    expect(filterDeliverables(all, { status: '', producer: 'world', kind: '' }).map((item) => item.name)).toEqual(['Adventure notes']);
    expect(filterDeliverables(all, { status: '', producer: '', kind: 'image' }).map((item) => item.name)).toEqual(['Map']);
  });

  it("narrows to one agent's work by its roles or the revisions its tasks registered", () => {
    expect(filterDeliverables(all, { status: '', producer: '', kind: '', agent: { ref: 'node-1~lead', roles: [] } }).map((item) => item.name)).toEqual(['Map']);
    expect(filterDeliverables(all, { status: '', producer: '', kind: '', agent: { ref: 'node-9~x', roles: ['world'] } }).map((item) => item.name)).toEqual(['Adventure notes']);
  });

  it('opens the newest revision', () => {
    expect(latestRevision(deliverable({ revisions: [revision({ revision: 2, id: REVISION_2_ID }), revision()] }))?.id).toBe(REVISION_2_ID);
  });
});

describe('compare', () => {
  it('diffs words and lines, and splits them into two sides', () => {
    const parts = diffText('The old bridge creaks.', 'The new bridge creaks loudly.', 'words');
    expect(parts.filter((part) => part.kind !== 'same').map((part) => `${part.kind}:${part.text}`)).toEqual(['del:old', 'add:new', 'add: loudly']);
    const { before, after } = sides(parts);
    expect(before.map((part) => part.text).join('')).toBe('The old bridge creaks.');
    expect(after.map((part) => part.text).join('')).toBe('The new bridge creaks loudly.');
    expect(diffStats(parts)).toEqual({ added: 2, removed: 1 });
    expect(diffText('a\nb\n', 'a\nc\n', 'lines').map((part) => part.kind)).toEqual(['same', 'del', 'add']);
  });
});

describe('received bytes', () => {
  it('check the digest and decode text files', async () => {
    const bytes = new TextEncoder().encode('Hello archive');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fetcher = async () => new Blob([bytes], { type: 'text/plain' });
    await expect(loadContent({ blob_sha256: digest, mime: 'text/plain', size: bytes.length }, undefined, fetcher)).resolves.toMatchObject({ verified: true, text: 'Hello archive' });
    await expect(loadContent({ blob_sha256: '0'.repeat(64), mime: 'text/plain', size: bytes.length }, undefined, fetcher)).resolves.toMatchObject({ verified: false });
    await expect(loadContent({ blob_sha256: digest, mime: 'image/png', size: bytes.length }, undefined, fetcher)).resolves.toMatchObject({ text: null });
  });
});
