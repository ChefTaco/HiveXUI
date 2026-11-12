// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProfile, Workspace } from '../../../contracts/hivemem.generated';
import { button, click, dialog, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import WorkspacesModule from './index';

const { memoryApi } = vi.hoisted(() => ({
  memoryApi: {
    workspaces: vi.fn<(offset: number, includeArchived: boolean) => Promise<Workspace[]>>(),
    workspace: vi.fn<(id: string) => Promise<Workspace>>(),
    archive: vi.fn<(id: string) => Promise<void>>(),
  },
}));
vi.mock('../../lib/memory-api', () => ({ memoryApi }));

const admin: MemoryProfile = { agent_id: 'fixture-admin', display_name: 'Fixture admin', role: 'admin', scopes: ['admin:all'], workspace_ids: null };
const reader: MemoryProfile = { ...admin, role: 'agent', scopes: [] };

function workspace(id: string, deletedAt: string | null = null): Workspace {
  return {
    workspace_id: id,
    title: `Workspace ${id}`,
    description: null,
    owner_agent_id: 'fixture-admin',
    members: [],
    metadata: {},
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    deleted_at: deletedAt,
    policy: {
      agent_overrides: {},
      allowed_scopes: [],
      consolidation_cadence_seconds: null,
      reasoning_provider: null,
      retention_days: null,
      sanitization: { deny_regexes: [], detect_pii: null, detect_secrets: null, mode: null },
      session_overrides: {},
      webhooks_enabled: false,
    },
  };
}

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  memoryApi.workspaces.mockResolvedValue([workspace('alpha'), workspace('beta')]);
  memoryApi.workspace.mockImplementation(async (id) => workspace(id));
  memoryApi.archive.mockResolvedValue(undefined);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.clearAllMocks();
});

describe('Workspaces', () => {
  it('lists the permitted workspaces under its page header', async () => {
    view = await mount(<WorkspacesModule profile={admin} />);
    await settle();
    expect(document.querySelector('.page-head h2')?.textContent).toBe('Workspaces');
    expect(button(/Workspace alpha/)).toBeDefined();
    expect(button(/Workspace beta/)).toBeDefined();
    expect(memoryApi.workspaces).toHaveBeenCalledWith(0, false);
  });

  it('shows loading lines until the list arrives, then an empty state', async () => {
    let answer: (value: Workspace[]) => void = () => undefined;
    memoryApi.workspaces.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    view = await mount(<WorkspacesModule profile={admin} />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    answer([]);
    await settle();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector('.empty-state')?.textContent).toContain('No workspaces');
  });

  it('archives a workspace only after confirmation', async () => {
    view = await mount(<WorkspacesModule profile={admin} />);
    await settle();
    await click(button(/Workspace alpha/));
    await settle();
    await click(button('Archive workspace'));
    expect(dialog()?.textContent).toContain('Archive workspace?');
    await click(button('Cancel', dialog()!));
    expect(memoryApi.archive).not.toHaveBeenCalled();

    await click(button('Archive workspace'));
    await click(button('Archive workspace', dialog()!));
    await settle();
    expect(memoryApi.archive).toHaveBeenCalledWith('alpha');
    expect(dialog()).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Workspace archived.');
  });

  it('explains when the token cannot read workspaces', async () => {
    view = await mount(<WorkspacesModule profile={reader} />);
    expect(document.body.textContent).toContain('Workspace access unavailable');
    expect(memoryApi.workspaces).not.toHaveBeenCalled();
  });
});
