import { describe, expect, it } from 'vitest';
import { draftFromRevision } from '../team/model';
import { templateDetail, teamBody } from '../test-fixtures';
import { applyChanges, templateDiff } from './diff';

const v1 = () => {
  const latest = templateDetail().latest;
  if (latest.kind !== 'team') throw new Error('team template expected');
  return latest.body;
};

describe('template updates', () => {
  it('lists added and removed roles, changed fields, relationships and stages', () => {
    const before = v1();
    const after = structuredClone(before);
    after.roles = after.roles.filter((role) => role.key !== 'editor');
    after.roles[1] = { ...after.roles[1]!, instructions_md: 'Cite every source.' };
    after.roles.push({ ...after.roles[0]!, key: 'layout', name: 'Layout Editor', coordinator: false });
    after.relationships = [...after.relationships.filter((edge) => edge.from !== 'editor' && edge.to !== 'editor'), { from: 'layout', to: 'lead', type: 'reports_to' }];
    after.stages = ['create', 'deliver'];
    const labels = templateDiff(before, after).map((change) => change.label);
    expect(labels).toEqual(expect.arrayContaining([
      'Role added: Layout Editor',
      'Worldbuilder: instructions',
      'Role removed: Continuity Editor',
      'Relationship added: Layout Editor reports to Story Lead',
      'Relationship removed: Continuity Editor reports to Story Lead',
      'Workflow stages',
    ]));
  });

  it('applies only the chosen changes, keeping the project’s bindings', () => {
    const before = v1();
    const after = structuredClone(before);
    after.roles[1] = { ...after.roles[1]!, instructions_md: 'Cite every source.' };
    after.roles[0] = { ...after.roles[0]!, name: 'Head Writer' };
    const changes = templateDiff(before, after);
    const draft = draftFromRevision(teamBody());
    const next = applyChanges(draft, changes, new Set(changes.filter((change) => change.label.includes('instructions')).map((change) => change.id)));
    expect(next.roles.find((role) => role.key === 'world')).toMatchObject({ instructions_md: 'Cite every source.', agent_ref: 'node-1~world' });
    expect(next.roles.find((role) => role.key === 'lead')!.name).toBe('Story Lead');
    expect(templateDiff(before, before)).toEqual([]);
  });
});
