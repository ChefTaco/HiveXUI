import { describe, expect, it } from 'vitest';
import { applicationIsActive, envEntriesFor, envPayload, isWritableFirewallMode, parseLines, parseList, parseSteps } from './logic';

describe('environment values below ADMIN', () => {
  const role = { envConfigKeys: ['API_KEY', 'REGION'] };
  it('shows key names only, locked against removal and renaming', () => {
    expect(envEntriesFor(role, false)).toEqual([{ key: 'API_KEY', value: '', locked: true }, { key: 'REGION', value: '', locked: true }]);
  });
  it('sends every existing key, so the merge keeps blanks and a typed value replaces', () => {
    const entries = envEntriesFor(role, false).map((entry) => (entry.key === 'REGION' ? { ...entry, value: 'eu' } : entry));
    expect(envPayload([...entries, { key: ' NEW ', value: 'n', locked: false }], role, false)).toEqual({ API_KEY: '', REGION: 'eu', NEW: 'n' });
  });
  it('does not lock the keys on a new role', () => {
    expect(envEntriesFor(null, false)).toEqual([]);
  });
});

describe('environment values at ADMIN', () => {
  const role = { envConfig: { API_KEY: 'secret' }, envConfigKeys: ['API_KEY'] };
  it('shows the values, and removing a key removes it from the role', () => {
    expect(envEntriesFor(role, true)).toEqual([{ key: 'API_KEY', value: 'secret', locked: false }]);
    expect(envPayload([], role, true)).toEqual({});
  });
  it('drops a row with no name', () => {
    expect(envPayload([{ key: '  ', value: 'x', locked: false }], null, true)).toEqual({});
  });
  it('sends nothing rather than blanking values it never received, because a PATCH replaces the record', () => {
    const withoutValues = { envConfigKeys: ['API_KEY'] };
    expect(envPayload(envEntriesFor(withoutValues, true), withoutValues, true)).toBeUndefined();
  });
});

describe('list fields', () => {
  it('splits packages on commas or spaces, and volumes on lines or commas', () => {
    expect(parseList('nginx, curl  jq,')).toEqual(['nginx', 'curl', 'jq']);
    expect(parseLines('/a:/b\n/c d:/e, /f:/g')).toEqual(['/a:/b', '/c d:/e', '/f:/g']);
  });
});

describe('parseSteps', () => {
  it('reads well-formed steps and leaves out the rest', () => {
    expect(parseSteps([{ name: 'packages', status: 'completed' }, { name: 'firewall', status: 'failed', error: 'no ufw' }, 'junk', null, ['x'], { name: 'no status' }, { name: 'x', status: 'running', error: 3 }])).toEqual([
      { name: 'packages', status: 'completed' },
      { name: 'firewall', status: 'failed', error: 'no ufw' },
      { name: 'x', status: 'running' },
    ]);
  });
});

describe('status', () => {
  it('knows which applications are still moving', () => {
    expect(applicationIsActive('pending')).toBe(true);
    expect(applicationIsActive('running')).toBe(true);
    expect(applicationIsActive('completed')).toBe(false);
  });
  it('writes only the firewall modes the API accepts', () => {
    expect(isWritableFirewallMode('restrictive')).toBe(true);
    expect(isWritableFirewallMode('permissive')).toBe(true);
    expect(isWritableFirewallMode('custom')).toBe(false);
  });
});
