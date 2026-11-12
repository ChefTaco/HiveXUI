// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, stubBrowser, type Mounted } from '../magnus/test-dom';
import { AgentPageLink, agentPageHref } from './link';

const runtime = vi.hoisted(() => ({ installed: new Set<string>(['magnus']) }));
vi.mock('../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/runtime')>()),
  productInstalled: (product: string) => runtime.installed.has(product),
}));

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  runtime.installed = new Set(['magnus']);
  history.replaceState(null, '', '/fleet/nodes');
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  history.replaceState(null, '', '/');
});

describe('the Agent 360 link', () => {
  it('is built with linkTo for a well-formed reference only', () => {
    expect(agentPageHref('node-1~lead')).toBe('/agents/node-1~lead');
    expect(agentPageHref('node-1')).toBeNull();
    expect(agentPageHref(null)).toBeNull();
  });

  it('moves to the page without a reload', async () => {
    view = await mount(<AgentPageLink agentRef="node-1~lead" />);
    const link = view.container.querySelector('a');
    expect(link?.textContent).toBe('Agent 360');
    await click(link);
    expect(location.pathname).toBe('/agents/node-1~lead');
  });

  it('is left out for a malformed reference, or where no product the page reads is installed', async () => {
    view = await mount(<><AgentPageLink agentRef="no-separator" /><AgentPageLink agentRef={null} /></>);
    expect(view.container.querySelector('a')).toBeNull();
    await view.unmount();
    runtime.installed = new Set(['oathweave']);
    view = await mount(<AgentPageLink agentRef="node-1~lead" />);
    expect(view.container.querySelector('a')).toBeNull();
  });
});
