// Pure helpers for the projects pages: words for recorded events and team state, and the create
// form's draft. Nothing here invents data; every line reads a field the service returned.
import { DELIVERABLE_FORMATS, STAGES } from '@contracts/ardentstudio.generated';
import type { CreateProject, ProjectSummary, StudioFile } from '../api/endpoints';

const ACTIVITY: Record<string, string> = {
  'project.created': 'Project created',
  'project.updated': 'Project details changed',
  'project.archived': 'Project archived',
  'project.reopened': 'Project reopened',
  'file.created': 'Reference added',
  'file.updated': 'Reference indexing changed',
  'team.draft.updated': 'Team draft edited',
  'team.revision.published': 'Team revision published',
  'layout.updated': 'Room layout changed',
  'conversation.created': 'Conversation started',
  'conversation.updated': 'Conversation updated',
  'message.created': 'New message',
  'message.updated': 'Message updated',
  'presence.updated': 'Agent presence changed',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'decision.created': 'Decision recorded',
  'decision.updated': 'Decision updated',
  'deliverable.revision.created': 'Deliverable delivered',
  'review.comment.created': 'Review comment',
  'review.comment.updated': 'Review comment updated',
  'review.decision.created': 'Review decision',
  'export.created': 'Export created',
  'agent.operation.updated': 'Agent operation progressed',
};
/** The recorded event type in words; an unknown type is shown as recorded. */
export const activityLabel = (type: string): string => ACTIVITY[type] ?? type;

export function teamLine(team: ProjectSummary['team']): string {
  if (team.role_count === 0) return team.revision ? `r${team.revision} · no roles` : 'No team yet';
  const roles = `${team.bound_count} of ${team.role_count} ${team.role_count === 1 ? 'role' : 'roles'} bound`;
  return team.revision ? `r${team.revision} · ${roles}` : `Draft · ${roles}`;
}

export const KNOWLEDGE_LABEL: Record<StudioFile['knowledge']['state'], string> = {
  not_indexed: 'Stored',
  pending: 'Queued',
  indexing: 'Indexing',
  indexed: 'Indexed',
  failed: 'Failed',
  unsupported: 'Not indexable',
};
export const KNOWLEDGE_TONE: Record<StudioFile['knowledge']['state'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  not_indexed: 'neutral',
  pending: 'info',
  indexing: 'info',
  indexed: 'success',
  failed: 'danger',
  unsupported: 'warning',
};

// ── Create form ──
export type DeliverableFormat = (typeof DELIVERABLE_FORMATS)[number];
export type Stage = (typeof STAGES)[number];
export interface DeliverableDraft {
  name: string;
  kind: string;
  formats: DeliverableFormat[];
  stage: Stage | '';
}
export interface BriefDraft {
  name: string;
  brief: string;
  audience: string;
  constraints: string;
  tags: string;
  deliverables: DeliverableDraft[];
}
export const emptyBrief = (): BriefDraft => ({ name: '', brief: '', audience: '', constraints: '', tags: '', deliverables: [] });
/** The formats the brief offers first; the rest stay available. */
export const COMMON_FORMATS: readonly DeliverableFormat[] = ['md', 'docx', 'pdf', 'svg', 'png'];

const lines = (text: string, max: number) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, max);

/** Problems that stop the brief from being sent, by field. */
export function briefErrors(draft: BriefDraft): Partial<Record<'name' | 'deliverables', string>> {
  const errors: Partial<Record<'name' | 'deliverables', string>> = {};
  if (!draft.name.trim()) errors.name = 'Name the project.';
  else if (draft.name.trim().length > 200) errors.name = 'Keep the name under 200 characters.';
  const names = draft.deliverables.map((item) => item.name.trim().toLowerCase());
  if (draft.deliverables.some((item) => !item.name.trim() || !item.kind.trim())) errors.deliverables = 'Every deliverable needs a name and a kind.';
  else if (draft.deliverables.some((item) => item.formats.length === 0)) errors.deliverables = 'Choose at least one format for every deliverable.';
  else if (new Set(names).size !== names.length) errors.deliverables = 'Two deliverables share a name.';
  return errors;
}

export function briefRequest(draft: BriefDraft): CreateProject {
  return {
    name: draft.name.trim(),
    brief_md: draft.brief,
    audience: draft.audience.trim() || null,
    constraints: lines(draft.constraints, 50),
    tags: [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
    deliverables: draft.deliverables.map((item) => ({ name: item.name.trim(), kind: item.kind.trim(), formats: item.formats, stage: item.stage || null })),
  };
}

// ── References ──
const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};
export const REFERENCE_ACCEPT = Object.keys(MIME_BY_EXTENSION).map((extension) => '.' + extension).join(',');
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** The MIME type the service accepts for a picked file, from its extension (browsers often leave type empty for .md). */
export function uploadMime(file: { name: string; type: string }): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return (extension && MIME_BY_EXTENSION[extension]) ?? null;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
