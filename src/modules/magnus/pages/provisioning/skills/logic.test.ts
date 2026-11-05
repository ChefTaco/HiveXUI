import { describe, expect, it } from 'vitest';
import { initiallyExpanded, matchesSkill, normalizeScan } from './logic';
import { skillScanResponseSchema } from './schemas';

const scan = [
  { nodeId: 'a', nodeName: 'alpha', status: 'done', skills: [{ name: 'grounded', tags: ['research'], files: ['SKILL.md', { name: 'x.md', content: 'body' }] }] },
  { nodeId: 'b', nodeName: 'beta', status: 'done', skills: [] },
  { nodeId: 'c', nodeName: 'gamma', status: 'error', skills: [], error: 'timed out' },
];

describe('the scan', () => {
  it('fills in what an agent left out, and reads files given by name or by content', () => {
    const [alpha, , gamma] = normalizeScan(skillScanResponseSchema.parse({ success: true, data: scan }).data);
    expect(alpha!.skills[0]).toEqual({ name: 'grounded', version: '', description: '', author: '', entryPoint: '', dependencies: [], tags: ['research'], files: [{ name: 'SKILL.md', content: '' }, { name: 'x.md', content: 'body' }] });
    expect(gamma).toMatchObject({ status: 'error', error: 'timed out' });
  });
  it('expands nodes with skills, or every node when none has any', () => {
    const nodes = normalizeScan(scan);
    expect([...initiallyExpanded(nodes)]).toEqual(['a']);
    expect([...initiallyExpanded(nodes.slice(1))]).toEqual(['b', 'c']);
  });
  it('searches name, description and tags', () => {
    const skill = normalizeScan(scan)[0]!.skills[0]!;
    expect(matchesSkill(skill, '')).toBe(true);
    expect(matchesSkill(skill, 'GROUND')).toBe(true);
    expect(matchesSkill(skill, 'research')).toBe(true);
    expect(matchesSkill(skill, 'nope')).toBe(false);
  });
});
