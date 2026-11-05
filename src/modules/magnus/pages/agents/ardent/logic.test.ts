import { describe, expect, it } from 'vitest';
import { channelSummary, parseIdList, parseProfileRef, profileHref, summarize, taskArtifacts, taskIsFinal } from './logic';
import type { ArdentInstallation } from './schemas';

const profile = (id: string, running: boolean, error: string | null = null) => ({ id, name: id, backend: 'llamacpp', apiPort: 9910, running, a2aEnabled: false, channels: {}, error });
const node = (nodeId: string, extra: Partial<ArdentInstallation>): ArdentInstallation => ({ nodeId, nodeName: nodeId, hostname: `${nodeId}.invalid`, reachable: true, error: null, installed: true, version: '1.0.0', owner: 'ardent', profiles: [], checkedAt: '2026-01-01T00:00:00.000Z', ...extra });

describe('Ardent profile links', () => {
  it('round-trips a node and a profile', () => {
    expect(profileHref('node-1', 'default')).toBe('/ardent/profiles/node-1~default');
    expect(parseProfileRef('node-1~default')).toEqual({ nodeId: 'node-1', profileId: 'default' });
  });
  it('refuses a link that no profile could have, so it never reaches a request path', () => {
    for (const value of [undefined, '', 'nomarker', '~profile', 'node~', 'no/de~x', 'node~../../etc', 'node~a b']) expect(parseProfileRef(value)).toBeNull();
  });
});

describe('summarize', () => {
  it('counts installed nodes, running profiles, and what needs attention', () => {
    const result = summarize([
      node('a', { profiles: [profile('one', true), profile('two', false), profile('three', true, 'bad token')] }),
      node('b', { reachable: false, installed: false, error: 'timeout' }),
      node('c', { installed: false }),
    ]);
    expect(result.detected.map((item) => item.nodeId)).toEqual(['a']);
    expect(result.running).toBe(2);
    // The stopped profile, the failing profile, and the unreachable node.
    expect(result.needsAttention).toBe(3);
  });
  it('holds nothing for an empty fleet', () => {
    expect(summarize([])).toMatchObject({ running: 0, needsAttention: 0, detected: [], profiles: [] });
  });
});

describe('channelSummary', () => {
  it('names enabled channels only', () => {
    expect(channelSummary({ telegram: true, slack: false })).toBe('telegram');
    expect(channelSummary({ slack: false })).toBe('None');
  });
});

describe('taskArtifacts', () => {
  const good = { id: 'a'.repeat(64), name: 'brief.md', bytes: 12, media_type: 'text/markdown' };
  it('reads artifacts from the research journal', () => {
    expect(taskArtifacts([{ sequence: 1, kind: 'research_artifacts', detail: { markdown: good }, created_ms: 1 }])).toEqual([good]);
  });
  it('ignores other events and any id that could not be a digest', () => {
    expect(taskArtifacts([
      { sequence: 1, kind: 'model_turn', detail: { markdown: good }, created_ms: 1 },
      { sequence: 2, kind: 'research_artifacts', detail: { evil: { ...good, id: '../../secrets' }, none: null }, created_ms: 2 },
      { sequence: 3, kind: 'research_artifacts', detail: 'not an object', created_ms: 3 },
    ])).toEqual([]);
  });
});

describe('taskIsFinal', () => {
  it('offers cancel only for a task still in progress', () => {
    expect(taskIsFinal('completed')).toBe(true);
    expect(taskIsFinal('cancelled')).toBe(true);
    expect(taskIsFinal('queued')).toBe(false);
    expect(taskIsFinal('running')).toBe(false);
  });
});

describe('parseIdList', () => {
  it('reads comma-separated ids', () => {
    expect(parseIdList('1, 22 ,333')).toEqual([1, 22, 333]);
    expect(parseIdList('')).toEqual([]);
    expect(parseIdList('-100123, 4', true)).toEqual([-100123, 4]);
  });
  it('refuses what the node would reject', () => {
    expect(() => parseIdList('abc')).toThrow(/integers/);
    expect(() => parseIdList('-1')).toThrow(/integers/);
    expect(() => parseIdList('0')).toThrow(/range/);
    expect(() => parseIdList('99999999999999999999')).toThrow(/range/);
  });
});
