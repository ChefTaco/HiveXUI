// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type Mounted } from '../magnus/test-dom';
import { createSkillsApi } from './api';
import { exportAuditRecords } from './audit-export';
import { RegistryRelease } from './index';

const record = (id: number) => ({ id: `hiveskills:audit:${id}`, product: 'hiveskills', occurredAt: '2026-11-26T10:00:00.000Z', action: 'release.promote', outcome: 'success', actor: { type: 'user', id: 'operator' }, details: { channel: 'stable' } });

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

describe('the registry update status and audit export', () => {
  it('reads both through the registry, checking them against the contract', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ enabled: true, installed: '1.9.1', available: '1.10.0', summary: 'Signed releases', checkedAt: '2026-11-26T09:00:00.000Z' }))
      .mockResolvedValueOnce(Response.json({ data: [record(1)], nextCursor: 'c1' }))
      .mockResolvedValueOnce(Response.json({ data: [{ ...record(2), details: { nested: { no: true } } }], nextCursor: 'c2' }));
    const api = createSkillsApi(send);
    expect((await api.updates()).available).toBe('1.10.0');
    expect((await api.auditExport()).nextCursor).toBe('c1');
    await expect(api.auditExport('c1')).rejects.toThrow();
    expect(send.mock.calls.map((call) => call[0])).toEqual(['/api/skills/admin/updates', '/api/skills/v1/audit/export?limit=200', '/api/skills/v1/audit/export?limit=200&after=c1']);
  });

  it('saves every page as JSON Lines, stopping at an empty page or at its page cap', async () => {
    const pages: Record<string, { data: ReturnType<typeof record>[]; nextCursor: string | null }> = {
      '': { data: [record(1), record(2)], nextCursor: 'c2' },
      c2: { data: [record(3)], nextCursor: 'c3' },
      c3: { data: [], nextCursor: null },
    };
    const read = vi.fn(async (after?: string) => pages[after ?? ''] as never);
    const save = vi.fn();
    expect(await exportAuditRecords(read, save)).toEqual({ count: 3, truncated: false });
    const [text, name] = save.mock.calls[0]!;
    expect((text as string).trim().split('\n').map((line) => JSON.parse(line).id)).toEqual(['hiveskills:audit:1', 'hiveskills:audit:2', 'hiveskills:audit:3']);
    expect(name).toMatch(/^hiveskills-audit-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(await exportAuditRecords(read, save, 1)).toEqual({ count: 2, truncated: true });
  });

  it('says when a newer registry release is available, and when update checks are off', async () => {
    stubBrowser();
    view = await mount(<RegistryRelease status={{ enabled: true, installed: '1.9.1', available: '1.10.0', summary: 'Signed releases', notesUrl: 'javascript:alert(1)', newRequiredEnv: [{ name: 'HIVE_SKILLS_PUBLISHER_KEYS' }] }} />);
    expect(document.body.textContent).toContain('HiveSkills 1.10.0 is available: Signed releases');
    expect(document.body.textContent).toContain('New required settings: HIVE_SKILLS_PUBLISHER_KEYS.');
    // A notes address that is not http(s) is not a link.
    expect(document.querySelector('a')).toBeNull();
    await view.unmount();
    view = await mount(<RegistryRelease status={{ enabled: false, installed: '1.9.1' }} />);
    expect(document.body.textContent).toContain('Update checks are off');
  });
});
