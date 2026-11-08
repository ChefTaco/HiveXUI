// Agent Studio's routes on the Studio service, typed by the vendored contract. The agent itself
// (identity, skills, configuration, memory) is read and changed through Magnus with the shared
// Ardent profile client; these are the parts Studio owns: presentation, drafts, previews, Apply and
// development records.
import type { z } from 'zod';
import {
  agentDraftResponseSchema,
  applyResponseSchema,
  createDevelopmentCommentResponseSchema,
  developmentResponseSchema,
  listTasksResponseSchema,
  presentationSchema,
  type APPLY_PARTS,
  type agentDraftBodySchema,
  type agentDraftBaseSchema,
  type applyResultSchema,
  type developmentRecordSchema,
  type putPresentationRequestSchema,
} from '@contracts/ardentstudio.generated';
import { segment, studio } from '../api/client';

export type Presentation = z.infer<typeof presentationSchema>;
export type PutPresentation = z.input<typeof putPresentationRequestSchema>;
export type AgentDraft = NonNullable<z.infer<typeof agentDraftResponseSchema>['draft']>;
export type DraftBody = z.infer<typeof agentDraftBodySchema>;
export type DraftBase = z.infer<typeof agentDraftBaseSchema>;
export type ApplyPart = (typeof APPLY_PARTS)[number];
export type ApplyResponse = z.infer<typeof applyResponseSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
export type Development = z.infer<typeof developmentResponseSchema>;
export type DevelopmentRecord = z.infer<typeof developmentRecordSchema>;

type Signal = AbortSignal | undefined;
type Key = string | undefined;
export const agentPath = (ref: string, rest = '') => `/agents/${segment(ref)}${rest}`;

export const getPresentation = (ref: string, signal?: Signal) => studio.get(agentPath(ref, '/presentation'), presentationSchema, { signal });
export const putPresentation = (ref: string, body: PutPresentation, idempotencyKey?: Key) => studio.put(agentPath(ref, '/presentation'), presentationSchema, { body, idempotencyKey });

export const getDraft = (ref: string, signal?: Signal) => studio.get(agentPath(ref, '/draft'), agentDraftResponseSchema, { signal }).then((result) => result.draft);
export const putDraft = (ref: string, body: { base: DraftBase; draft: DraftBody }, idempotencyKey?: Key) =>
  studio.put(agentPath(ref, '/draft'), agentDraftResponseSchema, { body, idempotencyKey }).then((result) => result.draft);
export const discardDraft = (ref: string, idempotencyKey?: Key) => studio.delete(agentPath(ref, '/draft'), agentDraftResponseSchema, { idempotencyKey });
export const applyDraft = (ref: string, parts: readonly ApplyPart[], idempotencyKey?: Key) => studio.post(agentPath(ref, '/apply'), applyResponseSchema, { body: { parts }, idempotencyKey });

export const listDevelopment = (ref: string, query: { after?: string | undefined; kind?: string | undefined; limit?: number }, signal?: Signal) =>
  studio.get(agentPath(ref, '/development'), developmentResponseSchema, { query, signal });
export const commentOnRecord = (ref: string, recordId: string, body: { body_md: string; relay_to_agent: boolean }, idempotencyKey?: Key) =>
  studio.post(agentPath(ref, `/development/${segment(recordId)}/comments`), createDevelopmentCommentResponseSchema, { body, idempotencyKey });

/** Every Studio task of a project, finished ones included, to link development records to it. */
export const listProjectTasks = (projectId: string, signal?: Signal) =>
  studio.get(`/projects/${segment(projectId)}/tasks`, listTasksResponseSchema, { query: { state: 'all' }, signal }).then((result) => result.tasks);
