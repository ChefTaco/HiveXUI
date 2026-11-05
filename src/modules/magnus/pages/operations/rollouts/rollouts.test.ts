import { describe, expect, it } from 'vitest';
import { abortMessage, canAbort, canPause, canResume, convergencePercent, convergenceTone, statusColor } from './rollout-model';

describe('rollout convergence', () => {
  it('counts passed and failed nodes as done', () => {
    expect(convergencePercent({ totalNodes: 4, completedNodes: 1, failedNodes: 1 })).toBe(50);
    expect(convergencePercent({ totalNodes: 0, completedNodes: 0, failedNodes: 0 })).toBe(0);
  });
  it('shows failure above progress', () => {
    expect(convergenceTone({ totalNodes: 4, completedNodes: 3, failedNodes: 1 })).toBe('danger');
    expect(convergenceTone({ totalNodes: 4, completedNodes: 4, failedNodes: 0 })).toBe('success');
    expect(convergenceTone({ totalNodes: 4, completedNodes: 1, failedNodes: 0 })).toBe('accent');
  });
});

describe('rollout controls', () => {
  it('follow the status', () => {
    expect([canPause('running'), canPause('paused')]).toEqual([true, false]);
    expect([canResume('paused'), canResume('running')]).toEqual([true, false]);
    expect(['running', 'paused', 'created', 'completed', 'failed', 'cancelled'].map(canAbort)).toEqual([true, true, true, false, false, false]);
  });
  it('colors a status and names what abort does', () => {
    expect(statusColor('failed')).toBe('danger');
    expect(statusColor('completed')).toBe('success');
    expect(statusColor('running')).toBe('warning');
    expect(abortMessage('r1')).toBe('Abort rollout r1? Pending targets will be cancelled.');
  });
});
