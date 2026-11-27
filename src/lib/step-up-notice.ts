/**
 * How a step-up (the identity check a product asks for before a sensitive change) ended, for the
 * screen that asked for it. A drawer or dialog that is open shows the outcome next to its own
 * actions, where the person submits again, and focus goes back to the action; a toast could sit over
 * those actions. With no drawer or dialog open, the page's own toast says it as before.
 */
export type StepUpOutcome = 'verified' | 'cancelled';

/** What the transport answers a refused change with once the person verified: it is never replayed. */
export const STEP_UP_VERIFIED_MESSAGE = 'Identity verified. Review and submit the operation again.';
/** The error a cancelled identity check ends the request with. */
export const STEP_UP_CANCELLED_MESSAGE = 'Identity verification was cancelled, so nothing was changed. Start the action again when you are ready.';
/** The title and message of the toast the identity prompt shows when the person cancels it. */
export const STEP_UP_CANCELLED_TITLE = 'Identity verification cancelled';
export const STEP_UP_CANCELLED_HINT = 'Nothing was changed. Start the action again when you are ready.';

/** The texts a toast repeating an outcome carries (an error toast adds its request ID after them). */
const REPEATS: Record<StepUpOutcome, readonly string[]> = {
  verified: [STEP_UP_VERIFIED_MESSAGE],
  cancelled: [STEP_UP_CANCELLED_TITLE, STEP_UP_CANCELLED_MESSAGE],
};
/** How long after an outcome shown in place a toast saying the same is dropped. */
const REPEAT_WINDOW_MS = 10_000;

type Handler = (outcome: StepUpOutcome) => void;
/** Open drawers and dialogs, in the order they opened: the last one is on top. */
const handlers: Handler[] = [];
const watchers = new Set<(outcome: StepUpOutcome) => void>();
let shown: { outcome: StepUpOutcome; until: number } | null = null;

/** An open drawer or dialog listens while it is open. Returns the function that stops listening. */
export function subscribeStepUpOutcome(handler: Handler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/**
 * Tell the topmost open drawer or dialog how a step-up ended. Returns true when one shows it; toasts
 * repeating it are then dropped (see `repeatsStepUpShownInPlace`).
 */
export function announceStepUpOutcome(outcome: StepUpOutcome): boolean {
  const handler = handlers.at(-1);
  if (!handler) return false;
  shown = { outcome, until: Date.now() + REPEAT_WINDOW_MS };
  handler(outcome);
  for (const watcher of watchers) watcher(outcome);
  return true;
}

/** Whether a toast's text repeats the step-up outcome an open drawer or dialog has just shown. */
export function repeatsStepUpShownInPlace(text: string): boolean {
  if (!shown || shown.until < Date.now()) return false;
  return REPEATS[shown.outcome].some((fragment) => text.includes(fragment));
}

/** The toast stack watches, to drop a toast that was already up when the outcome was shown. */
export function watchStepUpShownInPlace(watcher: (outcome: StepUpOutcome) => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/** Tests only: forget every listener and outcome. */
export function resetStepUpNotices(): void {
  handlers.length = 0;
  watchers.clear();
  shown = null;
}
