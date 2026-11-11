// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, stubBrowser, type } from '../../../test-dom';
import CommandsPage from './page';
const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
beforeEach(() => { post.mockReset().mockResolvedValue({ data: { commands: [] } }); get.mockReset(); });
vi.mock('../../../api/client', () => ({ magnus: { post, get }, idempotencyKey: () => 'fixture', segment: encodeURIComponent }));
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


describe('command result status', () => {
  it.each(['COMPLETED', 'FAILED', 'TIMEOUT', 'RUNNING'])('reads the canonical %s status with the result', async (status) => {
    stubBrowser();
    post.mockResolvedValueOnce({ data: { commands: [{ id: 'command-1', nodeId: 'node-1', status: 'QUEUED' }] } });
    const result = status === 'RUNNING' ? null : { id: 'result-1', commandId: 'command-1', exitCode: status === 'COMPLETED' ? 0 : 1, stdout: 'fixture output', stderr: '', durationMs: 100, truncated: false };
    get.mockResolvedValue({ data: { id: 'command-1', status, result } });
    const mounted = await mount(<CommandsPage />);
    try {
      await click(button('Choose node')); await type(mounted.container.querySelector('textarea'), '/usr/bin/uptime');
      await click(button('Execute on 1 node', mounted.container));
      await click(button('Execute on 1 node', document.querySelector('[role="alertdialog"]')!));
      expect(mounted.container.textContent).not.toContain('QUEUED');
      expect(mounted.container.textContent).toContain(status);
      await click(button('View result', mounted.container));
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('/commands/command-1', expect.anything());
      expect(mounted.container.textContent).not.toContain('QUEUED');
      expect(mounted.container.textContent).toContain(status);
      expect(mounted.container.querySelector('[role="status"]')?.textContent).toContain(result ? 'fixture output' : 'RUNNING: waiting for result…');
      expect(post).toHaveBeenCalledTimes(1);
    } finally { await mounted.unmount(); }
  });
});


it('chooses the registered diagnostic budget and warns before a custom budget is dispatched', async () => {
  stubBrowser(); const mounted = await mount(<CommandsPage />);
  try {
    await type(mounted.container.querySelector('input[type="number"]'), '300');
    await click(button('Uptime & Load', mounted.container));
    expect(mounted.container.querySelector('textarea')?.value).toBe('/usr/bin/uptime');
    expect(mounted.container.querySelector('input[type="number"]')?.getAttribute('value')).toBe('60');
    await type(mounted.container.querySelector('input[type="number"]'), '30');
    expect(mounted.container.textContent).toContain('A custom budget requires outcome review.');
    expect(post).not.toHaveBeenCalled();
    await click(button('Uptime & Load', mounted.container));
    await click(button('Choose node'));
    await click(button('Execute on 1 node', mounted.container));
    await click(button('Execute on 1 node', document.querySelector('[role="alertdialog"]')!));
    expect(post).toHaveBeenCalledWith('/commands', expect.anything(), expect.objectContaining({ body: expect.objectContaining({ command: '/usr/bin/uptime', timeoutSeconds: 60 }) }));
    expect(post).toHaveBeenCalledTimes(1);
  } finally { await mounted.unmount(); }
});
