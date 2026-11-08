import { describe, expect, it } from 'vitest';
import { createRateGate, createReadCooldown, retryAfterMs } from './rate-gate';

function clock() {
  let now = 0;
  const waits: number[] = [];
  return { now: () => now, sleep: async (ms: number) => { waits.push(ms); now += ms; }, waits };
}

describe('the per-subject rate limits', () => {
  it('never lets /hermes/* past 20 requests in any minute', async () => {
    const time = clock();
    const pass = createRateGate(time.now, time.sleep);
    const at: number[] = [];
    await Promise.all(Array.from({ length: 50 }, async () => {
      await pass('/hermes/installations');
      at.push(time.now());
    }));
    expect(at).toHaveLength(50);
    expect(time.waits.length).toBeGreaterThan(0);
    const worst = Math.max(...at.map((start) => at.filter((value) => value >= start && value < start + 60_000).length));
    expect(worst).toBeLessThanOrEqual(20);
  });
  it('never lets /orchestra/* past 30, on its own budget', async () => {
    const time = clock();
    const pass = createRateGate(time.now, time.sleep);
    for (let index = 0; index < 18; index += 1) await pass('/hermes/x');
    for (let index = 0; index < 27; index += 1) await pass('/orchestra/x');
    expect(time.waits).toEqual([]);
    await pass('/orchestra/x');
    expect(time.waits).toHaveLength(1);
  });
  it('leaves other paths alone', async () => {
    const time = clock();
    const pass = createRateGate(time.now, time.sleep);
    for (let index = 0; index < 200; index += 1) await pass('/nodes');
    expect(time.waits).toEqual([]);
  });
  it('stops waiting when the caller aborts', async () => {
    const pass = createRateGate();
    for (let index = 0; index < 18; index += 1) await pass('/hermes/x');
    const controller = new AbortController();
    const waiting = pass('/hermes/x', controller.signal);
    controller.abort(new Error('left the page'));
    await expect(waiting).rejects.toThrow('left the page');
  });
});

describe('waiting out a 429 on reads', () => {
  it('reads Retry-After as seconds or a date, with a default and a cap', () => {
    const now = () => Date.parse('2026-11-08T10:00:00Z');
    expect(retryAfterMs('17', now)).toBe(17_000);
    expect(retryAfterMs('Sun, 08 Nov 2026 10:00:09 GMT', now)).toBe(9_000);
    expect(retryAfterMs(null, now)).toBe(5_000);
    expect(retryAfterMs('soon', now)).toBe(5_000);
    expect(retryAfterMs('0', now)).toBe(1_000);
    expect(retryAfterMs('3600', now)).toBe(60_000);
  });

  it('holds every Ardent read until the cooldown ends, and nothing else', async () => {
    const time = clock();
    const cooldown = createReadCooldown(time.now, time.sleep);
    await cooldown.wait('/ardent/profiles');
    expect(time.waits).toEqual([]);
    cooldown.hold('/ardent/installations/node-1/profiles/lead/skills', 12_000);
    cooldown.hold('/ardent/profiles', 4_000);
    cooldown.hold('/hermes/installations', 30_000);
    await cooldown.wait('/hermes/installations');
    expect(time.waits).toEqual([]);
    await cooldown.wait('/ardent/installations/node-1/profiles/lead/config');
    expect(time.waits).toEqual([12_000]);
    await cooldown.wait('/ardent/profiles');
    expect(time.waits).toEqual([12_000]);
    expect(cooldown.applies('/ardent/profiles')).toBe(true);
    expect(cooldown.applies('/nodes')).toBe(false);
  });
});
