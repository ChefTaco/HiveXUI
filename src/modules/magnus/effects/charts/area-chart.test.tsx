// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type Mounted } from '../../test-dom';
import AreaChart, { axisTicks } from './area-chart';

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
});

const rows = [
  { t: 1, cpu: 10, mem: 40 },
  { t: 2, cpu: null, mem: 42 },
  { t: 3, cpu: 30.25, mem: 45 },
];

describe('the fleet area chart', () => {
  it('chooses round ticks, and fixed ones for percentages', () => {
    expect(axisTicks(0, 100, true)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(3, 47, false)).toEqual([0, 20, 40, 60]);
    expect(axisTicks(5, 5, false)).toEqual([4, 5, 6]);
  });

  it('draws one area and line per series, joins gaps and names the latest values', async () => {
    view = await mount(<AreaChart data={rows} xKey="t" percent formatX={(value) => `T${value}`} series={[{ key: 'cpu', label: 'CPU', tone: 'accent' }, { key: 'mem', label: 'Memory', tone: 'signal' }]} />);
    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('CPU 30.3%, Memory 45.0% at T3');
    const lines = [...svg.querySelectorAll('path.fx-chart-curve')].map((path) => path.getAttribute('d')!);
    expect(lines).toHaveLength(2);
    // The CPU line skips the missing middle sample: two points, one segment.
    expect(lines[0]!.match(/[ML]/g)).toEqual(['M', 'L']);
    expect([...svg.querySelectorAll('text')].map((text) => text.textContent)).toEqual(expect.arrayContaining(['0%', '100%', 'T1', 'T3']));
  });

  it('reads out the nearest sample under the pointer', async () => {
    view = await mount(<AreaChart data={rows} xKey="t" formatX={(value) => `T${value}`} series={[{ key: 'mem', label: 'Memory', tone: 'info' }]} />);
    const svg = document.querySelector('svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect);
    await act(async () => {
      svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400 - 24 }));
    });
    expect(document.querySelector('.fx-chart-tooltip')?.textContent).toBe('T3Memory: 45.0');
    await act(async () => {
      svg.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    });
  });
});
