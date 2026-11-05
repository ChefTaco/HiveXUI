// @vitest-environment jsdom
// Viewing a page must never run anything on a host, and an action that does must ask first. These
// mount the real pages over a stubbed fetch, so they exercise the real effects, timers and clicks.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../lib/transport';
import { magnus } from './api/client';
import { CodexInstallationCard } from './pages/agents/codex/installation-card';
import AgentsCodexPage from './pages/agents/codex/page';
import { MaintenancePanel } from './pages/fleet/application-operations/maintenance-panel';
import NodeDetailPage from './pages/fleet/node-detail/page';
import { AgentUpgradeDrawer } from './pages/fleet/nodes/agent-upgrade';
import { AssignRoleDrawer } from './pages/fleet/nodes/node-actions';
import CommandsPage from './pages/operations/commands/page';
import { destructiveWarning } from './pages/operations/commands/quick-actions';
import CronPage from './pages/operations/cron/page';
import FilesPage from './pages/operations/files/page';
import GovernorPage from './pages/operations/governor-operations/page';
import { DeployDrawer } from './pages/provisioning/library/drawers';
import InstalledSkillsPage from './pages/provisioning/skills/page';
import { sessionStore } from './session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type, type RecordedRequest } from './test-dom';

const AT = '2026-11-05T12:00:00.000Z';
const node = (id: string, name: string) => ({
  id, name, hostname: `${id}.example.com`, ipAddress: '192.0.2.10', port: 4100, status: 'ONLINE', os: 'linux', arch: 'x64', tags: '[]', metadata: '{}', roleId: null,
  lastHeartbeatAt: AT, createdAt: AT, updatedAt: AT, role: null, upgradeReadiness: null,
  agent: { id: `agent-${id}`, nodeId: id, version: '1.1.1', status: 'RUNNING', pid: 1, startedAt: AT, lastCheckIn: AT, capabilities: '{}' },
});
const NODES = [node('node-1', 'node one'), node('node-2', 'node two')];
const JOB = {
  id: 'job-1', nodeId: 'node-1', name: '[AI] Log Analyzer', description: '', schedule: '0 * * * *', command: 'run-skill', args: '[]', workingDirectory: null, timeoutSeconds: 60, status: 'ACTIVE',
  lastRunAt: null, lastRunExitCode: null, nextRunAt: null, createdBy: 'alice', createdAt: AT, updatedAt: AT, environmentKeys: [], node: { name: 'node one' },
};
const LISTING = 'CWD:/opt/app\ntotal 4\n-rw-r--r-- 1 deploy deploy 8 2026-02-13 10:30 app.conf\n';
const quickResult = (stdout: string) => ({ success: true, data: { commandId: 'command-1', exitCode: 0, stdout, stderr: '', durationMs: 5, truncated: false, signature: 'a'.repeat(64) } });

function route({ method, path, body }: RecordedRequest, role: string): unknown {
  if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '1.1.1', magnusVersion: '1.1.1', securityConsoleUrl: null } } };
  if (method === 'GET' && path === '/nodes/node-1') return { success: true, data: NODES[0] };
  if (method === 'GET' && path.startsWith('/nodes?')) return { success: true, data: NODES, meta: { total: 2, page: 1, pageSize: 100, hasMore: false } };
  if (method === 'GET' && path === '/cron') return { success: true, data: [JOB] };
  if (method === 'GET' && path === '/skills') return { success: true, data: [] };
  if (method === 'DELETE' && path === '/cron/job-1') return { success: true, data: { deleted: true } };
  if (method === 'POST' && path === '/commands') return { success: true, data: { commands: [{ id: 'command-1', nodeId: 'node-1', status: 'QUEUED' }] } };
  if (method === 'GET' && path.startsWith('/files/read')) return { success: true, data: { nodeId: 'node-1', filePath: '/opt/app/app.conf', content: 'contents', checksum: 'x', sizeBytes: 8, modifiedAt: AT } };
  if (method === 'POST' && path === '/files/update') {
    if (body?.previewOnly) return { success: true, data: { previewOnly: true, filePath: '/opt/app/app.conf', policy: 'safe-app-path', targetCount: 1, backupPlanned: true, contentBytes: 8, nodeIds: ['node-1'] } };
    return { success: true, data: [{ id: 'task', nodeId: 'node-1', filePath: '/opt/app/app.conf', direction: 'push', content: null, checksum: 'x', previousChecksum: null, status: 'completed', error: null, createdBy: 'alice', createdAt: AT, completedAt: AT }] };
  }
  if (method === 'POST' && path.startsWith('/quick-command/')) return quickResult(String(body?.command).startsWith('cd ') ? LISTING : 'node v24.0.0\n');
  if (method === 'POST' && path === '/scan/cron') return { success: true, data: [] };
  if (method === 'POST' && path === '/scan/skills') return { success: true, data: [] };
  return undefined;
}
async function start(role = 'ADMIN') {
  const stub = stubApi((request) => route(request, role));
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  return stub;
}
const textarea = () => document.querySelector('textarea');
const checkbox = (name: string) => [...document.querySelectorAll('label')].find((label) => label.textContent?.includes(name))?.querySelector('input');

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearAccess();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('viewing a page dispatches nothing', () => {
  it.each(['ADMIN', 'OPERATOR', 'VIEWER'])('node detail, as %s, past the old dwell and the old hourly refresh', async (role) => {
    const stub = await start(role);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const mounted = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
    await settle(10, vi.advanceTimersByTimeAsync);
    expect(stub.of('/nodes/node-1').length).toBeGreaterThan(0);
    await settle(6000, vi.advanceTimersByTimeAsync);
    await settle(2 * 60 * 60 * 1000, vi.advanceTimersByTimeAsync);
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('the cron and installed skills pages, until someone scans', async () => {
    for (const [Page, path] of [[CronPage, '/scan/cron'], [InstalledSkillsPage, '/scan/skills']] as const) {
      const stub = await start();
      const mounted = await mount(<Page />);
      await settle(5);
      expect(stub.mutations()).toEqual([]);
      expect(document.body.textContent).toContain('Not scanned yet');
      await click(button('Scan nodes', mounted.container.querySelector('.page-header') ?? mounted.container));
      await settle(5);
      expect(stub.mutations().map((request) => request.path)).toEqual([path]);
      await mounted.unmount();
      sessionStore.reset();
    }
  });
  it('a scan offered to no one who could not run it', async () => {
    await start('VIEWER');
    const mounted = await mount(<InstalledSkillsPage />);
    await settle(5);
    expect(button('Scan nodes')).toBeUndefined();
    await mounted.unmount();
  });
  it('no page loads with a POST of its own: scans and probes stay behind a click', async () => {
    const stub = await start();
    for (const Page of [CommandsPage, FilesPage, GovernorPage, AgentsCodexPage]) {
      const mounted = await mount(<Page />);
      await settle(5);
      await mounted.unmount();
    }
    expect(stub.mutations()).toEqual([]);
  });
});

describe('checking versions on node detail', () => {
  it('runs one probe on a click, and shows when it was checked', async () => {
    const stub = await start();
    const mounted = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
    await settle(5);
    expect(document.body.textContent).toContain('Not checked yet. Checking runs a command on the node.');
    await click(button('Check versions'));
    await settle(5);
    expect(stub.mutations().map((request) => request.path)).toEqual(['/quick-command/node-1/exec']);
    expect(document.body.textContent).toContain('Last checked:');
    await mounted.unmount();
  });
  it('coming back shows the last answer without asking the node again', async () => {
    const stub = await start();
    const first = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
    await settle(5);
    await click(button('Check versions'));
    await settle(5);
    await first.unmount();
    const count = stub.mutations().length;
    const second = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
    await settle(5);
    expect(document.body.textContent).toContain('Last checked:');
    expect(stub.mutations()).toHaveLength(count);
    await second.unmount();
  });
  it('checks apt updates only on its own button', async () => {
    const stub = await start();
    const mounted = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
    await settle(5);
    await click(button('Check for updates'));
    await settle(5);
    expect(stub.mutations()).toHaveLength(1);
    expect(String(stub.mutations()[0]!.body!.command)).toContain('apt');
    await mounted.unmount();
  });
});

describe('Execute on the Commands page', () => {
  async function page() {
    const stub = await start();
    const mounted = await mount(<CommandsPage />);
    await settle(5);
    return { stub, mounted };
  }
  const execute = () => button(/^Execute on /, document.querySelector('.page-stack')!);

  it('asks first, naming the node count and showing the command, and sends nothing until confirmed', async () => {
    const { stub, mounted } = await page();
    await click(checkbox('node one'));
    await click(checkbox('node two'));
    await type(textarea(), 'uname -a');
    await click(execute());
    expect(stub.mutations()).toEqual([]);
    expect(dialog()?.textContent).toContain('2 nodes will run this command');
    expect(dialog()?.textContent).toContain('uname -a');
    await click(button('Execute on 2 nodes', dialog()!));
    await settle(5);
    expect(dialog()).toBeNull();
    const sent = stub.mutations();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ path: '/commands', body: { nodeIds: ['node-1', 'node-2'], command: 'uname -a' } });
    await mounted.unmount();
  });
  it('sends nothing when cancelled', async () => {
    const { stub, mounted } = await page();
    await click(checkbox('node one'));
    await type(textarea(), 'uname -a');
    await click(execute());
    expect(dialog()?.textContent).toContain('1 node will run');
    await click(button('Cancel', dialog()!));
    await settle(5);
    expect(dialog()).toBeNull();
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('keeps a dry run immediate', async () => {
    const { stub, mounted } = await page();
    await click(checkbox('node one'));
    await type(textarea(), 'uname -a');
    await click(button('Dry run'));
    await settle(5);
    expect(dialog()).toBeNull();
    expect(stub.mutations()[0]).toMatchObject({ path: '/commands', body: { dryRun: true } });
    await mounted.unmount();
  });
  it.each([['Reboot', 'sudo reboot', 'offline'], ['Dist-Upgrade', 'dist-upgrade', 'kernel']])('the %s quick action only fills the box, and warns when executed', async (label, command, warning) => {
    const { stub, mounted } = await page();
    await click(checkbox('node one'));
    await click(button(new RegExp(`^${label}$`), document.querySelector('.page-stack')!));
    await settle(5);
    expect(dialog()).toBeNull();
    expect(stub.mutations()).toEqual([]);
    expect(textarea()?.value).toContain(command);
    await click(execute());
    expect(stub.mutations()).toEqual([]);
    expect(dialog()?.textContent).toContain(command);
    expect(dialog()?.textContent).toContain(warning);
    expect(dialog()?.textContent).toContain('destructive');
    await mounted.unmount();
  });
  it('recognizes a destructive command typed by hand', () => {
    for (const command of ['reboot', 'sudo shutdown -h now', 'sudo apt full-upgrade', 'rm -rf /opt/x', 'dd if=/dev/zero of=/dev/sda', 'init 6']) expect(destructiveWarning(command), command).not.toBeNull();
    for (const command of ['df -h', 'uptime', 'grep reboots.log', 'sudo apt upgrade -y', 'ls -la', 'firmware-update']) expect(destructiveWarning(command), command).toBeNull();
  });
  it('shows the command as text', async () => {
    const { mounted } = await page();
    await click(checkbox('node one'));
    await type(textarea(), '<img src=x onerror=alert(1)>');
    await click(execute());
    expect(dialog()?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    await mounted.unmount();
  });
});

describe('File Push', () => {
  async function ready() {
    const stub = await start();
    const mounted = await mount(<FilesPage />);
    await settle(5);
    const select = document.querySelector('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'node-1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Choosing a file in the browser is what names a path. The listing and the read are the operator's clicks.
    await click(document.querySelector('button[title="Browse files on the node"]'));
    await settle(5);
    await click(button('app.conf'));
    await settle(5);
    return { stub, mounted };
  }
  const writes = (stub: Awaited<ReturnType<typeof start>>) => stub.requests.filter((request) => request.path === '/files/update');

  it('asks first, naming the path and the node, and pushes once when confirmed', async () => {
    const { stub, mounted } = await ready();
    await click(button('Push to Node'));
    expect(writes(stub)).toEqual([]);
    expect(dialog()?.textContent).toContain('/opt/app/app.conf');
    expect(dialog()?.textContent).toContain('node one');
    expect(dialog()?.textContent).toContain('backup');
    await click(button('Push to node', dialog()!));
    await settle(5);
    expect(writes(stub).map((request) => request.body)).toMatchObject([{ nodeIds: ['node-1'], filePath: '/opt/app/app.conf', content: 'contents', backup: true }]);
    await mounted.unmount();
  });
  it('sends nothing when cancelled, and warns when there is no backup', async () => {
    const { stub, mounted } = await ready();
    await click(document.querySelector('[role="switch"], input[type="checkbox"]'));
    await click(button('Push to Node'));
    expect(dialog()?.textContent).toContain('No backup is made');
    await click(button('Cancel', dialog()!));
    await settle(5);
    expect(writes(stub)).toEqual([]);
    await mounted.unmount();
  });
  it('keeps a preview immediate', async () => {
    const { stub, mounted } = await ready();
    await click(button('Preview'));
    await settle(5);
    expect(dialog()).toBeNull();
    expect(writes(stub).map((request) => request.body?.previewOnly)).toEqual([true]);
    await mounted.unmount();
  });
});

describe('skill-job delete', () => {
  it('asks first, and deletes only once confirmed', async () => {
    const stub = await start();
    const mounted = await mount(<GovernorPage />);
    await settle(5);
    await click(button('Delete Log Analyzer'));
    expect(stub.mutations()).toEqual([]);
    expect(dialog()?.textContent).toContain('Log Analyzer');
    expect(dialog()?.textContent).toContain('node one');
    await click(button('Cancel', dialog()!));
    expect(stub.mutations()).toEqual([]);
    await click(button('Delete Log Analyzer'));
    await click(button('Delete', dialog()!));
    await settle(5);
    expect(stub.mutations().map((request) => [request.method, request.path])).toEqual([['DELETE', '/cron/job-1']]);
    await mounted.unmount();
  });
});

describe('other actions that change a host ask first', () => {
  const post = () => vi.spyOn(magnus, 'post').mockResolvedValue({ success: true, data: [] } as never);
  const row = { ...NODES[0]!, role: { id: 'role-1', name: 'web' }, roleId: 'role-1' };

  it('deploying a library file names the node count, and overwrites nothing until confirmed', async () => {
    await start();
    const sent = post();
    const mounted = await mount(<DeployDrawer file={{ id: 'file-1', name: 'motd', mimeType: 'text/plain' }} onClose={() => {}} />);
    await settle(5);
    await click(checkbox('node one'));
    await click(button('Deploy to 1 node'));
    expect(sent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('1 node');
    expect(dialog()?.textContent).toContain('overwritten');
    expect(document.querySelector('.drawer')).toBeNull();
    await click(button('Cancel', dialog()!));
    expect(sent).not.toHaveBeenCalled();
    expect(document.querySelector('.drawer')).not.toBeNull();
    await click(button('Deploy to 1 node'));
    await click(button('Deploy to 1 node', dialog()!));
    await settle(5);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toBe('/library/deploy');
    await mounted.unmount();
  });
  it('unassigning or changing a role on a node', async () => {
    await start();
    vi.spyOn(magnus, 'get').mockResolvedValue({ success: true, data: [{ id: 'role-1', name: 'web' }, { id: 'role-2', name: 'db' }] } as never);
    const sent = post();
    const mounted = await mount(<AssignRoleDrawer node={row as never} onClose={() => {}} onSaved={() => {}} />);
    await settle(5);
    await click(button('Unassign role'));
    expect(sent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('removes the current role');
    await click(button('Cancel', dialog()!));
    const select = document.querySelector('.drawer select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'role-2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Change role'));
    expect(sent).not.toHaveBeenCalled();
    await click(button('Change role', dialog()!));
    await settle(5);
    expect(sent.mock.calls.map((call) => call[0])).toEqual(['/roles/role-1/unassign', '/roles/role-2/assign']);
    await mounted.unmount();
  });
  it('starting an agent upgrade', async () => {
    await start();
    const candidate = { nodeId: 'node-1', name: 'node one', version: '1.0.0', eligible: true, reason: null, code: null, upgrade: null, layout: 'versioned', managed: true };
    vi.spyOn(magnus, 'get').mockResolvedValue({ success: true, data: { version: '1.1.1', serverVersion: '1.1.1', upgradesEnabled: true, disabledReason: null, prerelease: false, release: { verified: true }, nodes: [candidate], latestRun: null } } as never);
    const sent = post();
    const mounted = await mount(<AgentUpgradeDrawer open onClose={() => {}} />);
    await settle(5);
    await click(button('Upgrade 1 agent'));
    expect(sent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('1.1.1');
    await click(button('Cancel', dialog()!));
    expect(sent).not.toHaveBeenCalled();
    await mounted.unmount();
  });
  it('logging Codex out on a node', async () => {
    await start();
    const sent = post();
    const installation = { nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', nodeStatus: 'ONLINE', lastHeartbeatAt: AT, reachable: true, installed: true, user: 'deploy', version: '1.0.0', latestVersion: '1.1.0', updateAvailable: true, provenance: 'npm', updateSupported: true, auth: { status: 'ok', mode: 'chatgpt', oauth: true, tokenExpiresAt: null, tokenExpired: false, refreshTokenPresent: true, lastRefreshAt: null, planType: null, autoLoggedOut: false, message: '' } };
    const mounted = await mount(<CodexInstallationCard installation={installation as never} onChange={() => {}} />);
    await settle(5);
    await click(button('Log out'));
    expect(sent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('node one');
    await click(button('Log out', dialog()!));
    await settle(5);
    expect(sent.mock.calls.map((call) => call[0])).toEqual(['/codex/installations/node-1/logout']);
    await mounted.unmount();
  });
  it('cancelling a maintenance window', async () => {
    await start();
    const sent = post();
    const window = { id: 'window-1', reason: 'patching', nodeIds: '["node-1"]', serviceIds: '[]', actorId: 'alice', startsAt: AT, endsAt: '2099-01-01T00:00:00.000Z', cancelledAt: null, createdBy: 'alice', createdAt: AT };
    const resource = { data: { success: true, data: [window] }, error: undefined, loading: false, refreshing: false, refresh: async () => {}, setData: () => {} };
    const mounted = await mount(<MaintenancePanel resource={resource as never} nodes={[]} canWrite />);
    await settle(5);
    await click(button('Cancel window'));
    expect(sent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('patching');
    await click(button('Cancel window', dialog()!));
    await settle(5);
    expect(sent.mock.calls.map((call) => call[0])).toEqual(['/ops/maintenance/window-1/cancel']);
    await mounted.unmount();
  });
});
