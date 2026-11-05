import type {BrowserConsentDetails as ConsentDetails} from '../../contracts/oathweave-browser.generated';
export type {BrowserConsentDetails as ConsentDetails} from '../../contracts/oathweave-browser.generated';
export type IdentityPrompt =
  | {
      kind: 'consent';
      details: ConsentDetails;
      resolve: (approved: boolean) => void;
    }
  | { kind: 'step-up'; resolve: (value: StepUpInput | null) => void };
export interface StepUpInput {
  password: string;
  totpCode?: string;
  passkey?: boolean;
}
let listener: ((prompt: IdentityPrompt | null) => void) | undefined;
const queue: IdentityPrompt[] = [];
function enqueue(prompt: IdentityPrompt): void {
  if (!listener)
    throw new Error('Identity verification is unavailable; reload the console');
  queue.push(prompt);
  if (queue.length === 1) listener(prompt);
}
function finish(prompt: IdentityPrompt, done: () => void): void {
  const index = queue.indexOf(prompt);
  if (index < 0) return;
  queue.splice(index, 1);
  done();
  if (index === 0) listener?.(queue[0] ?? null);
}
export function cancelIdentityPrompts(): void {
  for (const prompt of [...queue]) {
    if (prompt.kind === 'consent') prompt.resolve(false);
    else prompt.resolve(null);
  }
}
export function subscribeIdentityPrompts(
  handler: (prompt: IdentityPrompt | null) => void,
): () => void {
  listener = handler;
  handler(queue[0] ?? null);
  return () => {
    if (listener === handler) {
      cancelIdentityPrompts();
      listener = undefined;
    }
  };
}
export function requestConsent(details: ConsentDetails): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const prompt: IdentityPrompt = {
      kind: 'consent',
      details,
      resolve: (value) => finish(prompt, () => resolve(value)),
    };
    try {
      enqueue(prompt);
    } catch (error) {
      reject(error);
    }
  });
}
export function requestStepUp(): Promise<StepUpInput | null> {
  return new Promise((resolve, reject) => {
    const prompt: IdentityPrompt = {
      kind: 'step-up',
      resolve: (value) => finish(prompt, () => resolve(value)),
    };
    try {
      enqueue(prompt);
    } catch (error) {
      reject(error);
    }
  });
}
