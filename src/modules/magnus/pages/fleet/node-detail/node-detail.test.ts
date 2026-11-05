import { describe, expect, it } from 'vitest';
import { cockpitUrl, detectedPlugins, detectedSkills, findInstallation, findPluginLabel, formatBytes, hermesDashboardAddress, parseAptCount, parseRoleSteps, parseServices, parseSystemUpdates, parseVersions, parseWazuh, selfUpgradeReport, skillSummary, VERSION_COMMAND, type HermesInstallation } from './node-data';
import { computePersonality } from './personality';

describe('values a node reports as JSON', () => {
  it('reads services and survives anything else', () => {
    expect(parseServices('[{"name":"redis","status":"active"},{"nope":1}]')).toEqual([{ name: 'redis', status: 'active' }]);
    for (const value of ['', 'not json', '{}', null, undefined]) expect(parseServices(value)).toEqual([]);
  });
  it('reads Wazuh only when it has the whole shape', () => {
    const wazuh = { installed: true, serviceStatus: 'active', enabled: 'enabled', version: null, managerAddresses: ['192.0.2.1'] };
    expect(parseWazuh(JSON.stringify(wazuh))).toEqual(wazuh);
    expect(parseWazuh('{}')).toBeNull();
    expect(parseWazuh(JSON.stringify({ ...wazuh, serviceStatus: 'strange' }))).toBeNull();
    expect(parseWazuh(undefined)).toBeNull();
  });
  it('accepts system updates from an older agent that reports less', () => {
    const updates = { supported: true, platform: 'debian', automaticUpdates: 'partial', timers: [], rebootRequired: false, rebootRequiredPackages: [] };
    expect(parseSystemUpdates(JSON.stringify(updates))?.fullUpgradePolicyEnabled).toBeUndefined();
    expect(parseSystemUpdates(JSON.stringify({ ...updates, automaticUpdates: 'other' }))).toBeNull();
    expect(parseSystemUpdates('{}')).toBeNull();
  });
  it('reads the self-upgrade report and ignores its absence', () => {
    expect(selfUpgradeReport(JSON.stringify({ agentSelfUpgrade: { protocol: 1, enabled: false, reason: 'off', layout: 'versioned', launcherProtocol: null } }))).toEqual({ enabled: false, reason: 'off' });
    expect(selfUpgradeReport('{}')).toBeNull();
    expect(selfUpgradeReport('broken')).toBeNull();
  });
  it('keeps the role steps it understands', () => {
    expect(parseRoleSteps([{ name: 'a', status: 'failed', error: 'x' }, { name: 'b', status: 'other' }, 3])).toEqual([{ name: 'a', status: 'failed', error: 'x' }]);
  });
});

describe('formatting', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(-1048576)).toBe('-1.0 MB');
    expect(formatBytes(undefined)).toBe('—');
  });
  it('offers a Cockpit link only for a host', () => {
    expect(cockpitUrl('192.0.2.1')).toBe('https://192.0.2.1:9090/');
    expect(cockpitUrl('2001:db8::1')).toBe('https://[2001:db8::1]:9090/');
    expect(cockpitUrl('node-1.example.com')).toBe('https://node-1.example.com:9090/');
    for (const value of ['evil.example/x?', 'user@evil.example', 'a b', 'javascript:alert(1)//']) expect(cockpitUrl(value)).toBeNull();
  });
});

describe('Hermes', () => {
  const installation = (extra: Partial<HermesInstallation>) => ({ id: 'i', nodeId: null, hostname: 'h', status: 'running', rawStatus: {}, dashboardHost: '0.0.0.0', dashboardPort: 9119, ...extra }) as HermesInstallation;
  it('finds the installation by node first, then by host, and not one marked absent', () => {
    const node = { id: 'n', hostname: 'host', ipAddress: '192.0.2.1' };
    const byHost = installation({ id: 'host', hostname: 'host' });
    const byNode = installation({ id: 'node', nodeId: 'n' });
    expect(findInstallation([byHost, byNode], node)?.id).toBe('node');
    expect(findInstallation([byHost], node)?.id).toBe('host');
    expect(findInstallation([installation({ hostname: '192.0.2.1' })], node)?.id).toBe('i');
    expect(findInstallation([installation({ nodeId: 'n', status: 'not_installed' })], node)).toBeNull();
    expect(findInstallation([], node)).toBeNull();
  });
  it('reads skills and plugins from the raw status', () => {
    const raw = installation({ rawStatus: { skills: [{ slug: 'a', category: null, source: 'local', enabled: true }, { slug: 'b', source: 'local', enabled: false }, 'junk'], plugins: [{ slug: 'web-search', pluginType: 'tool', version: '1', status: 'enabled' }, { slug: 'firecrawl', pluginType: 'tool', status: 'not enabled' }, { slug: 'browser', status: 'Enabled' }] } });
    const skills = detectedSkills(raw);
    expect(skillSummary(skills)).toBe('1 enabled / 2 total');
    expect(skillSummary([])).toBe('0 synced');
    const plugins = detectedPlugins(raw);
    expect(findPluginLabel(plugins, 'search')).toBe('web-search 1');
    expect(findPluginLabel(plugins, 'crawl')).toBe('browser');
    expect(findPluginLabel([], 'crawl')).toBe('none enabled');
    expect(detectedSkills(installation({}))).toEqual([]);
  });
  it('shows a reachable address for a dashboard bound to every interface', () => {
    expect(hermesDashboardAddress(installation({}))).toBe('h:9119');
    expect(hermesDashboardAddress(installation({ dashboardHost: '[::1]' }))).toBe('h:9119');
    expect(hermesDashboardAddress(installation({ dashboardHost: 'dash.example' }))).toBe('dash.example:9119');
  });
});

describe('software probes', () => {
  it('quotes the script for a login shell', () => {
    expect(VERSION_COMMAND.startsWith("bash -lc 'version_or_na()")).toBe(true);
    expect(VERSION_COMMAND).toContain("'\\''process.stdout");
  });
  it('reads versions, keeping = inside a value', () => {
    expect(parseVersions('motd\nnode=v22\nredis=redis-cli a=b\nnpm=\n')).toEqual({ node: 'v22', redis: 'redis-cli a=b', npm: 'unknown' });
  });
  it('reads the count from the last line', () => {
    expect(parseAptCount('welcome\n12\n')).toBe(12);
    expect(parseAptCount('')).toBeNull();
    expect(parseAptCount('nothing')).toBeNull();
  });
});

describe('node personality', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const node = { id: 'node-1', hostname: 'host', status: 'ONLINE', lastHeartbeatAt: '2026-11-05T11:59:00Z' };
  const samples = (cpu: readonly number[]) => cpu.map((value) => ({ cpuUsagePercent: value, memoryPercent: 50 }));
  const key = (cpu: readonly number[], over = {}) => computePersonality({ ...node, ...over }, samples(cpu), now).archetypeKey;
  it('starts as a rookie', () => {
    expect(key([])).toBe('rookie');
    expect(key([1, 2])).toBe('rookie');
  });
  it('calls an absent node a ghost, whatever it did before', () => {
    expect(key([50, 50, 50], { status: 'OFFLINE' })).toBe('ghost');
    expect(key([50, 50, 50], { lastHeartbeatAt: '2026-11-05T11:40:00Z' })).toBe('ghost');
  });
  it('tells the steady from the spiky', () => {
    expect(key([50, 52, 48])).toBe('workhorse');
    expect(key([5, 6, 7])).toBe('zen-master');
    expect(key(Array.from({ length: 25 }, () => 30))).toBe('marathoner');
    expect(key([90, 95, 5, 90, 5])).toBe('drama-queen');
    expect(key([5, 5, 5, 95, 5, 5, 5, 5])).toBe('sprinter');
  });
  it('reports the figures and a bio that stays for the week', () => {
    const result = computePersonality(node, samples([50, 52, 48, 90]), now);
    expect(result.stats).toMatchObject({ samples: 4, spikes: 1, memAvg: 50 });
    expect(result.stats.cpuAvg).toBe(60);
    expect(result.bio).toBe(computePersonality(node, samples([50, 52, 48, 90]), now + 1000).bio);
    expect(result.bio.length).toBeGreaterThan(0);
  });
});
