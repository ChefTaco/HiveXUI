import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { clearAccess, rememberAccess, setStepUpProvider } from '../../../../../../lib/transport';
import { createTerminalGateway } from './gateway';
import { gatewayRefusal, mockGateway } from './mock-gateway';
import { inputBytes, MAX_INPUT_BYTES, RENEW_INTERVAL_MS, createTerminalSession, takeInputChunk, type TerminalView } from './session';

const TOKEN = 'resource-token-fixture';

function setup() {
  const gateway = mockGateway();
  const views: TerminalView[] = [];
  const written: Uint8Array[] = [];
  const session = createTerminalSession({
    gateway: createTerminalGateway(gateway.request),
    nodeId: 'node-1',
    sink: { write: async (bytes) => { written.push(bytes); } },
    onView: (view) => views.push(view),
  });
  return { gateway, session, views, written, view: () => views.at(-1)!, text: () => new TextDecoder().decode(Buffer.concat(written)) };
}
const settle = () => vi.advanceTimersByTimeAsync(1);

beforeEach(() => {
  vi.useFakeTimers();
  rememberAccess('magnus', TOKEN, Date.now() + 15 * 60 * 1000);
});
afterEach(() => {
  setStepUpProvider(undefined);
  clearAccess();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening', () => {
  it('sends only the node and the size, with the token in a header and never in a URL', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 100, rows: 30 });
    await settle();
    const [open] = gateway.of('open');
    expect(open).toMatchObject({ method: 'POST', body: { nodeId: 'node-1', cols: 100, rows: 30 }, authorization: `Bearer ${TOKEN}` });
    expect(open!.url).toBe('/api/magnus/terminal/open');
    expect(view().phase).toBe('live');
    const stream = gateway.of('stream')[0]!;
    expect(stream.url).toBe('/api/magnus/terminal/stream?sessionId=session-1');
    for (const call of gateway.calls) expect(call.url).not.toContain(TOKEN);
    session.dispose();
  });
  it('clamps a size to what the gateway accepts', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 9000, rows: 0 });
    expect(gateway.of('open')[0]!.body).toMatchObject({ cols: 500, rows: 1 });
    session.dispose();
  });
  it('after step-up asks the person to open again, and replays nothing', async () => {
    const { gateway, session, view } = setup();
    const stepUp = vi.fn(async () => undefined);
    setStepUpProvider(stepUp);
    gateway.state.override = (call) => (call.verb === 'open' && gateway.of('open').length === 1 ? gatewayRefusal(403, 'STEP_UP_REQUIRED') : null);
    await session.open({ cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(gateway.of('open')).toHaveLength(1);
    expect(view()).toMatchObject({ phase: 'refused', canOpenAgain: true, notice: { title: 'Identity verified' } });
    await session.open({ cols: 80, rows: 24 });
    await settle();
    expect(gateway.of('open')).toHaveLength(2);
    expect(view().phase).toBe('live');
    session.dispose();
  });
  it('reports a cancelled verification and opens nothing', async () => {
    const { gateway, session, view } = setup();
    setStepUpProvider(async () => { throw new Error('Identity verification cancelled'); });
    gateway.state.override = (call) => (call.verb === 'open' ? gatewayRefusal(403, 'STEP_UP_REQUIRED') : null);
    await session.open({ cols: 80, rows: 24 });
    expect(view()).toMatchObject({ phase: 'refused', canOpenAgain: true, notice: { message: 'Identity verification cancelled' } });
    expect(gateway.of('open')).toHaveLength(1);
  });
  it.each(['HOST_KEY_UNTRUSTED', 'HOST_KEY_CHANGED', 'NODE_TARGET_CHANGED', 'RESOURCE_ADMISSION_REFUSED'])('shows %s as an operator action, not a retry', async (code) => {
    const { gateway, session, view } = setup();
    gateway.state.override = (call) => (call.verb === 'open' ? gatewayRefusal(409, code, 'Gateway text') : null);
    await session.open({ cols: 80, rows: 24 });
    expect(view()).toMatchObject({ phase: 'refused', canOpenAgain: false });
    expect(view().notice?.message).not.toBe('Gateway text');
    expect(gateway.of('stream')).toHaveLength(0);
  });
  it('offers to try again after a passing failure', async () => {
    const { gateway, session, view } = setup();
    gateway.state.override = (call) => (call.verb === 'open' ? gatewayRefusal(502, 'SSH_CONNECT_FAILED') : null);
    await session.open({ cols: 80, rows: 24 });
    expect(view()).toMatchObject({ phase: 'refused', canOpenAgain: true, notice: { title: 'SSH connection failed' } });
  });
  it('closes a shell that opened after the panel had gone, so it holds no slot', async () => {
    const { gateway, session } = setup();
    let answer: (response: Response) => void = () => {};
    gateway.state.override = (call) => (call.verb === 'open' ? new Promise<Response>((resolve) => { answer = resolve; }) : null);
    const opening = session.open({ cols: 80, rows: 24 });
    await settle();
    session.dispose();
    answer(Response.json({ sessionId: 'late', nodeId: 'node-1', openedAt: 'a', expiresAt: 'b', idleTimeoutSeconds: 900, maxLifetimeSeconds: 3600 }, { status: 201 }));
    await opening;
    await settle();
    expect(gateway.of('close').map((call) => call.body)).toEqual([{ sessionId: 'late' }]);
    expect(gateway.of('stream')).toHaveLength(0);
  });
});

describe('renewal', () => {
  it('renews each minute with a current token, and stops when closed', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS * 3 + 1);
    expect(gateway.of('renew')).toHaveLength(3);
    expect(gateway.of('renew')[0]).toMatchObject({ body: { sessionId: 'session-1' }, authorization: `Bearer ${TOKEN}` });
    rememberAccess('magnus', 'newer-token', Date.now() + 15 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS);
    expect(gateway.of('renew').at(-1)!.authorization).toBe('Bearer newer-token');
    session.dispose();
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS * 3);
    expect(gateway.of('renew')).toHaveLength(4);
  });
  it('a failed renewal over the network does not end a healthy session', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    gateway.state.override = (call) => (call.verb === 'renew' ? Promise.reject(new TypeError('network')) : null);
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS + 1);
    expect(view().phase).toBe('live');
    session.dispose();
  });
  it('a refused renewal means the session is over, and status says why', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.override = (call) => (call.verb === 'renew' ? gatewayRefusal(404, 'SESSION_NOT_FOUND') : null);
    gateway.state.status = { state: 'ended', reason: 'token-revoked' };
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS + 1);
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Sign-in revoked' } });
  });
});

describe('input', () => {
  it('batches keystrokes into one request', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    session.send('l');
    session.send('s');
    session.send('\r');
    await vi.advanceTimersByTimeAsync(20);
    expect(gateway.of('input').map((call) => call.body!.data)).toEqual(['ls\r']);
    session.dispose();
  });
  it('chunks a paste to 16 KiB of UTF-8, in order, one request at a time, whole characters only', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    let inFlight = 0;
    let most = 0;
    gateway.state.override = (call) => {
      if (call.verb !== 'input') return null;
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((resolve) => setTimeout(() => { inFlight -= 1; resolve(Response.json({ ok: true })); }, 5));
    };
    const paste = `${'a'.repeat(MAX_INPUT_BYTES - 1)}${'€'.repeat(9000)}${'😀'.repeat(5000)}`;
    session.send(paste);
    await vi.advanceTimersByTimeAsync(1000);
    const chunks = gateway.of('input').map((call) => String(call.body!.data));
    expect(chunks.length).toBeGreaterThan(3);
    expect(most).toBe(1);
    expect(chunks.join('')).toBe(paste);
    for (const chunk of chunks) {
      expect(inputBytes(chunk)).toBeLessThanOrEqual(MAX_INPUT_BYTES);
      expect(chunk).not.toContain('�');
      expect(new TextDecoder().decode(new TextEncoder().encode(chunk))).toBe(chunk);
    }
    session.dispose();
  });
  it('takes a whole text when it fits', () => {
    expect(takeInputChunk('short')).toBe('short');
    expect(inputBytes(takeInputChunk('é'.repeat(MAX_INPUT_BYTES)))).toBe(MAX_INPUT_BYTES);
    expect(takeInputChunk('😀😀', 5)).toBe('😀');
  });
  it('retries only the chunk the gateway called busy', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    gateway.state.override = (call) => (call.verb === 'input' && gateway.of('input').length < 3 ? gatewayRefusal(429, 'INPUT_BUSY') : null);
    session.send('x'.repeat(MAX_INPUT_BYTES + 5));
    await vi.advanceTimersByTimeAsync(2000);
    const chunks = gateway.of('input').map((call) => String(call.body!.data).length);
    expect(chunks).toEqual([MAX_INPUT_BYTES, MAX_INPUT_BYTES, MAX_INPUT_BYTES, 5]);
    session.dispose();
  });
  it('never repeats input lost to anything else, and says so', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    gateway.state.override = (call) => (call.verb === 'input' ? Promise.reject(new TypeError('network')) : null);
    session.send('rm -rf build\r');
    await vi.advanceTimersByTimeAsync(5000);
    expect(gateway.of('input')).toHaveLength(1);
    expect(view().notice?.title).toBe('Input may be lost');
    session.dispose();
  });
  it('drops input it cannot deliver after a long stall, and says so', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    gateway.state.override = (call) => (call.verb === 'input' ? gatewayRefusal(429, 'INPUT_BUSY') : null);
    session.send('stuck');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(view().notice?.title).toBe('Input not accepted');
    const count = gateway.of('input').length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(gateway.of('input')).toHaveLength(count);
    session.dispose();
  });
  it('a refused input ends on the reason from status', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.override = (call) => (call.verb === 'input' ? gatewayRefusal(404, 'SESSION_NOT_FOUND') : null);
    gateway.state.status = { state: 'ended', reason: 'max-lifetime' };
    session.send('x');
    await vi.advanceTimersByTimeAsync(30);
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Time limit reached' } });
  });
  it('sends nothing after the session has ended', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.status = { state: 'ended', reason: 'remote-ended' };
    gateway.endStream();
    await settle();
    session.send('late');
    await vi.advanceTimersByTimeAsync(100);
    expect(gateway.of('input')).toHaveLength(0);
  });
});

describe('resizing', () => {
  it('sends a real change, once, and only while open', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    session.resize({ cols: 80, rows: 24 });
    session.resize({ cols: 120, rows: 40 });
    session.resize({ cols: 120, rows: 40 });
    await settle();
    expect(gateway.of('resize').map((call) => call.body)).toEqual([{ sessionId: 'session-1', cols: 120, rows: 40 }]);
    session.dispose();
  });
  it('catches up with a resize made while opening', async () => {
    const { gateway, session } = setup();
    const opening = session.open({ cols: 80, rows: 24 });
    session.resize({ cols: 100, rows: 30 });
    await opening;
    await settle();
    expect(gateway.of('resize').map((call) => call.body)).toEqual([{ sessionId: 'session-1', cols: 100, rows: 30 }]);
    session.dispose();
  });
});

describe('output', () => {
  it('hands the sink the node\'s bytes untouched', async () => {
    const { gateway, session, written, text } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.emit('<img src=x onerror=alert(1)>\x1b]0;title\x07');
    await settle();
    expect(written[0]).toBeInstanceOf(Uint8Array);
    expect(text()).toBe('<img src=x onerror=alert(1)>\x1b]0;title\x07');
    session.dispose();
  });
});

describe('how a session ends', () => {
  it.each([
    ['token-revoked', 'Sign-in revoked'],
    ['token-expired', 'Sign-in expired'],
    ['idle-timeout', 'Ended for inactivity'],
    ['max-lifetime', 'Time limit reached'],
    ['authority-lost', 'Permission removed'],
    ['remote-ended', 'Shell ended'],
    ['connection-lost', 'Connection lost'],
    ['detached', 'Disconnected too long'],
    ['gateway-shutdown', 'Gateway restarted'],
    ['audit-unavailable', 'Audit unavailable'],
    ['output-overflow', 'Too much output'],
    ['something-new', 'Session ended'],
  ])('a stream ending with %s says %s, and nothing more runs', async (reason, title) => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.status = { state: 'ended', reason };
    gateway.endStream();
    await settle();
    expect(view()).toMatchObject({ phase: 'ended', canOpenAgain: true, notice: { title } });
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS * 2);
    expect(gateway.of('renew')).toHaveLength(0);
    expect(gateway.of('stream')).toHaveLength(1);
    expect(gateway.of('close')).toHaveLength(0);
  });
  it('never shows the reason text itself', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.status = { state: 'ended', reason: '<img src=x onerror=alert(1)>' };
    gateway.endStream();
    await settle();
    expect(JSON.stringify(view().notice)).not.toContain('<img');
  });
  it('a dropped stream reconnects while the session lives, and the rest of its output arrives', async () => {
    const { gateway, session, view, text } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.emit('before ');
    await settle();
    gateway.dropStream();
    await vi.advanceTimersByTimeAsync(0);
    expect(view().phase).toBe('reconnecting');
    expect(gateway.of('status')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(gateway.of('stream')).toHaveLength(2);
    expect(view().phase).toBe('live');
    gateway.emit('after');
    await settle();
    expect(text()).toBe('before after');
    session.dispose();
  });
  it('gives up within the gateway\'s minute when it cannot be reached, and asks it to close', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.override = (call) => (call.verb === 'stream' || call.verb === 'status' ? Promise.reject(new TypeError('network')) : null);
    gateway.dropStream();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Connection lost' } });
    expect(gateway.of('close')).toHaveLength(1);
    const reads = gateway.of('stream').length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gateway.of('stream')).toHaveLength(reads);
  });
  it('a session the gateway no longer knows is reported as ended', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.override = (call) => (call.verb === 'status' ? gatewayRefusal(404, 'SESSION_NOT_FOUND') : null);
    gateway.endStream();
    await settle();
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Session ended' } });
  });
  it('a rejected token is reported, not retried forever', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.state.override = (call) => (call.verb === 'status' ? gatewayRefusal(401, 'UNAUTHORIZED') : null);
    gateway.endStream();
    await settle();
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Sign in again' } });
  });
});

describe('closing', () => {
  it('closes on unmount and stops reading', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    const signal = gateway.streams.at(-1)!.signal!;
    session.dispose();
    await settle();
    expect(gateway.of('close').map((call) => [call.body, call.authorization])).toEqual([[{ sessionId: 'session-1' }, `Bearer ${TOKEN}`]]);
    expect(signal.aborted).toBe(true);
    session.dispose();
    await settle();
    expect(gateway.of('close')).toHaveLength(1);
  });
  it('closes on logout with the token it holds, because the transport has already dropped its own', async () => {
    const { gateway, session, view } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    const signal = gateway.streams.at(-1)!.signal!;
    clearAccess();
    await settle();
    expect(gateway.of('close').map((call) => [call.body, call.authorization, call.credentials])).toEqual([[{ sessionId: 'session-1' }, `Bearer ${TOKEN}`, 'omit']]);
    expect(signal.aborted).toBe(true);
    expect(view()).toMatchObject({ phase: 'ended', notice: { title: 'Signed out' } });
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS * 2);
    expect(gateway.of('renew')).toHaveLength(0);
    session.dispose();
    await settle();
    expect(gateway.of('close')).toHaveLength(1);
  });
  it('closes a shell that opened during a logout', async () => {
    const { gateway, session } = setup();
    let answer: (response: Response) => void = () => {};
    gateway.state.override = (call) => (call.verb === 'open' ? new Promise<Response>((resolve) => { answer = resolve; }) : null);
    const opening = session.open({ cols: 80, rows: 24 });
    await settle();
    clearAccess();
    answer(Response.json({ sessionId: 'late', nodeId: 'node-1', openedAt: 'a', expiresAt: 'b', idleTimeoutSeconds: 900, maxLifetimeSeconds: 3600 }, { status: 201 }));
    await opening;
    await settle();
    expect(gateway.of('close').map((call) => [call.body, call.authorization])).toEqual([[{ sessionId: 'late' }, `Bearer ${TOKEN}`]]);
    expect(gateway.of('stream')).toHaveLength(0);
  });
  it('closes with what it holds when the page goes away', async () => {
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    gateway.calls.length = 0;
    session.leave();
    expect(gateway.of('close')).toHaveLength(1);
    session.dispose();
    await settle();
    expect(gateway.of('close')).toHaveLength(1);
  });
});

describe('secrecy', () => {
  it('logs neither input nor output', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const { gateway, session } = setup();
    await session.open({ cols: 80, rows: 24 });
    await settle();
    session.send('hunter2-typed\r');
    gateway.emit('hunter2-printed');
    await vi.advanceTimersByTimeAsync(30);
    gateway.state.override = (call) => (call.verb === 'input' ? gatewayRefusal(400, 'INVALID_REQUEST') : null);
    session.send('hunter2-refused');
    await vi.advanceTimersByTimeAsync(30);
    gateway.state.status = { state: 'ended', reason: 'remote-ended' };
    gateway.endStream();
    await settle();
    for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
  });
  it('the source has no HTML sink and no logging on this path, and only the panel imports xterm', () => {
    const directory = new URL('./', import.meta.url);
    const sources = readdirSync(directory).filter((name) => /\.tsx?$/.test(name) && !/\.test\.|mock-gateway/.test(name));
    expect(sources).toEqual(expect.arrayContaining(['gateway.ts', 'messages.ts', 'session.ts', 'terminal-panel.tsx']));
    for (const name of sources) {
      const source = readFileSync(new URL(name, directory), 'utf8');
      expect(source, name).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\bconsole\.(log|info|warn|error|debug)\b|localStorage|sessionStorage/);
      if (name !== 'terminal-panel.tsx') expect(source, name).not.toMatch(/from '@xterm/);
    }
    const panel = readFileSync(new URL('terminal-panel.tsx', directory), 'utf8');
    expect(panel.match(/from '@xterm\/[^']+'/g)?.sort()).toEqual(["from '@xterm/addon-fit'", "from '@xterm/xterm'"]);
    expect(readFileSync(new URL('../page.tsx', directory), 'utf8')).toMatch(/lazy\(\(\) => import\('\.\/terminal\/terminal-panel'\)\)/);
    expect(readFileSync(new URL('../page.tsx', directory), 'utf8')).not.toMatch(/from '\.\/terminal\//);
  });
});
