// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { button, click, mount, stubBrowser, type Mounted } from '../modules/magnus/test-dom';

const { watch, reload } = vi.hoisted(() => ({ watch: vi.fn(), reload: vi.fn() }));
vi.mock('../lib/version-watch', () => ({ watchVersion: watch }));
vi.mock('../lib/chunk-reload', () => ({ reloadConsole: reload }));
const { UpdateBanner } = await import('./update-banner');

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  watch.mockReset();
  reload.mockReset();
});

describe('the new-version notice', () => {
  it('appears for a newer build and reloads on request', async () => {
    stubBrowser();
    let report: ((version: { version?: string; entry: string }) => void) | undefined;
    watch.mockImplementation(({ onUpdate }) => {
      report = onUpdate;
      return () => {};
    });
    view = await mount(<UpdateBanner />);
    expect(document.querySelector('.update-banner')).toBeNull();
    await act(async () => report!({ version: '0.13.0', entry: '/assets/index-New456.js' }));
    expect(document.querySelector('[role="status"].update-banner')?.textContent).toContain('HiveXUI 0.13.0 is available');
    await click(button('Reload'));
    expect(reload).toHaveBeenCalledTimes(1);
    await click(button('Later'));
    expect(document.querySelector('.update-banner')).toBeNull();
  });
});
