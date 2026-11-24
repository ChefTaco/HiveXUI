// Deliverable Review's routes on the Studio service, typed by the vendored contract. Bytes come
// from GET /blobs/{sha256} as an attachment; the page checks their digest before showing them.
import type { z } from 'zod';
import {
  commentResponseSchema,
  docxDocumentResponseSchema,
  exportResponseSchema,
  listExportsResponseSchema,
  reviewDecisionResponseSchema,
  revisionRequestResponseSchema,
  type commentAnchorSchema,
  type reviewDecisionKindSchema,
} from '@contracts/ardentstudio.generated';
import { apiFetch } from '../../../lib/transport';
import { randomId } from '../../magnus/api/client';
import { segment, studio, studioFailure, studioPath } from '../api/client';
import { studioDeliverableSchema, studioDeliverablesSchema, studioRevisionDetailSchema } from '../api/execution';

export type Deliverable = z.infer<typeof studioDeliverableSchema>;
export type Revision = Deliverable['revisions'][number];
export type ArtifactImport = z.infer<typeof studioDeliverablesSchema>['imports'][number];
export type RevisionDetail = z.infer<typeof studioRevisionDetailSchema>;
export type ReviewComment = z.infer<typeof commentResponseSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionResponseSchema>;
export type DecisionKind = z.infer<typeof reviewDecisionKindSchema>;
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type ExportRecord = z.infer<typeof exportResponseSchema>;
export type DocxDocument = z.infer<typeof docxDocumentResponseSchema>;

type Signal = AbortSignal | undefined;
type Key = string | undefined;
const project = (id: string, rest: string) => `/projects/${segment(id)}${rest}`;

export const listDeliverables = (projectId: string, signal?: Signal) => studio.get(project(projectId, '/deliverables'), studioDeliverablesSchema, { signal });
export const getRevision = (revisionId: string, signal?: Signal) => studio.get(`/revisions/${segment(revisionId)}`, studioRevisionDetailSchema, { signal });
export const addComment = (revisionId: string, body: { anchor: CommentAnchor; body_md: string }, idempotencyKey?: Key) =>
  studio.post(`/revisions/${segment(revisionId)}/comments`, commentResponseSchema, { body, idempotencyKey });
export const resolveComment = (commentId: string, idempotencyKey?: Key) => studio.post(`/comments/${segment(commentId)}/resolve`, commentResponseSchema, { idempotencyKey });
export const decide = (revisionId: string, body: { decision: DecisionKind; note_md: string }, idempotencyKey?: Key) =>
  studio.post(`/revisions/${segment(revisionId)}/decisions`, reviewDecisionResponseSchema, { body, idempotencyKey });
export const markFinal = (deliverableId: string, revisionId: string, idempotencyKey?: Key) =>
  studio.post(`/deliverables/${segment(deliverableId)}/final`, studioDeliverableSchema, { body: { revision_id: revisionId }, idempotencyKey });
export const requestRevision = (projectId: string, body: { comment_ids: string[]; role_key?: string; instructions_md: string }, idempotencyKey?: Key) =>
  studio.post(project(projectId, '/revision-requests'), revisionRequestResponseSchema, { body, idempotencyKey });
export const listExports = (projectId: string, signal?: Signal) => studio.get(project(projectId, '/exports'), listExportsResponseSchema, { signal }).then((result) => result.exports);
export const createExport = (projectId: string, deliverableIds: string[] | undefined, idempotencyKey?: Key) =>
  studio.post(project(projectId, '/exports'), exportResponseSchema, { body: deliverableIds ? { deliverable_ids: deliverableIds } : {}, idempotencyKey });
/** 501 DOCX_CONVERTER_UNAVAILABLE until the Word codec package is published. */
export const getRevisionDocx = (revisionId: string, signal?: Signal) => studio.get(`/revisions/${segment(revisionId)}/docx`, docxDocumentResponseSchema, { signal });

/** Large files take a while on a slow link. */
const BLOB_TIMEOUT_MS = 10 * 60_000;

/** The stored bytes, typed with the MIME the caller expects so a blob: URL renders. */
export async function fetchBlob(sha256: string, mime: string, signal?: Signal): Promise<Blob> {
  const timeout = AbortSignal.timeout(BLOB_TIMEOUT_MS);
  const response = await apiFetch(studioPath(`/blobs/${segment(sha256)}`), {
    headers: { Accept: 'application/octet-stream', 'x-trace-id': randomId() },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw await studioFailure(response);
  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: mime });
}

/** Lowercase hex SHA-256 of the bytes. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One request for the bytes from `start` on (a Range request when start > 0). The caller reads the body. */
export async function fetchBlobStream(sha256: string, options: { start?: number; signal?: Signal } = {}, send: typeof apiFetch = apiFetch): Promise<Response> {
  const timeout = AbortSignal.timeout(BLOB_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/octet-stream', 'x-trace-id': randomId() };
  if (options.start) headers.Range = `bytes=${options.start}-`;
  const response = await send(studioPath(`/blobs/${segment(sha256)}`), { headers, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  if (!response.ok) throw await studioFailure(response);
  return response;
}

export interface DownloadProgress {
  received: number;
  /** The whole size, when the answer or the record says it. */
  total: number | null;
  /** How many times the download picked up again after the connection dropped. */
  resumes: number;
  phase: 'downloading' | 'resuming' | 'verifying';
}

/** The bytes did not hash to the digest the record names; nothing was saved. */
export class DigestMismatchError extends Error {
  override name = 'DigestMismatchError';
  constructor() {
    super('The downloaded file does not match its recorded SHA-256, so it was not saved. Try again; tell an administrator if it happens again.');
  }
}

/** The most times one download picks up after a dropped connection before it gives up. */
export const MAX_RESUMES = 5;
const totalOf = (response: Response, start: number): number | null => {
  const range = /\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '')?.[1];
  if (range) return Number(range);
  const length = response.headers.get('content-length');
  return length && /^\d+$/.test(length) ? start + Number(length) : null;
};

/**
 * The full-quality bytes of an artifact, streamed with progress. A dropped connection resumes from the
 * bytes already received with `Range: bytes=<n>-`, up to MAX_RESUMES times in this session; a server
 * that answers a range with the whole file starts over. The bytes are checked against `sha256` before
 * they are returned (the chunks are hashed once, at the end: an artifact is at most 64 MiB).
 */
export async function downloadOriginal(
  sha256: string,
  options: { mime: string; size?: number | undefined; onProgress?: ((progress: DownloadProgress) => void) | undefined; signal?: Signal; send?: typeof apiFetch | undefined },
): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  let resumes = 0;
  let total: number | null = options.size ?? null;
  const report = (phase: DownloadProgress['phase']) => options.onProgress?.({ received, total, resumes, phase });
  for (;;) {
    try {
      const response = await fetchBlobStream(sha256, { start: received, signal: options.signal }, options.send);
      if (received > 0 && response.status !== 206) {
        // The range was not honoured: the answer is the whole file again.
        chunks.length = 0;
        received = 0;
      } else if (received > 0 && !new RegExp(`^bytes ${received}-`).test(response.headers.get('content-range') ?? '')) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('The server resumed the download at the wrong place');
      }
      total = totalOf(response, received) ?? total;
      if (!response.body) throw new TypeError('The download had no body');
      const reader = response.body.getReader();
      report('downloading');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new Uint8Array(value));
        received += value.byteLength;
        report('downloading');
      }
      if (total !== null && received < total) throw new TypeError('The connection closed before the whole file arrived');
      break;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A product's refusal or a wrong answer is final; only a dropped connection is picked up again.
      const dropped = error instanceof TypeError || (error instanceof DOMException && (error.name === 'NetworkError' || error.name === 'TimeoutError' || error.name === 'AbortError'));
      if (!dropped || resumes >= MAX_RESUMES) throw error;
      resumes += 1;
      report('resuming');
    }
  }
  report('verifying');
  const blob = new Blob(chunks, { type: options.mime });
  if ((await sha256Hex(blob)) !== sha256) throw new DigestMismatchError();
  return blob;
}
