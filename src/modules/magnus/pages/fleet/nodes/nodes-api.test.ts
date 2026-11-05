import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { diskSeverity, listAllNodes, nodeError, parseDisks, parseTags, readNodeHealth, worstPersistentDisk, type NodeRow } from './nodes-api';

const node = (id: string, heartbeat: string | null = '2026-11-05T10:00:00.000Z') => ({ id, name: id, hostname: id, ipAddress: '192.0.2.1', port: 4100, status: 'ONLINE', os: 'linux', arch: 'x86_64', tags: '[]', metadata: '{}', roleId: null, lastHeartbeatAt: heartbeat, createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', agent: null, role: null, upgradeReadiness: null });
const disk = (mountPoint: string, usagePercent: number, filesystemType?: string) => ({ mountPoint, totalBytes: 1, usedBytes: 1, freeBytes: 0, usagePercent, filesystem: 'x', ...(filesystemType ? { filesystemType } : {}) });
const snapshot = (nodeId: string) => ({ success: true, data: { id: 's', nodeId, timestamp: '2026-11-05T10:00:00.000Z', cpuUsagePercent: 1, cpuCores: 1, cpuLoadAverage: '[]', memoryTotalBytes: 1, memoryUsedBytes: 1, memoryPercent: 1, swapTotalBytes: 0, swapUsedBytes: 0, disks: '[]', network: '[]', services: '[]', wazuh: '{}', systemUpdates: '{}', cockpitAvailable: false, source: 'agent' } });

const request = vi.fn<typeof fetch>();
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
  configureEndpoint('magnus', '/api/magnus');
});
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});

describe('reading the fleet', () => {
  it('follows every page, unlike the old console, which stopped at the first', async () => {
    request.mockResolvedValueOnce(Response.json({ success: true, data: [node('a')], meta: { total: 2, page: 1, pageSize: 100, hasMore: true } }));
    request.mockResolvedValueOnce(Response.json({ success: true, data: [node('b')], meta: { total: 2, page: 2, pageSize: 100, hasMore: false } }));
    const result = await listAllNodes(new AbortController().signal);
    expect(result.nodes.map((item) => item.id)).toEqual(['a', 'b']);
    expect(String(request.mock.calls[1]![0])).toBe('/api/magnus/nodes?page=2&pageSize=100');
  });
  it('asks for health only for nodes that have reported, and a failed row stays a dash', async () => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      return url.includes('/bad/') ? Response.json({ error: { message: 'no snapshot' } }, { status: 404 }) : Response.json(snapshot('a'));
    });
    const result = await readNodeHealth([node('a'), node('bad'), node('never', null)] as NodeRow[], new AbortController().signal);
    expect(Object.keys(result)).toEqual(['a']);
    expect(request.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/magnus/nodes/a/health', '/api/magnus/nodes/bad/health']);
  });
  it('bounds the requests a large fleet makes at once', async () => {
    let active = 0;
    let peak = 0;
    request.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return Response.json(snapshot('a'));
    });
    await readNodeHealth(Array.from({ length: 30 }, (_, index) => node(`n${index}`)) as NodeRow[], new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(30);
    expect(peak).toBeLessThanOrEqual(6);
  });
});

describe('JSON-encoded columns', () => {
  it('read tags, disks and errors, and treat damage as nothing', () => {
    expect(parseTags('["a","b",1]')).toEqual(['a', 'b']);
    expect(parseTags('nope')).toEqual([]);
    expect(parseDisks(JSON.stringify([disk('/', 1)]))).toHaveLength(1);
    expect(parseDisks('[{"bad":1}]')).toEqual([]);
    expect(parseDisks(null)).toEqual([]);
    expect(nodeError('{"deployError":"x"}')).toEqual({ label: 'Deploy failed', message: 'x' });
    expect(nodeError('{"upgradeError":"y"}')).toEqual({ label: 'Upgrade failed', message: 'y' });
    expect(nodeError('nope')).toBeNull();
  });
  it('picks the fullest filesystem that holds workload data', () => {
    expect(worstPersistentDisk(JSON.stringify([disk('/', 40), disk('/mnt/data', 90), disk('/boot', 99), disk('/snap/x', 100), disk('/home/iso', 100, 'iso9660')]))?.mountPoint).toBe('/mnt/data');
    expect(worstPersistentDisk('[]')).toBeNull();
    expect([79, 80, 95].map(diskSeverity)).toEqual(['normal', 'warning', 'critical']);
  });
});
