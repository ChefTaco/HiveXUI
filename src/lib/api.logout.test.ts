import { describe, expect, it, vi } from 'vitest';

const { order, identity } = vi.hoisted(() => {
  const order: string[] = [];
  return { order, identity: { logout: vi.fn(async () => { order.push('oathweave'); }) } };
});
vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  browserIdentity: () => identity,
  localSignIn: () => false,
}));
vi.mock('./transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./transport')>()),
  endChatSession: vi.fn(async () => { order.push('chattermost'); }),
}));
const { adminApi } = await import('./api');

describe('sign-out', () => {
  it('ends the chat session before the identity session forgets it', async () => {
    await adminApi.logout();
    expect(order).toEqual(['chattermost', 'oathweave']);
  });
});

describe('cross-tab sign-out', () => {
  it('tells the other tabs, even when the identity service fails to answer', async () => {
    const other = new BroadcastChannel('hivexui-session');
    const seen: unknown[] = [];
    other.onmessage = (event) => seen.push(event.data);
    identity.logout.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(adminApi.logout()).rejects.toThrow('Failed to fetch');
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'signed-out' }]));
    other.close();
    const { resetSessionEvents } = await import('./session-events');
    resetSessionEvents();
  });
});
