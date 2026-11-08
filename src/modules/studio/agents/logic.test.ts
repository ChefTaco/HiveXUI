import { describe, expect, it } from 'vitest';
import { snapshot, team, teamBody } from '../test-fixtures';
import type { AgentDraft, DevelopmentRecord } from './api';
import { agentTab, applySummary, baseFor, bodyFrom, busyNotice, draftParts, fieldsFrom, filterRecords, portraitFor, projectRoles, projectTasks, runtimeStatus, sameBody, type AgentNow } from './logic';

const SHA = (char: string) => char.repeat(64);
const now: AgentNow = {
  soul: { text: 'Calm and exact.', revision: SHA('a') },
  identity: { text: 'Story lead.', revision: SHA('b') },
  skills: [
    { name: 'outline', enabled: true },
    { name: 'research', enabled: false },
  ],
  configRevision: SHA('c'),
};
const saved = (draft: AgentDraft['draft'], base: AgentDraft['base'] = {}): AgentDraft => ({ agent_ref: 'node-1~lead', user_id: 'operator', base, draft, created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z' });

describe('drafts', () => {
  it('opens on the saved draft where it has a part, else on the agent', () => {
    expect(fieldsFrom({ soul: 'Warmer.' }, now)).toEqual({ soul: 'Warmer.', identity: 'Story lead.', skills: ['outline'], model: '' });
    expect(fieldsFrom(null, now).soul).toBe('Calm and exact.');
  });

  it('holds only the parts that differ from the agent', () => {
    expect(bodyFrom(fieldsFrom(null, now), now)).toEqual({});
    expect(bodyFrom({ soul: 'Warmer.', identity: 'Story lead.', skills: ['research', 'outline'], model: ' general ' }, now)).toEqual({ soul: 'Warmer.', skills_enabled: ['outline', 'research'], model: 'general' });
    // Clearing a file is not a change Apply could make.
    expect(bodyFrom({ ...fieldsFrom(null, now), identity: '  ' }, now)).toEqual({});
  });

  it('compares skills as a set', () => {
    expect(sameBody({ skills_enabled: ['a', 'b'] }, { skills_enabled: ['b', 'a'] })).toBe(true);
    expect(sameBody({ skills_enabled: ['a'] }, {})).toBe(false);
    expect(sameBody({ soul: 'x' }, { soul: 'x' })).toBe(true);
  });

  it('keeps the revisions a saved draft was based on, so Apply never overwrites newer work', () => {
    expect(baseFor({ soul: 'x', skills_enabled: [] }, now, null)).toEqual({ soul_revision: SHA('a'), config_revision: SHA('c') });
    // The model lives in the configuration too.
    expect(baseFor({ model: 'general' }, now, null)).toEqual({ config_revision: SHA('c') });
    expect(baseFor({ soul: 'x', identity: 'y' }, now, saved({ soul: 'old' }, { soul_revision: SHA('d') }))).toEqual({ soul_revision: SHA('d'), identity_revision: SHA('b') });
  });

  it('applies exactly the parts the draft holds', () => {
    expect(draftParts({ identity: 'y', skills_enabled: ['a'], model: 'general' })).toEqual(['identity', 'skills', 'model']);
    expect(draftParts({})).toEqual([]);
  });
});

describe('apply results', () => {
  const result = (part: 'soul' | 'identity' | 'skills' | 'model', status: 'applied' | 'unchanged' | 'failed' | 'unsupported') => ({ part, status, error: null, code: null, revision: null, activation_required: false });

  it('never claims success when Magnus refused every part', () => {
    expect(applySummary([result('soul', 'failed'), result('identity', 'failed')])).toEqual({ text: 'Nothing was applied.', tone: 'danger' });
    expect(applySummary([result('soul', 'failed'), result('model', 'unsupported')])).toMatchObject({ text: 'Nothing was applied; see each part below.', tone: 'danger' });
  });

  it('counts a partial apply', () => {
    expect(applySummary([result('soul', 'applied'), result('skills', 'failed')])).toEqual({ text: '1 of 2 parts applied; 1 failed.', tone: 'warning' });
    expect(applySummary([result('soul', 'applied')]).tone).toBe('success');
    expect(applySummary([result('soul', 'unchanged')]).text).toBe('Nothing needed applying.');
  });

  it('words the busy notice for one or many running tasks', () => {
    expect(busyNotice(1)).toBe("Applies from the agent's next turn; 1 running task keeps current instructions.");
    expect(busyNotice(3)).toBe("Applies from the agent's next turn; 3 running tasks keep current instructions.");
  });
});

describe('the header and tabs', () => {
  it('reads an unknown tab as Identity', () => {
    expect(agentTab('preview')).toBe('preview');
    expect(agentTab('review')).toBe('review');
    expect(agentTab('settings')).toBe('identity');
    expect(agentTab(null)).toBe('identity');
  });

  it('says what the runtime is doing from what Magnus reports', () => {
    const base = { reachable: true, running: true, available: true, error: null };
    expect(runtimeStatus(base).label).toBe('Running');
    expect(runtimeStatus({ ...base, reachable: false }).label).toBe('Node unreachable');
    expect(runtimeStatus({ ...base, running: false }).label).toBe('Stopped');
    expect(runtimeStatus({ ...base, available: false, error: 'Model offline' }).label).toBe('Running with an error');
    expect(runtimeStatus(undefined).label).toBe('Not reported');
  });

  it('draws a saved portrait, and a stable one when there is none', () => {
    expect(portraitFor({ preset: 'visor', accent: 'persona-3', emblem: 'book' }, 'node-1~lead')).toEqual({ preset: 'visor', accent: 'persona-3', emblem: 'book' });
    expect(portraitFor(null, 'node-1~lead')).toEqual(portraitFor(null, 'node-1~lead'));
    expect(portraitFor({ preset: 'unknown', accent: 'persona-1', emblem: 'star' }, 'x~y').preset).not.toBe('unknown');
  });
});

describe('project facts', () => {
  it("finds the agent's roles and open tasks in the project", () => {
    const task = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ id, project_id: 'p', title: id, mode: 'turn', role_key: null, binding_id: null, assignment_revision: null, conversation_id: null, trigger_message_id: null, instructions_md: '', source: {}, state, dispatch: null, ardent: { agent_ref: null, task_id: null, session_id: null }, outcome: null, reassigned_from: null, group_id: null, group_position: 0, created_by: 'operator', created_at: '', updated_at: '', finished_at: null, ...extra });
    const lead = teamBody().roles[0]!;
    const state = snapshot({
      team: team(),
      tasks: [task('mine', 'running', { binding_id: lead.binding_id }), task('ardent', 'queued', { ardent: { agent_ref: 'node-1~lead', task_id: 'a', session_id: null } }), task('done', 'completed', { binding_id: lead.binding_id }), task('other', 'running', { binding_id: 'bnd_other' })] as never,
    });
    expect(projectRoles(state, 'node-1~lead').map((role) => role.key)).toEqual(['lead']);
    expect(projectTasks(state, 'node-1~lead').map((item) => item.id)).toEqual(['mine', 'ardent']);
  });
});

describe('development filters', () => {
  const record = (id: string, created_at: string, sources: DevelopmentRecord['sources'] = []): DevelopmentRecord => ({ id, agent_ref: 'node-1~lead', kind: 'reflection', title: id, body: '', author: 'agent', epistemic: 'agent_reported', before_sha256: null, after_sha256: null, sources, created_at, comments: [] });
  const at = Date.parse('2026-11-08T12:00:00.000Z');

  it('narrows to a project through its tasks, and to a time window', () => {
    const records = [record('recent', '2026-11-07T12:00:00.000Z', [{ kind: 'task', ref: 'ardent-task-1' }]), record('old', '2026-09-01T12:00:00.000Z', [{ kind: 'task', ref: 'ardent-task-2' }]), record('unlinked', '2026-11-08T11:00:00.000Z')];
    expect(filterRecords(records, { window: 'all' }, at).map((item) => item.id)).toEqual(['recent', 'old', 'unlinked']);
    expect(filterRecords(records, { window: '7d' }, at).map((item) => item.id)).toEqual(['recent', 'unlinked']);
    expect(filterRecords(records, { window: 'all', taskIds: new Set(['ardent-task-2']) }, at).map((item) => item.id)).toEqual(['old']);
  });
});
