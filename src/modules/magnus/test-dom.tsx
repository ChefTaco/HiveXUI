// What a test needs to mount a page for real in jsdom: effects, timers and clicks, over a stubbed
// fetch. Tests only; nothing in the console imports it.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '../../components/toast';
import { RouteParams } from './navigation';

export interface RecordedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
export type Route = (request: RecordedRequest) => unknown;

/** Answers by route, and records every request with its logical path. Anything unrouted is a 404. */
export function stubApi(route: Route) {
  const requests: RecordedRequest[] = [];
  const headers = new WeakMap<RecordedRequest, Headers>();
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://console.example.com');
    const recorded: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.replace(/^\/api\/magnus/, '') + url.search,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null,
    };
    requests.push(recorded);
    headers.set(recorded, new Headers(init?.headers));
    const answer = route(recorded);
    if (answer instanceof Response) return answer;
    return answer === undefined ? Response.json({ error: { message: 'Not found' } }, { status: 404 }) : Response.json(answer);
  };
  return {
    request,
    requests,
    /** Everything sent that is not a plain read. */
    mutations: () => requests.filter((item) => item.method !== 'GET'),
    of: (path: string) => requests.filter((item) => item.path === path),
    /** The headers a recorded request was sent with. */
    headersOf: (recorded: RecordedRequest): Headers => headers.get(recorded) ?? new Headers(),
  };
}

/** Browser features jsdom lacks, which the pages touch as they mount. */
export function stubBrowser(): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as unknown as typeof window.matchMedia;
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

export interface Mounted {
  root: Root;
  container: HTMLElement;
  unmount: () => Promise<void>;
}
export async function mount(element: ReactNode, params: Record<string, string> = {}): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ToastProvider><RouteParams.Provider value={params}>{element}</RouteParams.Provider></ToastProvider>);
  });
  return {
    root,
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
/** Let requests and effects finish. With fake timers on, this also moves the clock. */
export const settle = async (ms = 0, advance?: (ms: number) => Promise<unknown>) => {
  await act(async () => {
    if (advance) await advance(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
export const click = async (element: Element | null | undefined) => {
  if (!element) throw new Error('Nothing to click');
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
/** Set a controlled input's value the way a person typing would. */
export const type = async (element: Element | null | undefined, value: string) => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('Nothing to type into');
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
export const button = (name: string | RegExp, within: ParentNode = document): HTMLButtonElement | undefined =>
  [...within.querySelectorAll('button')].find((item) => {
    const label = item.getAttribute('aria-label') ?? item.textContent ?? '';
    return typeof name === 'string' ? label.trim() === name : name.test(label);
  });
export const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
