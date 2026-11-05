import { describe, expect, it } from 'vitest';
import { activeBands, correlationTimeline, EMPTY_RULE_FORM, executionTone, filterRules, hotspot, ruleBody } from './model';
import type { AnomalyCorrelation, AnomalySummary, RemediationRule } from './schemas';

const summary = (fields: Partial<AnomalySummary>): AnomalySummary => ({ totalActive: 0, byNode: [], bySeverity: {}, ...fields });
const node = (nodeId: string, count: number) => ({ nodeId, nodeName: nodeId, count, metrics: [] });

describe('summary', () => {
  it('finds the node with the most anomalies, not the first listed', () => {
    expect(hotspot(summary({ byNode: [node('a', 1), node('b', 5), node('c', 2)] }))?.nodeId).toBe('b');
    expect(hotspot(summary({}))).toBeNull();
    expect(hotspot(undefined)).toBeNull();
  });
  it('counts only bands with anomalies, worst first', () => {
    expect(activeBands(summary({ bySeverity: { info: 2, warning: 0, critical: 1 } }))).toEqual([{ severity: 'critical', count: 1 }, { severity: 'info', count: 2 }]);
    expect(activeBands(summary({ bySeverity: { info: 0, warning: 0, critical: 0 } }))).toEqual([]);
  });
});

describe('correlationTimeline', () => {
  const anomaly = (id: string, createdAt: string) => ({ id, nodeId: 'n', metric: 'cpu', value: 91.256, severity: 'critical', zScore: 3.1, createdAt });
  const details: AnomalyCorrelation = {
    anomaly: { ...anomaly('a', '2026-11-05T10:02:00.000Z'), resolved: false },
    group: {
      anomalies: [anomaly('a', '2026-11-05T10:02:00.000Z'), anomaly('b', '2026-11-05T10:03:00.000Z')],
      relatedCommands: [{ id: 'c', nodeId: 'n', command: 'uptime', status: 'FAILED', createdAt: '2026-11-05T10:01:00.000Z' }],
    },
    analysis: { blastRadius: 'single-node', suspectedTriggers: [], recommendedActions: [], summary: '' },
  };
  it('lists each event once, oldest first, without repeating the primary anomaly', () => {
    expect(correlationTimeline(details).map(({ id, kind }) => [id, kind])).toEqual([['c', 'command'], ['a', 'target-anomaly'], ['b', 'correlated-anomaly']]);
  });
  it('describes an anomaly with rounded figures', () => {
    expect(correlationTimeline(details)[1]!.detail).toBe('Value 91.26 · z-score 3.10 · severity critical');
  });
});

describe('executionTone', () => {
  it('marks what waits on a person', () => {
    expect(executionTone('pending_approval')).toBe('warning');
    expect(executionTone('completed')).toBe('success');
    expect(executionTone('failed')).toBe('danger');
    expect(executionTone('skipped')).toBe('neutral');
  });
});

describe('ruleBody', () => {
  const form = { ...EMPTY_RULE_FORM, name: ' r1 ' };
  it('sends numbers and a trimmed name', () => {
    expect(ruleBody(form, false)).toMatchObject({ body: { name: 'r1', cooldownMinutes: 60, maxConcurrentRuns: 1 } });
  });
  it('omits an empty node filter on create, and clears it on update', () => {
    expect(ruleBody(form, false)).not.toHaveProperty('body.nodeFilter');
    expect(ruleBody(form, true)).toMatchObject({ body: { nodeFilter: null } });
    expect(ruleBody({ ...form, nodeFilter: ' n1 ' }, false)).toMatchObject({ body: { nodeFilter: 'n1' } });
  });
  it('refuses what the server would refuse, and bad JSON', () => {
    expect(ruleBody({ ...form, name: ' ' }, false)).toHaveProperty('error');
    expect(ruleBody({ ...form, cooldownMinutes: '0' }, false)).toHaveProperty('error');
    expect(ruleBody({ ...form, maxConcurrentRuns: '11' }, false)).toHaveProperty('error');
    expect(ruleBody({ ...form, input: '{nope' }, false)).toHaveProperty('error');
    expect(ruleBody({ ...form, input: '{"applicationId":"a"}' }, false)).toHaveProperty('body');
  });
});

describe('filterRules', () => {
  const rule = (name: string, description = '') => ({ name, description }) as RemediationRule;
  it('searches name and description, ignoring case', () => {
    const rules = [rule('Disk cleanup'), rule('other', 'restarts the DISK service'), rule('third')];
    expect(filterRules(rules, 'disk').map(({ name }) => name)).toEqual(['Disk cleanup', 'other']);
    expect(filterRules(rules, ' ')).toHaveLength(3);
  });
});
