// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { clearAccess, rememberAccess } from '../../../../../../lib/transport';
import { button, click, mount, settle, stubBrowser } from '../../../../test-dom';
import { createTerminalGateway } from './gateway';
import { mockGateway, gatewayRefusal } from './mock-gateway';
import TerminalPanel from './terminal-panel';

const xterm = vi.hoisted(() => ({ instances: [] as Array<Record<string, unknown> & { written: Uint8Array[]; handlers: Record<string, (value: unknown) => void>; options: Record<string, unknown>; disposed: boolean; keys?: (event: unknown) => boolean }> }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    written: Uint8Array[] = [];
    handlers: Record<string, (value: unknown) => void> = {};
    disposed = false;
    cols = 80;
    rows = 24;
    keys?: (event: unknown) => boolean;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      xterm.instances.push(this as never);
    }
    loadAddon() {}
    open() {}
    focus() {}
    dispose() { this.disposed = true; }
    write(bytes: Uint8Array, done?: () => void) { this.written.push(bytes); done?.(); }
    attachCustomKeyEventHandler(handler: (event: unknown) => boolean) { this.keys = handler; }
    onData(handler: (value: unknown) => void) { this.handlers.data = handler; return { dispose() {} }; }
    onBinary(handler: (value: unknown) => void) { this.handlers.binary = handler; return { dispose() {} }; }
    onResize(handler: (value: unknown) => void) { this.handlers.resize = handler; return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

const HOSTILE = '<img src=x onerror="window.pwned=1">';
const latest = () => xterm.instances.at(-1)!;

async function panel(gateway = mockGateway(), name = 'node one') {
  const onClose = vi.fn();
  const createGateway = () => createTerminalGateway(gateway.request);
  const mounted = await mount(<TerminalPanel nodeId="node-1" nodeName={name} onClose={onClose} createGateway={createGateway} />);
  await settle(5);
  return { gateway, onClose, mounted };
}

beforeEach(() => {
  stubBrowser();
  xterm.instances.length = 0;
  rememberAccess('magnus', 'resource-token-fixture', Date.now() + 15 * 60 * 1000);
});
afterEach(() => {
  clearAccess();
  document.body.innerHTML = '';
});

describe('the terminal panel', () => {
  it('opens at once for the node it was given, and writes the node\'s output to xterm as bytes', async () => {
    const { gateway, mounted } = await panel();
    expect(gateway.of('open')[0]!.body).toEqual({ nodeId: 'node-1', cols: 80, rows: 24 });
    await act(async () => { gateway.emit(HOSTILE); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(new TextDecoder().decode(latest().written[0])).toBe(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toContain('onerror');
    await mounted.unmount();
  });
  it('turns off what lets a node reach out of the terminal', async () => {
    const { mounted } = await panel();
    const options = latest().options as { allowProposedApi: boolean; linkHandler: { activate: () => void; allowNonHttpProtocols: boolean }; windowOptions?: unknown };
    expect(options.allowProposedApi).toBe(false);
    expect(options.linkHandler.allowNonHttpProtocols).toBe(false);
    const opened = vi.spyOn(window, 'open');
    const asked = vi.spyOn(window, 'confirm');
    options.linkHandler.activate();
    expect(opened).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
    expect(options.windowOptions).toBeUndefined();
    await mounted.unmount();
  });
  it('renders a hostile node name and a hostile refusal as text', async () => {
    const gateway = mockGateway();
    gateway.state.override = (call) => (call.verb === 'open' ? gatewayRefusal(400, 'SOMETHING_NEW', HOSTILE) : null);
    const { mounted } = await panel(gateway, HOSTILE);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toContain(HOSTILE);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(HOSTILE);
    await mounted.unmount();
  });
  it('sends what is typed, and forwards only ASCII mouse reports', async () => {
    const { gateway, mounted } = await panel();
    latest().handlers.data!('ls\r');
    latest().handlers.binary!('\x1b[M !!');
    latest().handlers.binary!('\x1b[M\xff!!');
    await settle(40);
    expect(gateway.of('input').map((call) => call.body!.data)).toEqual(['ls\r\x1b[M !!']);
    await mounted.unmount();
  });
  it('closes the session when it unmounts, and disposes xterm', async () => {
    const { gateway, mounted } = await panel();
    await mounted.unmount();
    await settle(5);
    expect(gateway.of('close').map((call) => call.body)).toEqual([{ sessionId: 'session-1' }]);
    expect(latest().disposed).toBe(true);
  });
  it('closes when the page goes away', async () => {
    const { gateway, mounted } = await panel();
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    await settle(5);
    expect(gateway.of('close')).toHaveLength(1);
    await mounted.unmount();
    await settle(5);
    expect(gateway.of('close')).toHaveLength(1);
  });
  it('says why it ended, stops taking input, and can start a new session', async () => {
    const { gateway, mounted } = await panel();
    gateway.state.status = { state: 'ended', reason: 'idle-timeout' };
    await act(async () => { gateway.endStream(); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Ended for inactivity');
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('Ended');
    expect(latest().options.disableStdin).toBe(true);
    await click(button('Open terminal again'));
    await settle(5);
    expect(gateway.of('open')).toHaveLength(2);
    expect(xterm.instances).toHaveLength(2);
    expect(xterm.instances[0]!.disposed).toBe(true);
    await mounted.unmount();
  });
  it('offers no retry for a changed host key', async () => {
    const gateway = mockGateway();
    gateway.state.override = (call) => (call.verb === 'open' ? gatewayRefusal(409, 'HOST_KEY_CHANGED') : null);
    const { mounted } = await panel(gateway);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('can mean an attack');
    expect(button('Open terminal again')).toBeUndefined();
    await mounted.unmount();
  });
  it('leaves Escape to the shell, and closes only from its button', async () => {
    const { onClose, mounted } = await panel();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await click(document.querySelector('.modal-center'));
    expect(onClose).not.toHaveBeenCalled();
    await click(button('Close terminal'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });
  it('has a keyboard way out of the terminal', async () => {
    const { mounted } = await panel();
    const taken = latest().keys!({ type: 'keydown', altKey: true, shiftKey: true, code: 'KeyQ' });
    expect(taken).toBe(false);
    expect(document.activeElement).toBe(button('Close terminal'));
    expect(latest().keys!({ type: 'keydown', altKey: false, shiftKey: false, code: 'Tab' })).toBe(true);
    await mounted.unmount();
  });
});
