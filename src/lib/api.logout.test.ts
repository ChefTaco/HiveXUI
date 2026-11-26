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
