// @vitest-environment jsdom
// At startup an identity outage is not a signed-out session: the console says so and offers Retry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from './modules/magnus/test-dom';
import { HiveApiError } from './lib/api-error';

const { me } = vi.hoisted(() => ({ me: vi.fn<() => Promise<never>>() }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, me } };
});

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  me.mockReset();
});

async function shown(text: string) {
  for (let i = 0; i < 100 && !document.body.textContent?.includes(text); i++) await settle(10);
  expect(document.body.textContent).toContain(text);
}

describe('console startup', () => {
  it('tells an unreachable identity service apart from a signed-out session', async () => {
    const { signInServiceUnreachable } = await import('./app');
    expect(signInServiceUnreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(signInServiceUnreachable(new HiveApiError(502, 'Oathweave could not be reached (HTTP 502). Try again in a moment.'))).toBe(true);
    expect(signInServiceUnreachable(new HiveApiError(401, 'Sign in to continue'))).toBe(false);
    expect(signInServiceUnreachable(new Error('Sign in to continue'))).toBe(false);
  });
  it('shows the outage with Retry instead of the sign-in form, and the form once the service answers', async () => {
    me.mockRejectedValueOnce(new HiveApiError(503, 'Oathweave could not be reached (HTTP 503). Try again in a moment.'));
    me.mockRejectedValueOnce(new HiveApiError(401, 'Sign in to continue'));
    const { App } = await import('./app');
    view = await mount(<App />);
    await shown('The identity service is unreachable');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('HTTP 503');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await click(button('Retry'));
    await shown('Control Plane Console');
    expect(me).toHaveBeenCalledTimes(2);
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
  it('still lets the operator reach the sign-in form during the outage', async () => {
    me.mockRejectedValue(new TypeError('Failed to fetch'));
    const { App } = await import('./app');
    view = await mount(<App />);
    await shown('The identity service is unreachable');
    await click(button('Show the sign-in form'));
    await shown('Control Plane Console');
    const username = document.querySelector<HTMLInputElement>('input[autocomplete="username"]');
    // No prefilled account name, and an empty form cannot be sent.
    expect(username?.value).toBe('');
    expect(username?.required).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.required).toBe(true);
  });
});
