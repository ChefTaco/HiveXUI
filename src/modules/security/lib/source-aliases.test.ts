import { describe, expect, it, vi } from 'vitest';
vi.mock('@security/lib/security-api', () => ({ securityFetch: vi.fn() }));
const { labEnabled, mergeSourceAliases, sourceLabel, sourceRelevant } = await import('./security-fusion');
const { securityFetch } = await import('@security/lib/security-api');

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

it('never lets an unreported alias stand in for one with an error', () => {
  const merged = mergeSourceAliases([
    { source: 'chattermost', status: 'unconfigured' },
    { source: 'mattermost', status: 'error', lastError: 'export refused' },
  ]);
  expect(merged.map((row) => row.source)).toEqual(['mattermost']);
});

it('labels every known feed by product and leaves its identifier alone', () => {
  const feeds = { unifi_dns: 'UniFi DNS', unifi_ids: 'UniFi IDS', netflow: 'NetFlow', wazuh: 'Wazuh', tailscale: 'Tailscale', magnus: 'Magnus fleet', hive: 'Hive security export', magnus_ui: 'Magnus console', chattermost: 'Mattermost-compatible audit', aegis_ui: 'Cindertrace console' };
  for (const [source, label] of Object.entries(feeds)) expect(sourceLabel(source)).toBe(label);
  expect(sourceLabel('future_feed')).toBe('future feed');
  const rows = [{ source: 'unifi_dns', status: 'healthy' }];
  expect(mergeSourceAliases(rows)[0]!.source).toBe('unifi_dns');
});

describe('sourceRelevant', () => {
  const silent = (source: string) => ({ source, status: 'unconfigured' });
  const none = () => false;

  it('hides a silent feed for an absent product and shows it once installed', () => {
    expect(sourceRelevant(silent('magnus'), none)).toBe(false);
    expect(sourceRelevant(silent('hive'), none)).toBe(false);
    expect(sourceRelevant(silent('magnus'), (product) => product === 'magnus')).toBe(true);
    expect(sourceRelevant(silent('hive'), (product) => product === 'emberpath')).toBe(true);
  });

  it('hides a silent external feed even though every suite product is installed', () => {
    expect(sourceRelevant(silent('unifi_dns'), () => true)).toBe(false);
  });

  it.each([
    { source: 'magnus', status: 'healthy' },
    { source: 'magnus', status: 'error' },
    { source: 'magnus', status: 'unconfigured', lastEventAt: '2026-01-01T00:00:00Z' },
    { source: 'magnus', status: 'unconfigured', lastSuccessAt: '2026-01-01T00:00:00Z' },
    { source: 'magnus', status: 'unconfigured', lastError: 'refused' },
  ])('never hides a feed that has reported: %o', (source) => {
    expect(sourceRelevant(source, none)).toBe(true);
  });

  it('treats a live collector grant as configured, but not a revoked one', () => {
    expect(sourceRelevant(silent('netflow'), none, [{ allowedSources: ['netflow'], revokedAt: null }])).toBe(true);
    expect(sourceRelevant(silent('netflow'), none, [{ allowedSources: ['netflow'], revokedAt: '2026-01-01T00:00:00Z' }])).toBe(false);
  });
});

describe('labEnabled', () => {
  const fetchLab = vi.mocked(securityFetch);

  it('follows the server flag and hides the lab when the request fails', async () => {
    fetchLab.mockResolvedValueOnce({ success: true, data: { enabled: true, canAdmin: true, runs: [] } });
    await expect(labEnabled()).resolves.toBe(true);
    fetchLab.mockResolvedValueOnce({ success: true, data: { enabled: false, canAdmin: true, runs: [] } });
    await expect(labEnabled()).resolves.toBe(false);
    fetchLab.mockRejectedValueOnce(new Error('forbidden'));
    await expect(labEnabled()).resolves.toBe(false);
    expect(fetchLab).toHaveBeenCalledWith('security-fusion/lab');
  });
});
