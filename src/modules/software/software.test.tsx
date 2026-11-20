// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
import { HiveApiError } from '../../lib/api-error';
import { INVENTORY_PATH, readInventory } from './api';
import SoftwareScreen, { SoftwarePage, type SoftwareSources } from './index';
import { IMAGES, fleet, inventory3129, nativeMagnus } from './test-fixtures';

const text = () => document.body.textContent ?? '';
const sources = (overrides: Partial<SoftwareSources> = {}): SoftwareSources => ({
  inventory: vi.fn(async () => inventory3129()),
  magnus: vi.fn(async () => nativeMagnus()),
  agents: vi.fn(async () => fleet(18)),
  ...overrides,
});

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('the Installed software page', () => {
  it('is for administrators only', async () => {
    view = await mount(<SoftwareScreen currentUser={{ id: 'u2', username: 'bob', roles: ['OPERATOR'], permissions: [] }} />);
    expect(text()).toContain('Only administrators see what the hosts run.');
  });

  it('says it is not available without suite sign-in and a Registry that announces the inventory', async () => {
    view = await mount(<SoftwareScreen currentUser={{ id: 'u1', username: 'alice', roles: ['SUITE_ADMIN'], permissions: [] }} />);
    await settle();
    expect(text()).toContain('Installed software is not available here');
  });

  it('shows the 3.12.9 case: every image matches, but native Magnus resolved effect 3.20.0', async () => {
    view = await mount(<SoftwarePage sources={sources()} />);
    await settle();
    expect(text()).toContain('3.12.9');
    expect(text()).toContain('227d003449ae500d6dbf5e20c2b7139c6a1af92a0e642c3a84a01a0093bd9824');
    expect(text()).toContain('1 difference');
    expect(text()).toContain('npm package (native install)');
    expect(text()).toContain('npm resolved one package differently from the lock the signed build used');
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('node_modules/@prisma/config/node_modules/effect'));
    expect(row?.textContent).toContain('3.22.1');
    expect(row?.textContent).toContain('3.20.0');
    expect(text()).toContain('18 of 18 nodes run the pinned agent 3.1.5.');
  });

  it('reports matching when the native install follows the signed lock', async () => {
    view = await mount(<SoftwarePage sources={sources({ magnus: vi.fn(async () => nativeMagnus([])) })} />);
    await settle();
    expect(text()).toContain('Matches the signed release');
    expect(text()).not.toContain('npm resolved');
  });

  it('shows a digest difference with both digests', async () => {
    view = await mount(<SoftwarePage sources={sources({ inventory: vi.fn(async () => inventory3129({ emberpathImage: IMAGES.emberpath3127 })), magnus: null, agents: null })} />);
    await settle();
    expect(text()).toContain('control runs sha256:d57842aa8209, not the pinned sha256:9b1667a50a37.');
    expect(text()).not.toContain('Server and host agents');
  });

  it('keeps the inventory when Magnus is older and has no report, and reads again on request', async () => {
    const magnus = vi.fn(async () => { throw new HiveApiError(404, 'Not found'); });
    const inventory = vi.fn(async () => inventory3129());
    view = await mount(<SoftwarePage sources={sources({ inventory, magnus })} />);
    await settle();
    expect(text()).toContain('This Magnus does not report its installation.');
    expect(text()).toContain('Oathweave');
    await click(button('Read again'));
    await settle();
    expect(inventory).toHaveBeenCalledTimes(2);
  });

  it('says when the inventory cannot be read', async () => {
    view = await mount(<SoftwarePage sources={sources({ inventory: vi.fn(async () => { throw new HiveApiError(403, 'Your Oathweave role does not include the Hive Registry inventory.'); }) })} />);
    await settle();
    expect(text()).toContain('The installed software inventory could not be read');
    expect(text()).toContain('Your Oathweave role does not include the Hive Registry inventory.');
  });
});

describe('reading the inventory', () => {
  it('asks the Registry through the signed-in fetch and validates the answer', async () => {
    const request = vi.fn(async () => Response.json(inventory3129()));
    await expect(readInventory(undefined, request)).resolves.toMatchObject({ release: { version: '3.12.9' } });
    expect(request).toHaveBeenCalledWith(INVENTORY_PATH, expect.anything());
  });
  it('never shows a refusal message the Registry wrote', async () => {
    const request = vi.fn(async () => Response.json({ error: { code: 'forbidden', message: '<b>injected</b>' } }, { status: 403 }));
    await expect(readInventory(undefined, request)).rejects.toMatchObject({ status: 403, message: 'Your Oathweave role does not include the Hive Registry inventory.' });
  });
  it('explains an older Registry, and refuses an answer it cannot read', async () => {
    await expect(readInventory(undefined, vi.fn(async () => new Response('', { status: 404 })))).rejects.toMatchObject({ status: 404 });
    await expect(readInventory(undefined, vi.fn(async () => Response.json({ schema: 2 })))).rejects.toMatchObject({ status: 502 });
  });
});
