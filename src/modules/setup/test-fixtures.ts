// Made-up setup checklist answers for the Setup page's tests. Tests only.
import type { RegistrySetupItem } from '../../lib/registry';

export const setupItem = (id: string, extra: Partial<RegistrySetupItem> = {}): RegistrySetupItem => ({
  id,
  title: `Step ${id}`,
  status: 'pending',
  command: `./hive.sh setup done ${id}`,
  docs: 'deployment/FULL.md#setup-checklist',
  ...extra,
});

export const AGENT_ITEM = setupItem('magnus-agent-enrolled', {
  title: 'Install the Magnus agent on the Magnus host',
  command: './hive.sh magnus-agent install',
  docs: 'deployment/FULL.md#installing-the-agent',
  product: 'magnus',
  check: 'magnus.agent',
});
export const CLIENTS_ITEM = setupItem('oathweave-console-clients', {
  title: 'Add the HiveXUI browser clients to Oathweave',
  command: './hive.sh console-clients add',
  docs: 'deployment/QUICKSTART.md#8-upgrade',
  product: 'oathweave',
  check: 'oathweave.console-client',
});
export const ADMIN_ITEM = setupItem('first-admin', {
  title: 'Create your own administrator account and stop using the initial operator',
  docs: 'deployment/QUICKSTART.md#6-sign-in',
  product: 'oathweave',
  check: 'iam.first-admin',
});
export const ARDENT_ITEM = setupItem('ardent-packages-updated', {
  title: 'Update the Ardent packages in HiveXUI (Magnus > Ardent > Installations)',
  docs: 'deployment/QUICKSTART.md#8-upgrade',
  product: 'magnus',
});
export const CERTIFICATE_ITEM = setupItem('certificate-renewal', {
  title: 'Schedule the HTTPS certificate renewal',
  command: 'sudo ./scripts/console-certificate.sh schedule --config FILE',
  docs: 'deployment/QUICKSTART.md#9-keep-the-certificate-current',
  product: 'ingress',
  status: 'skipped',
});

const T0 = '2026-11-01T09:00:00.000Z';
export const node = (name: string, status: string, agent: string | null) => ({
  id: name, name, hostname: `${name}.example.internal`, ipAddress: '192.0.2.10', port: 4000, status, os: 'linux', arch: 'x64',
  tags: '[]', metadata: '{}', roleId: null, lastHeartbeatAt: T0, createdAt: T0, updatedAt: T0,
  agent: agent ? { id: `agent-${name}`, nodeId: name, version: '2.2.0', status: agent, pid: 10, startedAt: T0, lastCheckIn: T0, capabilities: '{}' } : null,
  role: null, upgradeReadiness: null, health: null,
});
export const nodeList = (...nodes: unknown[]) => ({ success: true, data: nodes, meta: { total: nodes.length, page: 1, pageSize: 100, hasMore: false } });
export const client = (id: string, active = true) => ({
  id, name: id, description: null, active, clientType: 'public', redirectUris: [], grantTypes: ['authorization_code'], firstParty: true, createdAt: T0,
});
export const iamUser = (id: string, username: string, createdAt: string, roles: string[], active = true) => ({
  id, email: `${username}@example.com`, username, displayName: null, active, lastLoginAt: null, createdAt,
  roles: roles.map((name) => ({ role: { name } })),
});
