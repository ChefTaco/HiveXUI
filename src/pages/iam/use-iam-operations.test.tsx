// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from '../../modules/magnus/test-dom';
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
