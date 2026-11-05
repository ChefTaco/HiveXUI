import { describe, expect, it } from 'vitest';
import { QUICK_ACTIONS, resultText, toggleAllOnline } from './quick-actions';

describe('command helpers', () => {
  it('formats a result as the old console did', () => {
    expect(resultText({ exitCode: 2, stdout: 'out', stderr: 'err' })).toBe('Exit: 2\n\n--- stdout ---\nout\n--- stderr ---\nerr');
  });
  it('selects every online node, and clears when all of them are selected', () => {
    expect(toggleAllOnline([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(toggleAllOnline(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(toggleAllOnline(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(toggleAllOnline([], [])).toEqual([]);
  });
  it('keeps the reboot preset marked as dangerous', () => {
    expect(QUICK_ACTIONS.find((action) => action.command === 'sudo reboot')?.variant).toBe('danger');
  });
});
