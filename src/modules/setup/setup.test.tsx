// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import { SetupNudge } from '../../components/setup-nudge';
import { isAdministrator } from '../../lib/permissions';
import type { RegistrySetupItem, RegistryState } from '../../lib/registry';
import SetupScreen, { SetupPage } from './index';
import type { ProbeContext } from './probes';
import { ADMIN_ITEM, AGENT_ITEM, ARDENT_ITEM, CERTIFICATE_ITEM, CLIENTS_ITEM, client, iamUser, nodeList, setupItem } from './test-fixtures';

const ready = (items: RegistrySetupItem[] | null): RegistryState => ({
  status: 'ready',
  installationId: 'lab-one',
  installed: new Set(['oathweave', 'magnus']),
  setup: items ? { items, updatedAt: '2026-11-12T10:00:00Z' } : null,
});
const ADMIN = { id: 'u1', username: 'alice', roles: ['SUITE_ADMIN'], permissions: [] };
const OPERATOR = { id: 'u2', username: 'bob', roles: ['OPERATOR'], permissions: ['iam:users:read'] };

function probeContext(answers: Record<string, unknown> = {}): ProbeContext {
  return {
    fetch: vi.fn(async (path: string) => (path in answers ? Response.json(answers[path]) : Response.json({ error: 'not found' }, { status: 404 }))),
    installed: () => true,
    clients: ['hivexui-magnus'],
  };
}
const text = () => document.body.textContent ?? '';
const article = (title: string) => [...document.querySelectorAll('article')].find((item) => item.querySelector('h3')?.textContent === title)!;

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('the Setup page', () => {
  it('waits for the Registry, and asks it again when it opens', async () => {
    const refresh = vi.fn(async () => {});
    view = await mount(<SetupPage registry={{ status: 'pending' }} context={probeContext()} refresh={refresh} />);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Reading the Hive Registry…');
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('says when the Registry cannot be read', async () => {
    view = await mount(<SetupPage registry={{ status: 'unavailable', reason: 'unreachable' }} context={probeContext()} refresh={async () => {}} />);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('The Hive Registry is not answering');
  });
  it('says when the Registry records no checklist', async () => {
    view = await mount(<SetupPage registry={ready(null)} context={probeContext()} refresh={async () => {}} />);
    expect(text()).toContain('No setup checklist');
    expect(document.querySelector('ol')).toBeNull();
  });

  it('shows each item with its status, command and docs as text, pending first', async () => {
    const context = probeContext({ '/api/magnus/nodes?page=1&pageSize=100': nodeList() });
    view = await mount(<SetupPage registry={ready([CERTIFICATE_ITEM, { ...ARDENT_ITEM, status: 'done' }, AGENT_ITEM])} context={context} refresh={async () => {}} />);
    await settle();
    expect([...document.querySelectorAll('article h3')].map((heading) => heading.textContent)).toEqual([AGENT_ITEM.title, CERTIFICATE_ITEM.title, ARDENT_ITEM.title]);
    expect(text()).toContain('1 step pending');
    const agent = article(AGENT_ITEM.title);
    expect(agent.querySelector('.badge')?.textContent).toBe('Pending');
    expect(agent.querySelector('pre code')?.textContent).toBe('./hive.sh magnus-agent install');
    expect(agent.querySelector('.setup-docs')?.textContent).toBe('Docs: deployment/FULL.md#installing-the-agent');
    // No public docs base URL is configured, so a docs anchor is never a link.
    expect(document.querySelector('a')).toBeNull();
    expect(agent.textContent).toContain('Not done yet: Magnus has no enrolled node yet.');
    expect(article(CERTIFICATE_ITEM.title).querySelector('.badge')?.textContent).toBe('Skipped');
    expect(article(ARDENT_ITEM.title).querySelector('.badge')?.textContent).toBe('Done');
    // Settled items are not probed.
    expect(context.fetch).toHaveBeenCalledOnce();
  });

  it('says a pending item looks done, and how to record it', async () => {
    const context = probeContext({
      '/api/iam/clients': { clients: [client('hivexui-magnus')] },
      '/api/iam/users?limit=100': { users: [iamUser('u2', 'alice', '2026-11-02T00:00:00Z', ['SUITE_ADMIN']), iamUser('u1', 'admin', '2026-11-01T00:00:00Z', ['SUPER_ADMIN'])], total: 2, page: 1, limit: 100 },
    });
    view = await mount(<SetupPage registry={ready([CLIENTS_ITEM, ADMIN_ITEM])} context={context} refresh={async () => {}} />);
    await settle();
    const clients = article(CLIENTS_ITEM.title);
    expect(clients.querySelector('.badge')?.textContent).toBe('Looks done');
    expect(clients.querySelector('.setup-probe--done')?.textContent).toContain('Looks done — run ./hive.sh post-upgrade to record it.');
    const admin = article(ADMIN_ITEM.title);
    expect(admin.querySelector('.setup-probe--done')?.textContent).toContain('run ./hive.sh setup done first-admin to record it.');
    expect(admin.textContent).toContain('alice is an administrator besides the initial operator.');
  });

  it('says it is checking while a probe runs', async () => {
    const context: ProbeContext = { ...probeContext(), fetch: () => new Promise<Response>(() => {}) };
    view = await mount(<SetupPage registry={ready([ADMIN_ITEM])} context={context} refresh={async () => {}} />);
    expect(article(ADMIN_ITEM.title).querySelector('.setup-probe[role="status"]')?.textContent).toBe('Checking…');
    expect(article(ADMIN_ITEM.title).querySelector('.badge')?.textContent).toBe('Pending');
  });

  it('shows an item it does not know generically, and runs no unknown check', async () => {
    const future = setupItem('some-future-step', { title: 'A step from a newer controller', check: 'future.probe', product: 'future-product' });
    const context = probeContext();
    view = await mount(<SetupPage registry={ready([future])} context={context} refresh={async () => {}} />);
    await settle();
    const item = article('A step from a newer controller');
    expect(item.querySelector('.badge')?.textContent).toBe('Pending');
    expect(item.querySelector('.panel-eyebrow')?.textContent).toBe('future-product');
    expect(item.querySelector('pre code')?.textContent).toBe('./hive.sh setup done some-future-step');
    expect(item.querySelector('.setup-probe')).toBeNull();
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it('copies a command, and says to copy by hand when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    view = await mount(<SetupPage registry={ready([ARDENT_ITEM])} context={probeContext()} refresh={async () => {}} />);
    await click(button(/^Copy command: /));
    expect(writeText).toHaveBeenCalledWith('./hive.sh setup done ardent-packages-updated');
    expect(button(/^Copied command: /)).toBeDefined();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await click(button(/command: /));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('copy it by hand');
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    await click(button(/command: /));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('copy it by hand');
  });

  it('asks the Registry and every probe again on Refresh', async () => {
    const refresh = vi.fn(async () => {});
    const context = probeContext({ '/api/magnus/nodes?page=1&pageSize=100': nodeList() });
    view = await mount(<SetupPage registry={ready([AGENT_ITEM])} context={context} refresh={refresh} />);
    await settle();
    await click(button('Refresh'));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(context.fetch).toHaveBeenCalledTimes(2);
  });

  it('is for administrators only', async () => {
    view = await mount(<SetupScreen currentUser={OPERATOR} />);
    expect(text()).toContain('Only administrators see the setup checklist.');
    expect(document.querySelector('h2')).toBeNull();
  });
});

describe('the setup nudge', () => {
  it('knows who an administrator is', () => {
    expect(isAdministrator(ADMIN)).toBe(true);
    expect(isAdministrator({ id: 'x', username: 'x', roles: ['admin'] })).toBe(true);
    expect(isAdministrator({ id: 'x', username: 'x', permissions: ['*'] })).toBe(true);
    expect(isAdministrator(OPERATOR)).toBe(false);
    expect(isAdministrator(null)).toBe(false);
  });

  it('shows administrators the pending count, and opens the page', async () => {
    const registry = await import('../../lib/registry');
    vi.spyOn(registry, 'useRegistry').mockReturnValue(ready([AGENT_ITEM, ADMIN_ITEM, { ...ARDENT_ITEM, status: 'done' }]));
    const open = vi.fn();
    view = await mount(<SetupNudge user={ADMIN} onOpen={open} />);
    const nudge = button(/^Setup\s*2\s*steps pending$/);
    expect(nudge).toBeDefined();
    await click(nudge);
    expect(open).toHaveBeenCalledOnce();
    await view.unmount();
    view = await mount(<SetupNudge user={OPERATOR} onOpen={open} />);
    expect(document.querySelector('button')).toBeNull();
    vi.restoreAllMocks();
  });

  it('is hidden with nothing pending or no checklist', async () => {
    const registry = await import('../../lib/registry');
    for (const state of [ready([{ ...AGENT_ITEM, status: 'done' }]), ready(null), { status: 'unavailable', reason: 'empty' } as const]) {
      vi.spyOn(registry, 'useRegistry').mockReturnValue(state);
      view = await mount(<SetupNudge user={ADMIN} onOpen={() => {}} />);
      expect(document.querySelector('button')).toBeNull();
      await view.unmount();
      view = undefined;
    }
    vi.restoreAllMocks();
  });
});
