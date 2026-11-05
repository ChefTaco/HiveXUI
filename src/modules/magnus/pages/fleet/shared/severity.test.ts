import { describe, expect, it } from 'vitest';
import { formatBytes, severityTone } from './severity';

describe('severityTone', () => {
  it('maps severities and log levels in any case', () => {
    expect(severityTone('critical')).toBe('danger');
    expect(severityTone('ERROR')).toBe('danger');
    expect(severityTone('warn')).toBe('warning');
    expect(severityTone('info')).toBe('info');
    expect(severityTone('debug')).toBe('neutral');
  });
});

describe('formatBytes', () => {
  it('scales to the largest whole unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 3 * 250)).toBe('250 GB');
  });
  it('does not invent a size for nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});
