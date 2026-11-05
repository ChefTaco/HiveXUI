import { beforeEach, describe, expect, it } from 'vitest';
import { eventToEntry, recentActivityEntries } from './event-entry';
import { eventFeed } from './feed';
import { liveStatus } from './use-live-events';

beforeEach(() => eventFeed.reset());

describe('fleet events', () => {
  it('names the events operators care about, and flags them for a toast', () => {
    expect(eventToEntry('deploy:status', { type: 'deploy.failed', nodeName: 'web-1', message: 'disk full' })).toEqual({ title: 'Deploy failed: web-1', message: 'disk full', severity: 'error', toast: true });
    expect(eventToEntry('alert:fired', { type: 'health.alert', nodeName: 'web-1', metric: 'disk_usage', value: 91.26, threshold: 90, severity: 'error' })).toEqual({ title: 'Alert: disk usage on web-1', message: '91.3%, threshold 90%', severity: 'error', toast: true });
    expect(eventToEntry('command:status', { type: 'command.failed', command: 'uptime', exitCode: 2 })).toMatchObject({ message: 'uptime exit 2', severity: 'error' });
  });
  it('shows anything else quietly and survives payloads of any shape', () => {
    expect(eventToEntry('node:status', { type: 'node.seen', nodeName: 'web-1' })).toEqual({ title: 'node seen', message: 'web-1', severity: 'info', toast: false });
    for (const payload of [null, 7, 'text', [], {}, { type: 'health.alert', severity: 'bogus', value: 'x' }]) {
      const entry = eventToEntry('some:channel', payload);
      expect(typeof entry.title).toBe('string');
      expect(['info', 'success', 'warning', 'error']).toContain(entry.severity);
      expect(JSON.stringify(entry)).not.toMatch(/undefined|NaN|\[object/);
    }
  });
  it('turns recent activity into entries, tolerating a bad timestamp', () => {
    const entries = recentActivityEntries({
      recentCommands: [{ id: '1', command: 'uptime', status: 'FAILED', createdAt: '2026-11-05T10:00:00.000Z', node: { name: 'web-1' } }],
      recentAudit: [{ id: '2', action: 'node.register', timestamp: 'not a date', targetType: 'node', targetId: 'x' }],
    });
    expect(entries.map((entry) => entry.severity)).toEqual(['error', 'info']);
    expect(entries[1]!.at).toBe(0);
  });
});

describe('the feed', () => {
  it('keeps the newest fifty and tells listeners', () => {
    let calls = 0;
    const unsubscribe = eventFeed.subscribe(() => { calls += 1; });
    for (let index = 0; index < 60; index += 1) eventFeed.push({ channel: 'c', title: String(index), severity: 'info' });
    expect(eventFeed.get().entries).toHaveLength(50);
    expect(eventFeed.get().entries[0]!.title).toBe('59');
    expect(calls).toBe(60);
    unsubscribe();
  });
  it('orders seeded activity newest first, below live events, and a new seed replaces the old one', () => {
    eventFeed.push({ channel: 'c', title: 'live', severity: 'info' });
    eventFeed.seed([{ id: 'a', at: 1, channel: 'c', title: 'old', severity: 'info' }, { id: 'b', at: 2, channel: 'c', title: 'new', severity: 'info' }]);
    expect(eventFeed.get().entries.map((entry) => entry.title)).toEqual(['live', 'new', 'old']);
    eventFeed.seed([{ id: 'c', at: 3, channel: 'c', title: 'newest', severity: 'info' }]);
    expect(eventFeed.get().entries.map((entry) => entry.title)).toEqual(['live', 'newest']);
  });
});

describe('the live status', () => {
  it('says what the stream is doing, and never claims to be connecting once it has given up', () => {
    expect(eventFeed.get().status).toBe('waiting');
    eventFeed.setStatus(liveStatus('connecting'));
    expect(eventFeed.get()).toMatchObject({ status: 'connecting', connected: false });
    eventFeed.setStatus(liveStatus('open'));
    expect(eventFeed.get()).toMatchObject({ status: 'live', connected: true });
    eventFeed.setStatus(liveStatus('retrying'));
    expect(eventFeed.get()).toMatchObject({ status: 'retrying', connected: false });
    eventFeed.setStatus(liveStatus('stopped'), 'Your Magnus role does not allow this stream');
    expect(eventFeed.get()).toMatchObject({ status: 'stopped', connected: false, detail: 'Your Magnus role does not allow this stream' });
  });
  it('shows activity from the API as recent, not live, before the stream opens', () => {
    eventFeed.seed([{ id: 'a', at: 1, channel: 'audit', title: 'node.register', severity: 'info' }]);
    expect(eventFeed.get()).toMatchObject({ status: 'waiting', connected: false });
    expect(eventFeed.get().entries).toHaveLength(1);
  });
});
