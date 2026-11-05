import { expect, it, vi } from 'vitest';
vi.mock('@security/lib/security-api', () => ({ securityFetch: vi.fn() }));
const { mergeSourceAliases, sourceLabel } = await import('./security-fusion');

it('shows one feed per product label and prefers the healthiest, most recent alias', () => {
  const merged = mergeSourceAliases([
    { source: 'aegis_ui', status: 'unconfigured', lastSuccessAt: null },
    { source: 'security_console', status: 'healthy', lastSuccessAt: '2026-01-01T00:00:00Z' },
    { source: 'cindertrace_ui', status: 'healthy', lastSuccessAt: '2026-01-02T00:00:00Z' },
    { source: 'chattermost', status: 'error', lastSuccessAt: '2026-01-03T00:00:00Z' },
    { source: 'mattermost', status: 'error', lastSuccessAt: '2026-01-01T00:00:00Z' },
    { source: 'wazuh', status: 'healthy', lastSuccessAt: '2026-01-01T00:00:00Z' },
  ]);
  expect(merged.map((row) => row.source)).toEqual(['cindertrace_ui', 'chattermost', 'wazuh']);
  expect(new Set(merged.map((row) => sourceLabel(row.source))).size).toBe(merged.length);
});
