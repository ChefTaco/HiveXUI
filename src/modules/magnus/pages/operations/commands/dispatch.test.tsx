// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { button, click, mount, stubBrowser, type } from '../../../test-dom';
import CommandsPage from './page';
const post = vi.hoisted(() => vi.fn(async () => ({ data: { commands: [] } })));
vi.mock('../../../api/client', () => ({ magnus: { post }, idempotencyKey: () => 'fixture', segment: encodeURIComponent }));
vi.mock('./node-multi-select', () => ({ NodeMultiSelect: ({ onChange }: { onChange: (ids: string[]) => void }) => <button onClick={() => onChange(['node-1'])}>Choose node</button> }));
describe('command confirmation', () => {
  it('dispatches the timeout approved in the dialog even if the underlying form changes', async () => {
    stubBrowser(); const mounted = await mount(<CommandsPage />);
    try {
      await click(button('Choose node')); await type(mounted.container.querySelector('textarea'), '/usr/bin/uptime');
      await click(button('Execute on 1 node', mounted.container));
      const confirm = document.querySelector('[role="alertdialog"]')!;
      expect(confirm.textContent).toContain('Timeout: 60 seconds');
      await type(mounted.container.querySelector('input[type="number"]'), '300');
      await click(button('Execute on 1 node', confirm));
      expect(post).toHaveBeenCalledWith('/commands', expect.anything(), expect.objectContaining({ body: expect.objectContaining({
        command: '/usr/bin/uptime', timeoutSeconds: 60, nodeIds: ['node-1'] }) }));
    } finally { await mounted.unmount(); }
  });
});
