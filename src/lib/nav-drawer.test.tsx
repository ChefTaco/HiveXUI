// @vitest-environment jsdom
import { useCallback, useRef, useState } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import { useNavigationDrawer } from './nav-drawer';

function Drawer() {
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useNavigationDrawer(open, close, drawer, toggle);
  return (
    <>
      <aside ref={drawer} data-open={open}>
        <nav>
          <button type="button">First</button>
          <button type="button">Second</button>
        </nav>
        <button type="button">Sign out</button>
      </aside>
      <main>
        <button ref={toggle} type="button" onClick={() => setOpen((value) => !value)}>Toggle</button>
        <button type="button">Behind</button>
      </main>
    </>
  );
}

const press = async (key: string, shiftKey = false) => {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    // What the browser does when the hook lets Tab through: leave the drawer.
    if (key === 'Tab' && !event.defaultPrevented) button('Behind')!.focus();
  });
};

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  // jsdom lays nothing out; every button counts as visible.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the mobile navigation drawer', () => {
  it('moves focus in, keeps Tab inside it, and returns focus to the toggle on Escape', async () => {
    view = await mount(<Drawer />);
    await click(button('Toggle'));
    expect(document.activeElement?.textContent).toBe('First');
    button('Sign out')!.focus();
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('First');
    await press('Tab', true);
    expect(document.activeElement?.textContent).toBe('Sign out');
    await press('Escape');
    expect(document.querySelector('aside')!.dataset.open).toBe('false');
    expect(document.activeElement?.textContent).toBe('Toggle');
    // Closed, Tab is the browser's again.
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('Behind');
  });
});
