import { describe, expect, it } from 'vitest';
import { timelineResponseSchema } from '@contracts/magnus/browser';
import { canFollow, countByType, keyedTimeline, summarizeTimeline, type TimelineItem } from './timeline-model';

const item = (type: TimelineItem['type'], title: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({ type, title, timestamp: '2026-11-05T10:00:00.000Z', severity: 'info', href: '/logs', ...extra });

describe('the timeline answer', () => {
  it('parses what GET /ops/timeline sends, with and without a node', () => {
    const parsed = timelineResponseSchema.parse({
      success: true,
      data: [
        { type: 'deploy', severity: 'info', title: 'deploy COMPLETED', timestamp: '2026-11-05T10:00:00.000Z', href: '/governor/operations' },
        { type: 'command', severity: 'error', title: 'df -h FAILED', node: 'node-1', timestamp: '2026-11-05T09:00:00.000Z', href: '/commands?commandId=c1', extra: 'dropped' },
        { type: 'log', severity: 'warn', title: 'disk', node: null, timestamp: '2026-11-05T08:00:00.000Z', href: '/logs' },
      ],
    });
    expect(parsed.data).toHaveLength(3);
    expect(parsed.data[1]).not.toHaveProperty('extra');
  });
  it('rejects a type the page does not know', () => {
    expect(timelineResponseSchema.safeParse({ success: true, data: [{ type: 'heartbeat', severity: 'info', title: 'x', timestamp: 'x', href: '/' }] }).success).toBe(false);
  });
});

describe('timeline', () => {
  it('filters by type', () => {
    expect(keyedTimeline([item('log', 'a'), item('audit', 'b')], 'audit').map(({ title }) => title)).toEqual(['b']);
  });
  it('gives identical items distinct, stable keys', () => {
    const keys = keyedTimeline([item('log', 'same'), item('log', 'same'), item('log', 'other')]).map(({ key }) => key);
    expect(new Set(keys).size).toBe(3);
    expect(keyedTimeline([item('log', 'same'), item('log', 'same'), item('log', 'other')]).map(({ key }) => key)).toEqual(keys);
  });
  it('counts each type for the filter', () => {
    expect(countByType([item('log', 'a'), item('log', 'b'), item('deploy', 'c')])).toEqual({ all: 3, notification: 0, command: 0, deploy: 1, hermes: 0, log: 2, audit: 0 });
  });
  it('sums up warnings, nodes and the newest event', () => {
    expect(summarizeTimeline([
      item('command', 'a', { severity: 'error', node: 'n1', timestamp: '2026-11-05T09:00:00.000Z' }),
      item('log', 'b', { severity: 'warn', node: 'n1', timestamp: '2026-11-05T11:00:00.000Z' }),
      item('audit', 'c', { node: 'n2', timestamp: 'not a date' }),
      item('deploy', 'd', { severity: 'success' }),
    ])).toEqual({ events: 4, attention: 2, nodes: 2, latest: '2026-11-05T11:00:00.000Z' });
    expect(summarizeTimeline([])).toEqual({ events: 0, attention: 0, nodes: 0, latest: null });
  });
});

describe('timeline links', () => {
  const viewer = { role: 'VIEWER' as const, hermes: false };
  const operator = { role: 'OPERATOR' as const, hermes: true };
  it('follow ported pages the session may open', () => {
    expect(canFollow('/logs', viewer)).toBe(true);
    expect(canFollow('/commands?commandId=c1', operator)).toBe(true);
    expect(canFollow('/orchestra/installations', operator)).toBe(true);
  });
  it('stay text for a role the page refuses, Hermes when it is off, and unknown paths', () => {
    expect(canFollow('/commands?commandId=c1', viewer)).toBe(false);
    expect(canFollow('/orchestra/installations', viewer)).toBe(false);
    expect(canFollow('/no-such-page', operator)).toBe(false);
    expect(canFollow('/logs', { role: null, hermes: false })).toBe(true);
    expect(canFollow('/commands', { role: null, hermes: false })).toBe(false);
  });
});
