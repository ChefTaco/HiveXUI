// One function per Studio service route this console uses, typed by the vendored contract.
import type { z } from 'zod';
import {
  activitySchema,
  conversationResponseSchema,
  decisionResponseSchema,
  layoutResponseSchema,
  listConversationsResponseSchema,
  listDecisionsResponseSchema,
  listDeliverablesResponseSchema,
  listMessagesResponseSchema,
  listTasksResponseSchema,
  messageSchema,
  postMessageResponseSchema,
  taskResponseSchema,
  fileResponseSchema,
  listAgentsResponseSchema,
  listFilesResponseSchema,
  listProjectsResponseSchema,
  listTemplatesResponseSchema,
  projectResponseSchema,
  snapshotResponseSchema,
  teamStateSchema,
  templateDetailSchema,
  templateVersionSchema,
  validationResultSchema,
  type answerRequestSchema,
  type createConversationRequestSchema,
  type createDecisionRequestSchema,
  type createTaskRequestSchema,
  type postMessageRequestSchema,
  type putLayoutRequestSchema,
  type recipientSchema,
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
export type Conversation = z.infer<typeof conversationResponseSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Decision = z.infer<typeof decisionResponseSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type RoomLayoutRecord = NonNullable<z.infer<typeof layoutResponseSchema>['layout']>;
export type Deliverable = z.infer<typeof listDeliverablesResponseSchema>['deliverables'][number];
export type Recipient = z.input<typeof recipientSchema>;
export type PostMessage = z.input<typeof postMessageRequestSchema>;
export type CreateConversation = z.input<typeof createConversationRequestSchema>;
export type CreateDecision = z.input<typeof createDecisionRequestSchema>;
export type CreateTask = z.input<typeof createTaskRequestSchema>;
export type PutLayout = z.input<typeof putLayoutRequestSchema>;
export type Answer = z.input<typeof answerRequestSchema>;
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
export const uploadFile = (id: string, file: Blob, name: string, mime: string, idempotencyKey?: Key, purpose: 'reference' | 'attachment' = 'reference') =>
  studio.upload(project(id, '/files'), fileResponseSchema, file, mime, { query: { name, purpose }, idempotencyKey });
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

// Room
export const getLayout = (id: string, signal?: Signal) => studio.get(project(id, '/layout'), layoutResponseSchema, { signal }).then((result) => result.layout);
export const putLayout = (id: string, body: PutLayout, idempotencyKey?: Key) => studio.put(project(id, '/layout'), layoutResponseSchema, { body, idempotencyKey }).then((result) => result.layout);
export const listConversations = (id: string, signal?: Signal) => studio.get(project(id, '/conversations'), listConversationsResponseSchema, { signal }).then((result) => result.conversations);
export const createConversation = (id: string, body: CreateConversation, idempotencyKey?: Key) => studio.post(project(id, '/conversations'), conversationResponseSchema, { body, idempotencyKey });
export const stopConversation = (conversationId: string, idempotencyKey?: Key) => studio.post(`/conversations/${segment(conversationId)}/stop`, conversationResponseSchema, { idempotencyKey });
export const listMessages = (conversationId: string, after: number, signal?: Signal) =>
  studio.get(`/conversations/${segment(conversationId)}/messages`, listMessagesResponseSchema, { query: { after, limit: 200 }, signal });
export const postMessage = (conversationId: string, body: PostMessage, idempotencyKey?: Key) =>
  studio.post(`/conversations/${segment(conversationId)}/messages`, postMessageResponseSchema, { body, idempotencyKey });
export const answerClarification = (messageId: string, body: Answer, idempotencyKey?: Key) => studio.post(`/messages/${segment(messageId)}/answer`, postMessageResponseSchema, { body, idempotencyKey });
export const requestFollowUp = (messageId: string, note: string, idempotencyKey?: Key) =>
  studio.post(`/messages/${segment(messageId)}/follow-up`, postMessageResponseSchema, { body: { body_md: note }, idempotencyKey });

// Decisions
export const listDecisions = (id: string, signal?: Signal) => studio.get(project(id, '/decisions'), listDecisionsResponseSchema, { signal }).then((result) => result.decisions);
export const createDecision = (id: string, body: CreateDecision, idempotencyKey?: Key) => studio.post(project(id, '/decisions'), decisionResponseSchema, { body, idempotencyKey });

// Tasks
export const listTasks = (id: string, query: { state?: 'active' | 'finished' | 'all'; conversation_id?: string }, signal?: Signal) =>
  studio.get(project(id, '/tasks'), listTasksResponseSchema, { query, signal }).then((result) => result.tasks);
export const createTask = (id: string, body: CreateTask, idempotencyKey?: Key) => studio.post(project(id, '/tasks'), taskResponseSchema, { body, idempotencyKey });
export type TaskControl = 'pause' | 'resume' | 'cancel';
export const controlTask = (taskId: string, control: TaskControl, idempotencyKey?: Key) => studio.post(`/tasks/${segment(taskId)}/${control}`, taskResponseSchema, { idempotencyKey });
/** Cancels the task if it is still active and creates the same work under the current team revision. */
export const reassignTask = (taskId: string, roleKey: string, idempotencyKey?: Key) =>
  studio.post(`/tasks/${segment(taskId)}/reassign`, taskResponseSchema, { body: { role_key: roleKey }, idempotencyKey });

// Deliverables
export const listDeliverables = (id: string, signal?: Signal) => studio.get(project(id, '/deliverables'), listDeliverablesResponseSchema, { signal });

// Agents
export const listAgents = (signal?: Signal) => studio.get('/agents', listAgentsResponseSchema, { signal });
