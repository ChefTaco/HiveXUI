import { describe, expect, it } from 'vitest';
import { createRateGate } from './rate-gate';

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
