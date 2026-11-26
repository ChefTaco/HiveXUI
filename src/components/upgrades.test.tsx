// @vitest-environment jsdom
// Upgrades run on the installation controller. The console's own upgrade, with its password
// confirmation through Emberpath, is retired: the panel never asks for a password.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../modules/magnus/test-dom';
import { UpgradesPanel } from './upgrades';

let view: Mounted | undefined;
const request = vi.fn(async () => new Response('Not found', { status: 404 }));
beforeEach(() => {
  stubBrowser();
  request.mockClear();
  vi.stubGlobal('fetch', request);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

describe('the upgrades panel', () => {
  it('shows the controller commands and never asks for a password or calls a product', async () => {
    view = await mount(<UpgradesPanel canUpgrade />);
    await settle(10);
    expect(document.body.textContent).toContain('Hive lifecycle');
    await click(button('Upgrade'));
    await settle(10);
    expect(document.body.textContent).toContain('./hive.sh upgrade --config installation.json --release VERSION');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
