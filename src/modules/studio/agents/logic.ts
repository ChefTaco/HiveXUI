// Pure helpers for Agent Studio: tabs, the runtime line, portraits, drafts, Apply results and the
// development timeline filters. No React, so tests read them directly.
import type { Tone } from '@ui';
import type { Agent, Snapshot } from '../api/endpoints';
import { PORTRAIT_ACCENTS, PORTRAIT_EMBLEMS, PORTRAIT_PRESETS, type Portrait } from '../room/scene/model';
import type { AgentDraft, ApplyPart, ApplyResult, DevelopmentRecord, DraftBody } from './api';

export const AGENT_TABS = ['identity', 'capabilities', 'knowledge', 'preview', 'development', 'review'] as const;
export type AgentTab = (typeof AGENT_TABS)[number];
export const TAB_LABEL: Record<AgentTab, string> = {
  identity: 'Identity',
  capabilities: 'Capabilities',
  knowledge: 'Knowledge',
  preview: 'Preview',
  development: 'Development',
  review: 'Review',
};
export const agentTab = (value: string | null): AgentTab => (AGENT_TABS as readonly string[]).includes(value ?? '') ? (value as AgentTab) : 'identity';

/** What the header says about the runtime, from Magnus's own report through Studio. */
export function runtimeStatus(agent: Pick<Agent, 'reachable' | 'running' | 'available' | 'error'> | undefined): { label: string; tone: Tone; status: string } {
  if (!agent) return { label: 'Not reported', tone: 'neutral', status: 'UNKNOWN' };
  if (!agent.reachable) return { label: 'Node unreachable', tone: 'danger', status: 'OFFLINE' };
  if (!agent.running) return { label: 'Stopped', tone: 'warning', status: 'STOPPED' };
  if (!agent.available) return { label: agent.error ? 'Running with an error' : 'Running, unavailable', tone: 'warning', status: 'DEGRADED' };
  return { label: 'Running', tone: 'success', status: 'RUNNING' };
}

const pick = <T extends string>(list: readonly T[], value: string | undefined, seed: number): T => (value && (list as readonly string[]).includes(value) ? (value as T) : list[seed % list.length]!);
const hash = (text: string): number => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/** A drawable portrait: the saved preset, else one derived from the agent reference so it stays the same. */
export function portraitFor(saved: { preset: string; accent: string; emblem: string } | null | undefined, agentRef: string): Portrait {
  const seed = hash(agentRef);
  return {
    preset: pick(PORTRAIT_PRESETS, saved?.preset, seed),
    accent: pick(PORTRAIT_ACCENTS, saved?.accent, seed >>> 3),
    emblem: pick(PORTRAIT_EMBLEMS, saved?.emblem, seed >>> 6),
  };
}

/** The roles this agent holds in a project's team: the published revision, else the draft. */
export function projectRoles(snapshot: Snapshot, agentRef: string) {
  const team = snapshot.team.current ?? snapshot.team.draft;
  return (team?.body.roles ?? []).filter((role) => role.agent_ref === agentRef);
}

const ACTIVE_TASK = new Set(['queued', 'running', 'input_required', 'pausing', 'paused']);
/** The project's Studio tasks still open for this agent, by its Ardent reference or its role bindings. */
export function projectTasks(snapshot: Snapshot, agentRef: string) {
  const bindings = new Set(projectRoles(snapshot, agentRef).map((role) => role.binding_id).filter(Boolean));
  return snapshot.tasks.filter((task) => ACTIVE_TASK.has(task.state) && (task.ardent.agent_ref === agentRef || (task.binding_id !== null && bindings.has(task.binding_id))));
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item) => b.includes(item));

/** A saved draft holds only what differs; an empty one is no draft. */
export const draftIsEmpty = (draft: DraftBody): boolean => Object.values(draft).every((value) => value === undefined);

export const PART_LABEL: Record<ApplyPart, string> = { soul: 'SOUL.md', identity: 'IDENTITY.md', skills: 'Skills', model: 'Model' };
export const RESULT_TEXT: Record<ApplyResult['status'], { label: string; tone: Tone }> = {
  applied: { label: 'Applied', tone: 'success' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  unsupported: { label: 'Not applied here', tone: 'warning' },
};

/** One line for the whole Apply: honest when nothing, or only some, went through. */
export function applySummary(results: readonly ApplyResult[]): { text: string; tone: Tone } {
  const applied = results.filter((result) => result.status === 'applied').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  if (failed && !applied) return { text: failed === results.length ? 'Nothing was applied.' : 'Nothing was applied; see each part below.', tone: 'danger' };
  if (failed) return { text: `${applied} of ${results.length} parts applied; ${failed} failed.`, tone: 'warning' };
  if (!applied) return { text: 'Nothing needed applying.', tone: 'neutral' };
  return { text: applied === 1 ? 'Applied. Identity history keeps the previous version.' : `${applied} parts applied. Identity history keeps the previous versions.`, tone: 'success' };
}

/** Magnus's refusals for a part, in plain words. Anything else shows the service's own message. */
export const APPLY_CODE_TEXT: Record<string, string> = {
  ACTING_ADMIN_REQUIRED: 'Only a Magnus administrator can change an agent. Ask an administrator to apply this draft.',
  ACTING_SUBJECT_UNLINKED: 'Your sign-in is not linked to a Magnus account, so Magnus cannot check who is applying. Link it in Magnus, then apply again.',
  CONFIG_PATH_FORBIDDEN: 'Magnus does not let Studio change this setting in the agent’s configuration.',
  CONFLICT: 'The agent changed since this draft was made. Reload the agent as the draft’s base, check the draft, then apply again.',
  MAGNUS_CONFLICT: 'The agent changed since this draft was made. Reload the agent as the draft’s base, check the draft, then apply again.',
  INVALID_INPUT: 'The agent rejected this value. Check the draft and apply again.',
  CONFIG_REVISION_REQUIRED: 'The draft does not record the agent’s configuration revision. Save the draft again, then apply.',
  BASE_REVISION_MISSING: 'The draft does not record which version of the file it changes. Reload the agent as the draft’s base, then apply again.',
};
/** A failed part that a fresh base would let through. */
export const needsRebase = (results: readonly ApplyResult[]): boolean => results.some((result) => result.status === 'failed' && ['CONFLICT', 'MAGNUS_CONFLICT', 'BASE_REVISION_MISSING', 'CONFIG_REVISION_REQUIRED'].includes(result.code ?? ''));

/** The notice for an agent with work in flight: changes start with its next turn. */
export const busyNotice = (running: number): string =>
  `Applies from the agent's next turn; ${running} running ${running === 1 ? 'task keeps' : 'tasks keep'} current instructions.`;

export const DEVELOPMENT_KINDS: Record<string, string> = {
  observation: 'Observation',
  reflection: 'Reflection',
  method_reflection: 'Method reflection',
  open_question: 'Open question',
  communication_change: 'Communication change',
  self_understanding: 'Self-understanding',
  identity_revision: 'Identity revision',
  instruction_revision: 'Instruction revision',
  skill_change: 'Skill change',
  operator_note: 'Operator note',
};
export const kindLabel = (kind: string): string => DEVELOPMENT_KINDS[kind] ?? kind.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());

export type DevelopmentWindow = 'all' | '7d' | '30d';
const WINDOW_MS: Record<Exclude<DevelopmentWindow, 'all'>, number> = { '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/**
 * Client-side filters over the loaded records. Ardent links a record to its work by task, so a
 * project's records are the ones whose task sources are that project's Ardent tasks.
 */
export function filterRecords(records: readonly DevelopmentRecord[], filter: { taskIds?: ReadonlySet<string> | undefined; window: DevelopmentWindow }, now = Date.now()): DevelopmentRecord[] {
  return records.filter((record) => {
    if (filter.taskIds && !record.sources.some((source) => source.kind === 'task' && filter.taskIds!.has(source.ref))) return false;
    if (filter.window === 'all') return true;
    const at = Date.parse(record.created_at);
    return Number.isFinite(at) && now - at <= WINDOW_MS[filter.window];
  });
}

export const shortSha = (value: string | null | undefined): string => (value ? value.slice(0, 8) : '—');

/** The editor's fields: SOUL and IDENTITY text, the enabled skills, and the preview model. */
export interface DraftFields {
  soul: string;
  identity: string;
  skills: readonly string[];
  model: string;
}
export interface AgentNow {
  soul: { text: string; revision: string };
  identity: { text: string; revision: string };
  skills: ReadonlyArray<{ name: string; enabled: boolean }>;
  configRevision: string;
}
export const enabledSkills = (now: AgentNow): string[] => now.skills.filter((skill) => skill.enabled).map((skill) => skill.name);

/** The editor opens on the saved draft where it has a part, else on the agent as it is. */
export function fieldsFrom(draft: DraftBody | null | undefined, now: AgentNow): DraftFields {
  return {
    soul: draft?.soul ?? now.soul.text,
    identity: draft?.identity ?? now.identity.text,
    skills: draft?.skills_enabled ?? enabledSkills(now),
    model: draft?.model ?? '',
  };
}

/** What the draft holds: only the parts that differ from the agent now. */
export function bodyFrom(fields: DraftFields, now: AgentNow): DraftBody {
  const body: DraftBody = {};
  if (fields.soul !== now.soul.text && fields.soul.trim()) body.soul = fields.soul;
  if (fields.identity !== now.identity.text && fields.identity.trim()) body.identity = fields.identity;
  if (!sameSet(fields.skills, enabledSkills(now))) body.skills_enabled = [...fields.skills].sort();
  if (fields.model.trim()) body.model = fields.model.trim();
  return body;
}

export function sameBody(a: DraftBody, b: DraftBody): boolean {
  return a.soul === b.soul && a.identity === b.identity && a.model === b.model && (a.skills_enabled === undefined ? b.skills_enabled === undefined : b.skills_enabled !== undefined && sameSet(a.skills_enabled, b.skills_enabled));
}

/**
 * The revisions a draft builds on: kept from the saved draft, else the agent's now, for each part it
 * holds. Skills and the model both change the configuration, so either records its revision.
 */
export function baseFor(body: DraftBody, now: AgentNow, saved: AgentDraft | null | undefined) {
  return {
    ...(body.soul !== undefined ? { soul_revision: saved?.base.soul_revision ?? now.soul.revision } : {}),
    ...(body.identity !== undefined ? { identity_revision: saved?.base.identity_revision ?? now.identity.revision } : {}),
    ...(body.skills_enabled !== undefined || body.model !== undefined ? { config_revision: saved?.base.config_revision ?? now.configRevision } : {}),
  };
}

/** The Apply parts a saved draft holds. */
export function draftParts(body: DraftBody): ApplyPart[] {
  const parts: ApplyPart[] = [];
  if (body.soul !== undefined) parts.push('soul');
  if (body.identity !== undefined) parts.push('identity');
  if (body.skills_enabled !== undefined) parts.push('skills');
  if (body.model !== undefined) parts.push('model');
  return parts;
}
