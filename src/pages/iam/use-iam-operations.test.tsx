// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../modules/magnus/test-dom';
import { ApiError } from '../../lib/api';
import type { AdminUser } from '../../lib/types';

const { iam } = vi.hoisted(() => ({
  iam: {
    iamHealth: vi.fn(), iamAuditStats: vi.fn(), iamSessions: vi.fn(), iamRoles: vi.fn(), iamUsers: vi.fn(),
    iamServiceAccounts: vi.fn(), iamClients: vi.fn(), iamSystemUsers: vi.fn(), iamAudit: vi.fn(), iamPasswordPolicy: vi.fn(),
  },
}));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, ...iam } };
});
const { useIamOperations } = await import('./use-iam-operations');
const { UsersSection } = await import('./users');

const operator: AdminUser = { id: 'fixture-operator', username: 'operator', permissions: ['*'], roles: ['admin'] };
const user = { id: 'fixture-user', email: 'user@example.com', username: 'user', displayName: 'Fixture user', active: true, lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z', roles: [] };

function Probe({ onAuthExpired }: { onAuthExpired: () => void }) {
  const ops = useIamOperations('overview', operator, onAuthExpired);
  return <><p data-testid="users">{ops.users.map((item) => item.username).join(',')}</p><p data-testid="roles">{ops.roles.length}</p><p role="alert">{ops.error}</p></>;
}

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  iam.iamHealth.mockResolvedValue({ status: 'ok' });
  iam.iamAuditStats.mockResolvedValue({ total: 0 });
  iam.iamSessions.mockResolvedValue({ sessions: [] });
  iam.iamRoles.mockResolvedValue({ roles: [{ id: 'role-viewer', name: 'VIEWER', label: 'Viewer' }] });
  iam.iamUsers.mockResolvedValue({ users: [user], total: 1, page: 1, limit: 100 });
  iam.iamServiceAccounts.mockResolvedValue({ serviceAccounts: [] });
  iam.iamClients.mockResolvedValue({ clients: [] });
  iam.iamSystemUsers.mockResolvedValue({ systemUsers: [] });
  iam.iamAudit.mockResolvedValue({ events: [], total: 0, page: 1, limit: 50 });
  iam.iamPasswordPolicy.mockResolvedValue({ policy: null });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.clearAllMocks();
});
const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;

describe('IAM loading', () => {
  it('shows every section that loaded when another one fails', async () => {
    iam.iamAuditStats.mockRejectedValue(new ApiError('Forbidden', 403));
    const onAuthExpired = vi.fn();
    view = await mount(<Probe onAuthExpired={onAuthExpired} />);
    await settle(20);
    expect(text('users')).toBe('user');
    expect(text('roles')).toBe('1');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Audit statistics: Forbidden');
    expect(onAuthExpired).not.toHaveBeenCalled();
  });
  it('returns to sign-in when the session has ended', async () => {
    iam.iamUsers.mockRejectedValue(new ApiError('Sign in again to continue', 401));
    const onAuthExpired = vi.fn();
    view = await mount(<Probe onAuthExpired={onAuthExpired} />);
    await settle(20);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });
});

function UsersProbe() {
  const ops = useIamOperations('users', operator);
  return <UsersSection ops={ops} />;
}
const many = (from: number, count: number) => Array.from({ length: count }, (_, index) => ({ ...user, id: `fixture-user-${from + index}`, username: `user${from + index}`, email: `user${from + index}@example.com` }));

describe('the IAM users list', () => {
  it('says how many of the directory it shows, pages through it and filters it on the server', async () => {
    iam.iamUsers.mockImplementation(async ({ page = 1, search = '' }: { page?: number; search?: string }) =>
      search ? { users: many(7, 1), total: 1, page: 1, limit: 100 } : { users: many((page - 1) * 100, page === 3 ? 40 : 100), total: 240, page, limit: 100 });
    view = await mount(<UsersProbe />);
    await settle(20);
    expect(document.body.textContent).toContain('1–100 of 240 users');
    expect(iam.iamUsers).toHaveBeenLastCalledWith({ page: 1, limit: 100, search: '' });
    await click(button('Next'));
    await settle(20);
    expect(iam.iamUsers).toHaveBeenLastCalledWith({ page: 2, limit: 100, search: '' });
    expect(document.body.textContent).toContain('101–200 of 240 users');
    await type(document.querySelector('input[type="search"]'), 'user7');
    await settle(350);
    expect(iam.iamUsers).toHaveBeenLastCalledWith({ page: 1, limit: 100, search: 'user7' });
    expect(document.body.textContent).toContain('1 user');
    expect(document.body.textContent).not.toContain('of 240');
    expect(button('Next')).toBeUndefined();
  });
});
