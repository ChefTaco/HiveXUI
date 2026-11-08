import { describe, expect, it } from 'vitest';
import { teamBody } from '../test-fixtures';
import { addRelationship, draftFromRevision, setCoordinator, updateRole, type TeamDraft } from './model';
import { issuesByRole, validateDraft, validateTeam } from './validation';

const team = () => draftFromRevision(teamBody());
const codes = (draft: TeamDraft, deliverables: Array<{ name: string; producer_role_key: string | null }> = [{ name: 'Adventure book', producer_role_key: null }], available = new Map([['node-1~lead', true], ['node-1~world', true]])) =>
  validateDraft(draft, deliverables, available).issues.map((issue) => `${issue.severity}:${issue.code}${issue.role_key ? `:${issue.role_key}` : ''}`);

describe('the mirrored team validation', () => {
  it('passes the fixture team with only the unbound role warned', () => {
    const result = validateDraft(team(), [{ name: 'Adventure book', producer_role_key: null }], new Map([['node-1~lead', true], ['node-1~world', true]]));
    expect(result).toMatchObject({ can_publish: true, can_start_room: true, agent_facts: 'partial' });
    expect(codes(team())).toEqual(['warning:unbound_role:editor']);
  });

  it('requires exactly one coordinator', () => {
    const none = { ...team(), roles: team().roles.map((role) => ({ ...role, coordinator: false })) };
    expect(codes(none)).toContain('error:coordinator_count');
    const two = { ...team(), roles: team().roles.map((role) => ({ ...role, coordinator: role.key !== 'editor' })) };
    expect(validateDraft(two, [], new Map()).can_publish).toBe(false);
  });

  it('finds a reporting cycle', () => {
    const draft = addRelationship(addRelationship(setCoordinator(team(), 'editor'), { from: 'lead', to: 'world', type: 'reports_to' }), { from: 'world', to: 'lead', type: 'reports_to' });
    expect(codes(draft)).toContain('error:reporting_cycle:lead');
  });

  it('allows a hand-off cycle only when it is the revise loop', () => {
    const loop = addRelationship(team(), { from: 'editor', to: 'world', type: 'hands_off_to' });
    expect(codes(loop)).toContain('error:workflow_cycle:world');
    const revise = addRelationship(team(), { from: 'editor', to: 'world', type: 'hands_off_to', stage: 'revise' });
    expect(codes(revise).some((code) => code.includes('workflow_cycle'))).toBe(false);
  });

  it('needs a producer for every requested deliverable', () => {
    const draft = updateRole(team(), 'world', { deliverables: [] });
    expect(codes(draft)).toContain('error:deliverable_without_producer');
    expect(codes(draft, [{ name: 'Adventure book', producer_role_key: 'editor' }])).not.toContain('error:deliverable_without_producer');
  });

  it('warns when the only producer’s agent also reviews it, and when an agent is unavailable', () => {
    const same = updateRole(team(), 'editor', { agent_ref: 'node-1~world' });
    expect(codes(same)).toContain('warning:reviewer_is_only_producer:editor');
    expect(codes(team(), undefined, new Map([['node-1~lead', false], ['node-1~world', true]]))).toContain('warning:agent_unavailable:lead');
    expect(validateDraft(team(), [], new Map([['node-1~lead', false]])).can_start_room).toBe(false);
  });

  it('leaves agent fact coverage to the service, which reports it', () => {
    expect(codes(team())).not.toContain('warning:agent_facts_unavailable');
    const server = validateTeam({ mode: 'assignment', roles: team().roles, relationships: team().relationships, agentFacts: new Map() });
    expect(server.issues.map((issue) => issue.code)).toContain('agent_facts_unavailable');
  });

  it('groups issues by role for markers', () => {
    const map = issuesByRole(validateDraft(updateRole(team(), 'world', { agent_ref: null }), [], new Map()).issues);
    expect([...map.keys()].sort()).toEqual(['editor', 'world']);
  });
});
