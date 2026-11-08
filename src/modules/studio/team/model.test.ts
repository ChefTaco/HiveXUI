import { describe, expect, it } from 'vitest';
import { teamBody } from '../test-fixtures';
import { addRelationship, addRole, draftFromRevision, duplicateRole, emptyDraft, keyCommand, managerOf, neighbour, removeRole, roleKey, setCoordinator, setManager, treeOrder } from './model';

const team = () => draftFromRevision(teamBody());
const key = (name: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: name, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe('team edits', () => {
  it('makes the first role the coordinator and has later ones report to it', () => {
    const first = addRole(emptyDraft(), 'Lead');
    expect(first.draft.roles[0]).toMatchObject({ key: 'lead', coordinator: true });
    const second = addRole(first.draft, 'Lead');
    expect(second.key).toBe('lead_2');
    expect(second.draft.relationships).toEqual([{ from: 'lead_2', to: 'lead', type: 'reports_to' }]);
  });

  it('derives valid, unique role keys from any name', () => {
    expect(roleKey('Story Lead!', new Set())).toBe('story_lead');
    expect(roleKey('3D artist', new Set())).toBe('role_3d_artist');
    expect(roleKey('', new Set(['role']))).toBe('role_2');
    expect(roleKey('x'.repeat(80), new Set())).toMatch(/^[a-z][a-z0-9_-]{0,47}$/);
  });

  it('duplicates a role beside it, without its binding, under the same manager', () => {
    const { draft, key: copy } = duplicateRole(team(), 'world');
    const at = draft.roles.findIndex((role) => role.key === copy);
    expect(draft.roles[at - 1]!.key).toBe('world');
    expect(draft.roles[at]).toMatchObject({ name: 'Worldbuilder copy', coordinator: false, agent_ref: null, deliverables: ['Adventure book'] });
    expect(managerOf(draft, copy)).toBe('lead');
  });

  it('keeps one coordinator, at the root', () => {
    const draft = setCoordinator(team(), 'world');
    expect(draft.roles.filter((role) => role.coordinator).map((role) => role.key)).toEqual(['world']);
    expect(managerOf(draft, 'world')).toBeNull();
  });

  it('removes a role with every relationship that names it', () => {
    const draft = removeRole(team(), 'world');
    expect(draft.roles.map((role) => role.key)).toEqual(['lead', 'editor']);
    expect(draft.relationships).toEqual([{ from: 'editor', to: 'lead', type: 'reports_to' }]);
  });

  it('gives a role one manager: a new reporting line replaces the old one', () => {
    let draft = addRelationship(team(), { from: 'editor', to: 'world', type: 'reports_to' });
    expect(draft.relationships.filter((edge) => edge.type === 'reports_to' && edge.from === 'editor')).toEqual([{ from: 'editor', to: 'world', type: 'reports_to' }]);
    draft = addRelationship(draft, { from: 'editor', to: 'world', type: 'reports_to' });
    expect(draft.relationships.filter((edge) => edge.from === 'editor' && edge.type === 'reports_to')).toHaveLength(1);
    expect(addRelationship(draft, { from: 'lead', to: 'lead', type: 'reviews' })).toBe(draft);
    expect(managerOf(setManager(draft, 'editor', null), 'editor')).toBeNull();
  });
});

describe('the keyboard model', () => {
  // lead ← world ← carto; lead ← editor
  const tree = () => {
    const draft = addRole(team(), 'Cartographer').draft;
    return setManager(draft, 'cartographer', 'world');
  };

  it('orders roles depth first from the coordinator', () => {
    expect(treeOrder(tree())).toEqual(['lead', 'world', 'cartographer', 'editor']);
  });

  it('moves up to the manager, down to the first report, and across siblings', () => {
    const draft = tree();
    expect(neighbour(draft, 'world', 'up')).toBe('lead');
    expect(neighbour(draft, 'lead', 'down')).toBe('world');
    expect(neighbour(draft, 'world', 'right')).toBe('editor');
    expect(neighbour(draft, 'editor', 'left')).toBe('world');
    expect(neighbour(draft, 'editor', 'right')).toBeNull();
    expect(neighbour(draft, 'lead', 'up')).toBeNull();
  });

  it('maps keys to commands', () => {
    const draft = tree();
    expect(keyCommand(draft, 'world', key('ArrowDown'))).toEqual({ kind: 'focus', key: 'cartographer' });
    expect(keyCommand(draft, 'world', key('ArrowLeft', { shiftKey: true }))).toEqual({ kind: 'nudge', dx: -16, dy: 0 });
    expect(keyCommand(draft, 'world', key('Enter'))).toEqual({ kind: 'inspect' });
    expect(keyCommand(draft, 'world', key('Delete'))).toEqual({ kind: 'delete' });
    expect(keyCommand(draft, 'world', key('d', { ctrlKey: true }))).toEqual({ kind: 'duplicate' });
    expect(keyCommand(draft, 'world', key('d', { metaKey: true }))).toEqual({ kind: 'duplicate' });
    expect(keyCommand(draft, 'world', key('a'))).toEqual({ kind: 'layout' });
    expect(keyCommand(draft, 'world', key('a', { ctrlKey: true }))).toBeNull();
    expect(keyCommand(draft, 'lead', key('ArrowUp'))).toBeNull();
    expect(keyCommand(draft, 'world', key('Tab'))).toBeNull();
  });
});
