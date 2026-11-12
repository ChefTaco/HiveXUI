// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProfile, Session } from '../../../contracts/hivemem.generated';
import { button, click, dialog, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import MemoryOperationsModule from './index';

const { api } = vi.hoisted(() => ({
  api: {
    sessions: vi.fn<(workspace: string) => Promise<Session[]>>(),
    session: vi.fn<(id: string) => Promise<Session>>(),
    deleteSession: vi.fn<(id: string) => Promise<void>>(),
    webhooks: vi.fn(async () => []),
    deliveries: vi.fn(async () => ({ results: [] })),
  },
}));
vi.mock('../../lib/memory-operations-api', () => ({ memoryOperations: api }));

const profile: MemoryProfile = { agent_id: 'fixture-agent', display_name: 'Fixture agent', role: 'agent', scopes: ['sessions:read', 'sessions:write'], workspace_ids: null };
const session: Session = { session_id: 'fixture-session', title: 'Planning notes', scope: 'private', owner_agent_id: 'fixture-agent', workspace_id: 'default', metadata: {}, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', deleted_at: null };

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  history.replaceState(null, '', '/?page=memories');
  api.sessions.mockResolvedValue([session]);
  api.session.mockResolvedValue(session);
  api.deleteSession.mockResolvedValue(undefined);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.clearAllMocks();
});

describe('Memory operations', () => {
  it('lists the sessions of the operation workspace', async () => {
    view = await mount(<MemoryOperationsModule profile={profile} />);
    await settle();
    expect(document.querySelector('[aria-label="Memory operation areas"]')).not.toBeNull();
    expect(api.sessions).toHaveBeenCalledWith('default');
    expect(button(/Planning notes/)).toBeDefined();
  });

  it('shows an empty state for a workspace with no sessions', async () => {
    api.sessions.mockResolvedValue([]);
    view = await mount(<MemoryOperationsModule profile={profile} />);
    await settle();
    expect(document.querySelector('.empty-state')?.textContent).toContain('No sessions in this workspace.');
  });

  it('says which permission is missing instead of loading', async () => {
    view = await mount(<MemoryOperationsModule profile={{ ...profile, scopes: [] }} />);
    await settle();
    expect(document.body.textContent).toContain('does not permit sessions:read');
    expect(api.sessions).not.toHaveBeenCalled();
  });

  it('archives a session only after confirmation', async () => {
    view = await mount(<MemoryOperationsModule profile={profile} />);
    await settle();
    await click(button(/Planning notes/));
    await settle();
    await click(button('Archive session'));
    expect(dialog()?.textContent).toContain('Its underlying memories remain stored.');
    await click(button('Cancel', dialog()!));
    expect(api.deleteSession).not.toHaveBeenCalled();

    await click(button('Archive session'));
    await click(button('Archive session', dialog()!));
    await settle();
    expect(api.deleteSession).toHaveBeenCalledWith('fixture-session');
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain('Operation completed.');
  });
});
