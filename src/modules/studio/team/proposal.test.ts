import { describe, expect, it } from 'vitest';
import { proposal, team, teamBody } from '../test-fixtures';
import { draftFromRevision, type TeamDraft } from './model';
import { basisWarning, composeAccepted, diffTeam, draftFromProposal, edgeKey, ghostView, proposalStatus } from './proposal';

const current = (): TeamDraft => draftFromRevision(teamBody());

/** The fixture team with the editor renamed and bound, a cartographer added, and the editor's review line dropped. */
function proposed(): TeamDraft {
  const draft = current();
  return {
    roles: [
      ...draft.roles.map((role) => (role.key === 'editor' ? { ...role, name: 'Continuity Lead', agent_ref: 'node-2~editor' } : role)),
      { ...draft.roles[1]!, key: 'carto', name: 'Cartographer', coordinator: false, agent_ref: null, deliverables: ['Regional map'], stage: 'create', knowledge: [] },
    ],
    relationships: [
      ...draft.relationships.filter((edge) => edge.type !== 'reviews'),
      { from: 'carto', to: 'lead', type: 'reports_to' },
      { from: 'world', to: 'carto', type: 'hands_off_to' },
    ],
    stages: [...draft.stages, 'revise'],
  };
}
const keys = (draft: TeamDraft) => draft.roles.map((role) => role.key).sort();
const edges = (draft: TeamDraft) => draft.relationships.map(edgeKey).sort();

describe('the difference a proposal makes', () => {
  it('names added, changed, removed and unchanged roles, with the fields that change', () => {
    const diff = diffTeam(current(), proposed(), (ref) => (ref === 'node-2~editor' ? 'Editor' : ref));
    const byKey = new Map(diff.roles.map((item) => [item.key, item]));
    expect(byKey.get('carto')!.change).toBe('added');
    expect(byKey.get('lead')!.change).toBe('same');
    const editor = byKey.get('editor')!;
    expect(editor.change).toBe('changed');
    expect(editor.fields.map((field) => [field.label, field.before, field.after])).toEqual([
      ['Name', 'Continuity Editor', 'Continuity Lead'],
      ['Agent', '—', 'Editor'],
    ]);
    // The dropped review line belongs to the role that reviews; the new hand-off to the new role.
    expect(editor.edges.map((item) => [item.change, item.edge.type])).toEqual([['removed', 'reviews']]);
    expect(byKey.get('carto')!.edges.map((item) => [item.change, item.edge.from, item.edge.to])).toEqual([
      ['added', 'carto', 'lead'],
      ['added', 'world', 'carto'],
    ]);
    expect(diff.changed).toBe(2);
    expect(diff.stages).toEqual({ before: ['create', 'research', 'review', 'deliver'], after: ['create', 'research', 'review', 'revise', 'deliver'] });
  });

  it('marks a role the proposal leaves out as removed, with its lines', () => {
    const without = proposed();
    without.roles = without.roles.filter((role) => role.key !== 'world');
    without.relationships = without.relationships.filter((edge) => edge.from !== 'world' && edge.to !== 'world');
    const diff = diffTeam(current(), without);
    const world = diff.roles.find((item) => item.key === 'world')!;
    expect(world.change).toBe('removed');
    expect(world.edges.every((item) => item.change === 'removed')).toBe(true);
  });

  it('accepting every role gives the proposed team', () => {
    const diff = diffTeam(current(), proposed());
    const all = composeAccepted(current(), proposed(), diff, new Set(diff.roles.map((item) => item.key)));
    expect(keys(all)).toEqual(keys(proposed()));
    expect(edges(all)).toEqual(edges(proposed()));
    expect(all.roles.find((role) => role.key === 'editor')!.name).toBe('Continuity Lead');
  });

  it('accepts one role at a time, leaving the others as they are', () => {
    const diff = diffTeam(current(), proposed());
    const carto = composeAccepted(current(), proposed(), diff, new Set(['carto']));
    expect(keys(carto)).toEqual(['carto', 'editor', 'lead', 'world']);
    expect(carto.roles.find((role) => role.key === 'editor')!.name).toBe('Continuity Editor');
    // The editor's review line stays: only accepting the editor removes it.
    expect(carto.relationships.some((edge) => edge.type === 'reviews')).toBe(true);
    expect(carto.relationships).toContainEqual({ from: 'world', to: 'carto', type: 'hands_off_to' });
    // Stages the accepted role uses join; the rest stay as they were.
    expect(carto.stages).toEqual(['create', 'research', 'review', 'deliver']);

    const editor = composeAccepted(current(), proposed(), diff, new Set(['editor']));
    expect(keys(editor)).toEqual(['editor', 'lead', 'world']);
    expect(editor.roles.find((role) => role.key === 'editor')).toMatchObject({ name: 'Continuity Lead', agent_ref: 'node-2~editor' });
    expect(editor.relationships.some((edge) => edge.type === 'reviews')).toBe(false);
    // A line to a role that was not accepted is left out.
    expect(editor.relationships.some((edge) => edge.to === 'carto' || edge.from === 'carto')).toBe(false);
  });

  it('moves the coordinator only with the role that becomes it', () => {
    const next = proposed();
    next.roles = next.roles.map((role) => ({ ...role, coordinator: role.key === 'world' }));
    next.relationships = [...next.relationships.filter((edge) => !(edge.type === 'reports_to' && edge.from === 'world')), { from: 'lead', to: 'world', type: 'reports_to' }];
    const diff = diffTeam(current(), next);
    const crowned = composeAccepted(current(), next, diff, new Set(['world']));
    expect(crowned.roles.filter((role) => role.coordinator).map((role) => role.key)).toEqual(['world']);
    expect(crowned.relationships.some((edge) => edge.type === 'reports_to' && edge.from === 'world')).toBe(false);
    const untouched = composeAccepted(current(), next, diff, new Set(['carto']));
    expect(untouched.roles.filter((role) => role.coordinator).map((role) => role.key)).toEqual(['lead']);
  });

  it('draws removed roles and lines beside the added ones for the ghost view', () => {
    const without = proposed();
    without.roles = without.roles.filter((role) => role.key !== 'world');
    without.relationships = without.relationships.filter((edge) => edge.from !== 'world' && edge.to !== 'world');
    const diff = diffTeam(current(), without);
    const ghost = ghostView(current(), without, diff);
    expect(keys(ghost.draft)).toEqual(['carto', 'editor', 'lead', 'world']);
    expect(ghost.roles.get('world')).toBe('removed');
    expect(ghost.roles.get('carto')).toBe('added');
    expect(ghost.draft.relationships).toHaveLength(ghost.edges.length);
    expect(ghost.edges.filter((change) => change === 'removed').length).toBeGreaterThan(0);
    expect(ghost.draft.roles.find((role) => role.key === 'editor')!.name).toBe('Continuity Lead');
  });

  it('reads a proposal draft body as a draft', () => {
    const body = { roles: proposed().roles, relationships: proposed().relationships, stages: proposed().stages };
    expect(draftFromProposal(body)).toEqual(proposed());
  });
});

describe('a proposal against a team that moved', () => {
  const record = proposal({ basis: { current_revision: 1, draft_revision: null, source_template: null }, created_at: '2026-11-08T10:00:00.000Z' });

  it('says nothing when the team is as it was', () => {
    expect(basisWarning(record, team(), false)).toBeNull();
  });
  it('warns after a publish, a new draft, a later edit or unsaved edits', () => {
    expect(basisWarning(record, team({ current: { ...team().current!, revision: 2 } }), false)).toContain('published as r2');
    const draft = { ...team().current!, revision: 2, status: 'draft' as const, updated_at: '2026-11-08T09:00:00.000Z' };
    expect(basisWarning(record, team({ draft }), false)).toContain('new team draft');
    const edited = proposal({ ...record, basis: { current_revision: 1, draft_revision: 2, source_template: null } });
    expect(basisWarning(edited, team({ draft }), false)).toBeNull();
    expect(basisWarning(edited, team({ draft: { ...draft, updated_at: '2026-11-08T11:00:00.000Z' } }), false)).toContain('edited after');
    expect(basisWarning(record, team(), true)).toContain('not saved');
  });
});

describe('proposal progress in words', () => {
  it('shows queued, working and the retry with the first reply’s validation error', () => {
    expect(proposalStatus(proposal())).toMatchObject({ title: 'Queued', detail: 'Waiting for node-1~lead', open: true });
    expect(proposalStatus(proposal({ state: 'running', progress: 'Reading the brief' }))).toMatchObject({ title: 'Working', detail: 'Reading the brief' });
    const retry = proposal({
      state: 'running',
      attempts: [
        { attempt: 1, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W009', outcome: 'invalid', error: 'roles: Exactly one role must be the coordinator (found 0)' },
        { attempt: 2, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W010', outcome: 'pending', error: null },
      ],
    });
    expect(proposalStatus(retry)).toEqual({ title: 'Attempt 2 of 2: retrying', detail: 'The first reply did not validate: roles: Exactly one role must be the coordinator (found 0)', tone: 'warning', open: true });
  });
  it('fails visibly with the validation error, and is final once ready, failed or cancelled', () => {
    const failed = proposalStatus(
      proposal({ state: 'failed', error: 'The agent did not return a valid team proposal.', attempts: [{ attempt: 2, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W010', outcome: 'invalid', error: 'relationships[0].to: Unknown role "x"' }] }),
    );
    expect(failed).toMatchObject({ title: 'Failed', tone: 'danger', open: false });
    expect(failed.detail).toContain('Unknown role "x"');
    expect(proposalStatus(proposal({ state: 'ready' })).open).toBe(false);
    expect(proposalStatus(proposal({ state: 'cancelled' })).title).toBe('Cancelled');
  });
});
