// Deliverable Review's routes on the Studio service, typed by the vendored contract. Bytes come
// from GET /blobs/{sha256} as an attachment; the page checks their digest before showing them.
import type { z } from 'zod';
import {
  commentResponseSchema,
  deliverableResponseSchema,
  docxDocumentResponseSchema,
  exportResponseSchema,
  listDeliverablesResponseSchema,
  listExportsResponseSchema,
  reviewDecisionResponseSchema,
  revisionDetailResponseSchema,
  revisionRequestResponseSchema,
  type commentAnchorSchema,
  type reviewDecisionKindSchema,
} from '@contracts/ardentstudio.generated';
import { apiFetch } from '../../../lib/transport';
import { randomId } from '../../magnus/api/client';
import { segment, studio, studioFailure, studioPath } from '../api/client';

export type Deliverable = z.infer<typeof deliverableResponseSchema>;
export type Revision = Deliverable['revisions'][number];
export type ArtifactImport = z.infer<typeof listDeliverablesResponseSchema>['imports'][number];
export type RevisionDetail = z.infer<typeof revisionDetailResponseSchema>;
export type ReviewComment = z.infer<typeof commentResponseSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionResponseSchema>;
export type DecisionKind = z.infer<typeof reviewDecisionKindSchema>;
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type ExportRecord = z.infer<typeof exportResponseSchema>;
export type DocxDocument = z.infer<typeof docxDocumentResponseSchema>;

type Signal = AbortSignal | undefined;
type Key = string | undefined;
const project = (id: string, rest: string) => `/projects/${segment(id)}${rest}`;

export const listDeliverables = (projectId: string, signal?: Signal) => studio.get(project(projectId, '/deliverables'), listDeliverablesResponseSchema, { signal });
export const getRevision = (revisionId: string, signal?: Signal) => studio.get(`/revisions/${segment(revisionId)}`, revisionDetailResponseSchema, { signal });
export const addComment = (revisionId: string, body: { anchor: CommentAnchor; body_md: string }, idempotencyKey?: Key) =>
  studio.post(`/revisions/${segment(revisionId)}/comments`, commentResponseSchema, { body, idempotencyKey });
export const resolveComment = (commentId: string, idempotencyKey?: Key) => studio.post(`/comments/${segment(commentId)}/resolve`, commentResponseSchema, { idempotencyKey });
export const decide = (revisionId: string, body: { decision: DecisionKind; note_md: string }, idempotencyKey?: Key) =>
  studio.post(`/revisions/${segment(revisionId)}/decisions`, reviewDecisionResponseSchema, { body, idempotencyKey });
export const markFinal = (deliverableId: string, revisionId: string, idempotencyKey?: Key) =>
  studio.post(`/deliverables/${segment(deliverableId)}/final`, deliverableResponseSchema, { body: { revision_id: revisionId }, idempotencyKey });
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
