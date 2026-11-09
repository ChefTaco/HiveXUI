// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { button, click, mount, stubBrowser, type } from '../../../test-dom';
import { ManagedJobs } from './managed-jobs';
const fixture = vi.hoisted(() => ({ write: true, enabled: true, expires: '2035-01-01T00:00:00.000Z', patch: vi.fn(async () => ({})) }));
vi.mock('../../../session', () => ({ WRITE_ROLES: ['ADMIN', 'OPERATOR'], useMagnusSession: () => ({ can: () => fixture.write }) }));
vi.mock('../../../api/client', () => ({ segment: encodeURIComponent, magnus: { patch: (...args: unknown[]) => fixture.patch(...args as []), get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../api/use-resource', () => ({ useMagnusResource: () => ({ data: { data: [{ id: 'job-1', nodeId: 'node-1', node: { name: 'fixture' },
  name: 'diagnostic', command: '/usr/bin/uptime', args: '[]', schedule: '* * * * *', timeoutSeconds: 60,
  managed: { revision: 7, enabled: fixture.enabled, expiresAt: fixture.expires, timezone: 'UTC' } }] }, refresh: vi.fn(), loading: false }) }));
describe('managed schedule controls', () => {
  let mounted: Awaited<ReturnType<typeof mount>>;
  beforeEach(() => { stubBrowser(); fixture.write = true; fixture.enabled = true; fixture.expires = '2035-01-01T00:00:00.000Z'; fixture.patch.mockClear(); });
  afterEach(async () => { await mounted?.unmount(); });
  it('lets an operator pause a schedule without issuing new authority', async () => {
    mounted = await mount(<ManagedJobs />); await click(button('Pause'));
    expect(fixture.patch).toHaveBeenCalledWith('/cron/job-1', expect.anything(), { body: { status: 'PAUSED' } });
  });
  it('treats expired authority as expired and resumes with an increased revision', async () => {
    fixture.expires = '2000-01-01T00:00:00.000Z'; mounted = await mount(<ManagedJobs />);
    expect(mounted.container.textContent).toContain('Expired'); await click(button('Resume…'));
    const dialog = document.querySelector('[role="dialog"]')!;
    await type(dialog.querySelector('input[type="datetime-local"]'), '2030-01-01T00:00');
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fixture.patch).toHaveBeenCalledWith('/cron/job-1', expect.anything(), { body: {
      status: 'ACTIVE', timeoutSeconds: 60, managed: { revision: 8, timezone: 'UTC', timeoutSeconds: 60, expiresAt: expect.any(Number) } } });
  });
  it('shows status to viewers without offering creation, pause or resume', async () => {
    fixture.write = false; mounted = await mount(<ManagedJobs />);
    expect(button('Add managed job')).toBeUndefined(); expect(button('Pause')).toBeUndefined(); expect(button('Resume…')).toBeUndefined();
  });
});
