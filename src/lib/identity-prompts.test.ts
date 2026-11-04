import { expect, it } from 'vitest';
import {
  requestConsent,
  requestStepUp,
  subscribeIdentityPrompts,
  cancelIdentityPrompts,
  type IdentityPrompt,
} from './identity-prompts';
const details = {
  clientName: 'Example',
  clientDescription: null,
  audience: 'example',
  scope: 'openid',
  permissions: ['example:read'],
};
it('queues separate approvals and cancels pending requests on sign-out or unmount', async () => {
  const shown: (IdentityPrompt | null)[] = [];
  const unsubscribe = subscribeIdentityPrompts((prompt) => shown.push(prompt));
  const consent = requestConsent(details),
    step = requestStepUp();
  const first = shown.at(-1);
  expect(first?.kind).toBe('consent');
  if (first?.kind === 'consent') first.resolve(true);
  expect(await consent).toBe(true);
  expect(shown.at(-1)?.kind).toBe('step-up');
  cancelIdentityPrompts();
  expect(await step).toBeNull();
  expect(shown.at(-1)).toBeNull();
  const cancelled = requestConsent(details);
  unsubscribe();
  expect(await cancelled).toBe(false);
  await expect(requestConsent(details)).rejects.toThrow('unavailable');
});
