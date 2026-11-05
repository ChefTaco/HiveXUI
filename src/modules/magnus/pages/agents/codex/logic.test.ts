import { describe, expect, it } from 'vitest';
import { authTone, canRequestUpdate, safeExternalUrl } from './logic';

describe('canRequestUpdate', () => {
  const base = { installed: true, updateSupported: true, updateAvailable: false, latestVersion: '1.0.0' };
  it('offers an update when one is available, or when the latest version is unknown', () => {
    expect(canRequestUpdate({ ...base, updateAvailable: true })).toBe(true);
    expect(canRequestUpdate({ ...base, latestVersion: null })).toBe(true);
  });
  it('offers nothing when current, not installed, or not supported', () => {
    expect(canRequestUpdate(base)).toBe(false);
    expect(canRequestUpdate({ ...base, updateAvailable: true, installed: false })).toBe(false);
    expect(canRequestUpdate({ ...base, updateAvailable: true, updateSupported: false })).toBe(false);
  });
});

describe('authTone', () => {
  it('colors by meaning', () => {
    expect(authTone('authenticated')).toBe('success');
    expect(authTone('error')).toBe('danger');
    expect(authTone('expired_logged_out')).toBe('warning');
    expect(authTone('not_authenticated')).toBe('neutral');
  });
});

describe('safeExternalUrl', () => {
  it('keeps an http(s) page from the node', () => {
    expect(safeExternalUrl('https://auth.openai.com/codex/device')).toBe('https://auth.openai.com/codex/device');
  });
  it('never makes a link of a script or a broken address', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', 'not a url', '']) expect(safeExternalUrl(value)).toBeNull();
  });
});
