import { describe, expect, it } from 'vitest';
import { issueRequest } from './keys';

describe('the Issue key link', () => {
  it('suggests a name a key may have, and nothing else', () => {
    expect(issueRequest(null)).toBeNull();
    expect(issueRequest(' ardent-scout ')).toBe('ardent-scout');
    expect(issueRequest('ardent-node-1.lead')).toBe('ardent-node-1.lead');
    // Opened, but without a name that could carry markup or a credential-like value.
    expect(issueRequest('<script>')).toBe('');
    expect(issueRequest('x'.repeat(65))).toBe('');
    expect(issueRequest('')).toBe('');
  });
});
