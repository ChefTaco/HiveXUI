import { describe, expect, it } from 'vitest';
import { trackArrivals } from './sweep';

describe('trackArrivals', () => {
  it('marks nothing on the first answer, then only what is new', () => {
    const seen = new Set<string>();
    const fresh = new Set<string>();
    trackArrivals(seen, fresh, ['a', 'b']);
    expect([...fresh]).toEqual([]);
    trackArrivals(seen, fresh, ['c', 'a', 'b']);
    expect([...fresh]).toEqual(['c']);
    trackArrivals(seen, fresh, ['c', 'a']);
    expect([...fresh]).toEqual(['c']);
  });
  it('waits for a list that was empty at first', () => {
    const seen = new Set<string>();
    const fresh = new Set<string>();
    trackArrivals(seen, fresh, []);
    trackArrivals(seen, fresh, ['a']);
    expect([...fresh]).toEqual([]);
    trackArrivals(seen, fresh, ['a', 'b']);
    expect([...fresh]).toEqual(['b']);
  });
});
