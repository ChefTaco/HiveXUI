// One function per Studio service route this console uses, typed by the vendored contract.
import type { z } from 'zod';
import {
  fileResponseSchema,
  listAgentsResponseSchema,
  listFilesResponseSchema,
  listProjectsResponseSchema,
  listTemplatesResponseSchema,
  taskResponseSchema,
  projectResponseSchema,
  snapshotResponseSchema,
  teamStateSchema,
  templateDetailSchema,
  templateVersionSchema,
  validationResultSchema,
  type createProjectRequestSchema,
  type createTemplateRequestSchema,
  type createTemplateVersionRequestSchema,
  type putTeamDraftRequestSchema,
  type saveAsTemplateRequestSchema,
  type teamDraftBodySchema,
  type updateProjectRequestSchema,
} from '@contracts/ardentstudio.generated';
import { segment, studio } from './client';

export type Project = z.infer<typeof projectResponseSchema>;
export type ProjectSummary = z.infer<typeof listProjectsResponseSchema>['projects'][number];
export type StudioFile = z.infer<typeof fileResponseSchema>;
export type Snapshot = z.infer<typeof snapshotResponseSchema>;
export type TeamState = z.infer<typeof teamStateSchema>;
export type TeamRevision = NonNullable<TeamState['current']>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type ValidationIssue = ValidationResult['issues'][number];
export type TemplateSummary = z.infer<typeof listTemplatesResponseSchema>['templates'][number];
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
export type Task = z.infer<typeof taskResponseSchema>;
export type Agent = z.infer<typeof listAgentsResponseSchema>['agents'][number];
export type AgentList = z.infer<typeof listAgentsResponseSchema>;
export type CreateProject = z.input<typeof createProjectRequestSchema>;
export type UpdateProject = z.input<typeof updateProjectRequestSchema>;
export type TeamDraftBody = z.input<typeof teamDraftBodySchema>;
export type PutTeamDraft = z.input<typeof putTeamDraftRequestSchema>;
export type CreateTemplate = z.input<typeof createTemplateRequestSchema>;
export type CreateTemplateVersion = z.input<typeof createTemplateVersionRequestSchema>;
export type SaveAsTemplate = z.input<typeof saveAsTemplateRequestSchema>;

type Signal = AbortSignal | undefined;
type Key = string | undefined;
const project = (id: string, rest = '') => `/projects/${segment(id)}${rest}`;

// Projects
export const listProjects = (query: { status?: 'active' | 'archived' | 'all'; q?: string }, signal?: Signal) =>
  studio.get('/projects', listProjectsResponseSchema, { query, signal }).then((result) => result.projects);
export const getProject = (id: string, signal?: Signal) => studio.get(project(id), projectResponseSchema, { signal });
export const createProject = (body: CreateProject, idempotencyKey?: Key) => studio.post('/projects', projectResponseSchema, { body, idempotencyKey });
export const updateProject = (id: string, body: UpdateProject, idempotencyKey?: Key) => studio.patch(project(id), projectResponseSchema, { body, idempotencyKey });
export const archiveProject = (id: string, idempotencyKey?: Key) => studio.post(project(id, '/archive'), projectResponseSchema, { idempotencyKey });
export const reopenProject = (id: string, idempotencyKey?: Key) => studio.post(project(id, '/reopen'), projectResponseSchema, { idempotencyKey });
export const getSnapshot = (id: string, signal?: Signal) => studio.get(project(id, '/snapshot'), snapshotResponseSchema, { signal });

// Files
export const listFiles = (id: string, signal?: Signal) => studio.get(project(id, '/files'), listFilesResponseSchema, { signal }).then((result) => result.files);
export const uploadFile = (id: string, file: Blob, name: string, mime: string, idempotencyKey?: Key) =>
  studio.upload(project(id, '/files'), fileResponseSchema, file, mime, { query: { name, purpose: 'reference' }, idempotencyKey });
export const reindexFile = (fileId: string, idempotencyKey?: Key) => studio.post(`/files/${segment(fileId)}/reindex`, fileResponseSchema, { idempotencyKey });

// Templates
export const listTemplates = (query: { kind?: 'agent' | 'team'; source?: 'seed' | 'user'; archived?: 'true' | 'false' | 'all'; q?: string }, signal?: Signal) =>
  studio.get('/templates', listTemplatesResponseSchema, { query, signal }).then((result) => result.templates);
export const getTemplate = (id: string, signal?: Signal) => studio.get(`/templates/${segment(id)}`, templateDetailSchema, { signal });
export const getTemplateVersion = (id: string, version: number, signal?: Signal) => studio.get(`/templates/${segment(id)}/versions/${version}`, templateVersionSchema, { signal });
export const createTemplate = (body: CreateTemplate, idempotencyKey?: Key) => studio.post('/templates', templateDetailSchema, { body, idempotencyKey });
export const createTemplateVersion = (id: string, body: CreateTemplateVersion, idempotencyKey?: Key) =>
  studio.post(`/templates/${segment(id)}/versions`, templateDetailSchema, { body, idempotencyKey });
export const archiveTemplate = (id: string, archived: boolean, idempotencyKey?: Key) =>
  studio.post(`/templates/${segment(id)}/archive`, templateDetailSchema, { body: { archived }, idempotencyKey });

// Team assignment
export const getTeam = (id: string, signal?: Signal) => studio.get(project(id, '/team'), teamStateSchema, { signal });
export const putTeamDraft = (id: string, body: PutTeamDraft, idempotencyKey?: Key) => studio.put(project(id, '/team/draft'), teamStateSchema, { body, idempotencyKey });
/** Read-only on the service; it takes no idempotency key, so none is sent. */
export const validateTeam = (id: string, body: TeamDraftBody | undefined, signal?: Signal) =>
  studio.post(project(id, '/team/validate'), validationResultSchema, { body: body ? { body } : {}, signal });
export const publishTeam = (id: string, draftRevision: number, idempotencyKey?: Key) =>
  studio.post(project(id, '/team/publish'), teamStateSchema, { body: { draft_revision: draftRevision }, idempotencyKey });
export const applyTemplate = (id: string, templateId: string, version: number, replaceDraft: boolean, idempotencyKey?: Key) =>
  studio.post(project(id, '/team/apply-template'), teamStateSchema, { body: { template_id: templateId, version, replace_draft: replaceDraft }, idempotencyKey });
export const saveTeamAsTemplate = (id: string, body: SaveAsTemplate, idempotencyKey?: Key) =>
  studio.post(project(id, '/team/save-as-template'), templateDetailSchema, { body, idempotencyKey });

// Tasks
/** Cancels the task if it is still active and creates the same work under the current team revision. */
export const reassignTask = (taskId: string, roleKey: string, idempotencyKey?: Key) =>
  studio.post(`/tasks/${segment(taskId)}/reassign`, taskResponseSchema, { body: { role_key: roleKey }, idempotencyKey });

// Agents
export const listAgents = (signal?: Signal) => studio.get('/agents', listAgentsResponseSchema, { signal });
