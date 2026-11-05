import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnimatedNumber, FleetRadar, FxMeter, FxPanel, Gauge, PageItem, Sparkline, Ticker } from './index';

const css = readFileSync(new URL('./effects.css', import.meta.url), 'utf8');

describe('the marquee', () => {
  it('renders real items twice for a seamless loop, hiding the copy from assistive technology', () => {
    const html = renderToStaticMarkup(<Ticker label="Events" items={[{ key: 1, content: 'first' }, { key: 2, content: 'second' }]} />);
    expect(html.match(/first/g)).toHaveLength(2);
    expect(html).toContain('animate-ticker');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('animation-duration');
  });
  it('shows one item without moving, and nothing when empty', () => {
    expect(renderToStaticMarkup(<Ticker label="Events" items={[{ key: 1, content: 'only' }]} />)).not.toContain('animate-ticker');
    expect(renderToStaticMarkup(<Ticker label="Events" items={[]} />)).toBe('');
  });
  it('is CSS only: no timers, so it cannot keep the page busy', () => {
    expect(readFileSync(new URL('./ticker.tsx', import.meta.url), 'utf8')).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|fetch\(/);
  });
});

describe('the effects', () => {
  it('draw real values', () => {
    expect(renderToStaticMarkup(<Gauge value={50} label="CPU" />)).toContain('aria-label="CPU: 50%"');
    expect(renderToStaticMarkup(<Gauge value={null} label="CPU" />)).toContain('aria-label="CPU: —"');
    expect(renderToStaticMarkup(<FleetRadar counts={{ online: 2, degraded: 1, offline: 1, provisioning: 0 }} />).match(/fx-blip /g)).toHaveLength(4);
    expect(renderToStaticMarkup(<AnimatedNumber value={7} suffix=" up" />)).toContain('7 up');
    expect(renderToStaticMarkup(<AnimatedNumber value={null} />)).toContain('—');
    expect(renderToStaticMarkup(<Sparkline values={[1]} emptyLabel="no data" />)).toContain('no data');
    expect(renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)).toContain('polyline');
  });
  it('light a meter past the warning level, or when asked', () => {
    expect(renderToStaticMarkup(<FxMeter value={95} label="x" />)).toContain('fx-meter-hot');
    expect(renderToStaticMarkup(<FxMeter value={10} label="x" />)).not.toContain('fx-meter-hot');
    expect(renderToStaticMarkup(<FxMeter value={10} tone="success" glow label="x" />)).toContain('fx-meter-hot');
  });
  it('build on the shared panel', () => {
    const html = renderToStaticMarkup(<FxPanel hero title="T">body</FxPanel>);
    expect(html).toMatch(/class="panel [^"]*panel-corners/);
    expect(html).toContain('panel-glow');
    // The two shared hooks both need ::after, so they must not meet on one element.
    expect(html).not.toContain('glow-hover');
    expect(html).toContain('grid-bg');
  });
});

describe('page arrival', () => {
  it('leaves no transform behind, which would trap a Drawer or dialog inside the block', () => {
    expect(renderToStaticMarkup(<PageItem>x</PageItem>)).toContain('[animation-fill-mode:backwards]');
  });
});

describe('effects.css', () => {
  it('defines every animation it uses, and leaves motion to the global switch or the low-effects rule', () => {
    const shared = readFileSync(new URL('../../../styles/effects.css', import.meta.url), 'utf8');
    const defined = new Set([...(css + shared).matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]));
    for (const match of css.matchAll(/animation:\s*([\w-]+)/g)) if (match[1] !== 'none') expect(defined.has(match[1])).toBe(true);
    expect(css).toMatch(/html\[data-fx='low'\]/);
    expect(readFileSync(new URL('../../../styles/base.css', import.meta.url), 'utf8')).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
});
