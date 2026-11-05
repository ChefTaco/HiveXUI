import { describe, expect, it } from 'vitest';
import { CATEGORIES, CHANNELS, isEnabled, minSeverity, preferencePayload, samePreferences, setCategorySeverity, togglePref } from './prefs';

describe('notification preferences', () => {
  it('default to in-app only', () => {
    expect(isEnabled([], 'in_app', 'node.offline')).toBe(true);
    expect(isEnabled([], 'email', 'node.offline')).toBe(false);
    expect(minSeverity([], 'node.offline')).toBe('info');
  });
  it('turn a default-on channel off on the first click', () => {
    // The old console set enabled: true here, so the first click on in-app did nothing.
    expect(isEnabled(togglePref([], 'in_app', 'node.offline'), 'in_app', 'node.offline')).toBe(false);
    expect(isEnabled(togglePref([], 'email', 'node.offline'), 'email', 'node.offline')).toBe(true);
  });
  it('flip a saved row back and forth', () => {
    const once = togglePref([{ channel: 'email', category: 'a', enabled: true, minSeverity: 'warning' }], 'email', 'a');
    expect(once).toEqual([{ channel: 'email', category: 'a', enabled: false, minSeverity: 'warning' }]);
    expect(isEnabled(togglePref(once, 'email', 'a'), 'email', 'a')).toBe(true);
  });
  it('change severity without enabling email or webhook', () => {
    // The old console turned every channel on when the severity changed.
    const prefs = setCategorySeverity([], 'node.offline', 'critical');
    expect(minSeverity(prefs, 'node.offline')).toBe('critical');
    expect(isEnabled(prefs, 'email', 'node.offline')).toBe(false);
    expect(isEnabled(prefs, 'webhook', 'node.offline')).toBe(false);
    expect(isEnabled(prefs, 'in_app', 'node.offline')).toBe(true);
    expect(prefs).toHaveLength(CHANNELS.length);
  });
  it('send every category on every channel, within the server limit of 100', () => {
    const payload = preferencePayload([]);
    expect(payload).toHaveLength(CATEGORIES.length * CHANNELS.length);
    expect(payload.length).toBeLessThanOrEqual(100);
    expect(payload.filter(({ enabled }) => enabled)).toHaveLength(CATEGORIES.length);
  });
  it('are clean again once a change is undone', () => {
    const changed = togglePref([], 'email', 'ai.anomaly');
    expect(samePreferences([], changed)).toBe(false);
    expect(samePreferences([], togglePref(changed, 'email', 'ai.anomaly'))).toBe(true);
  });
});
