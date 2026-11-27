// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { measureOverlays, placeToastStack, type Box, type OverlayBoxes } from './toast-placement';

const GAP = 20;
const stack = { width: 360, height: 90 };
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
/** The stack's box for offsets from the right and bottom edges. */
const placed = (viewport: { width: number; height: number }, offsets: { right: number; bottom: number } | null): Box => {
  const { right, bottom } = offsets ?? { right: GAP, bottom: GAP };
  return box(viewport.width - right - stack.width, viewport.height - bottom - stack.height, viewport.width - right, viewport.height - bottom);
};
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/** A drawer of the stylesheet's width (35rem, or the whole viewport) with its footer row. */
const drawer = (width: number, height: number): OverlayBoxes => {
  const left = Math.max(0, width - 560);
  return { panel: box(left, 0, width, height), actions: box(left, height - 68, width, height) };
};

describe('toast placement', () => {
  it('keeps the corner when nothing is open, or there is no toast', () => {
    expect(placeToastStack({ width: 1280, height: 720 }, stack, [], GAP)).toBeNull();
    expect(placeToastStack({ width: 1280, height: 720 }, { width: 360, height: 0 }, [drawer(1280, 720)], GAP)).toBeNull();
  });

  it('moves beside an open drawer at 1280x720, clear of the whole drawer', () => {
    const viewport = { width: 1280, height: 720 };
    const overlay = drawer(1280, 720);
    const offsets = placeToastStack(viewport, stack, [overlay], GAP);
    expect(offsets).toEqual({ right: 580, bottom: GAP });
    expect(overlaps(placed(viewport, offsets), overlay.panel)).toBe(false);
    expect(placed(viewport, offsets).left).toBeGreaterThanOrEqual(0);
  });

  it('moves above the actions of a drawer that fills a phone screen', () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const narrow = { width: viewport.width - 32, height: 90 };
      const overlay = drawer(viewport.width, viewport.height);
      const offsets = placeToastStack(viewport, narrow, [overlay], GAP);
      expect(offsets).toEqual({ right: GAP, bottom: 68 + GAP });
      const where = { right: offsets!.right, bottom: offsets!.bottom };
      const toast = box(viewport.width - where.right - narrow.width, viewport.height - where.bottom - narrow.height, viewport.width - where.right, viewport.height - where.bottom);
      expect(overlaps(toast, overlay.actions)).toBe(false);
      expect(toast.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the corner beside a centred dialog that does not reach it', () => {
    const dialog: OverlayBoxes = { panel: box(430, 260, 850, 460), actions: box(454, 400, 826, 436) };
    expect(placeToastStack({ width: 1280, height: 720 }, stack, [dialog], GAP)).toBeNull();
  });

  it('clears the actions of every open overlay, such as a confirmation over a drawer', () => {
    const viewport = { width: 390, height: 844 };
    const confirm: OverlayBoxes = { panel: box(20, 500, 370, 760), actions: box(44, 700, 346, 736) };
    const offsets = placeToastStack(viewport, { width: 358, height: 90 }, [drawer(390, 844), confirm], GAP);
    expect(offsets).toEqual({ right: GAP, bottom: 844 - 700 + GAP });
  });

  it('goes to the top, clear of a sheet that fills the bottom of a phone screen', () => {
    const viewport = { width: 390, height: 844 };
    const overlay: OverlayBoxes = { panel: box(0, 300, 390, 844), actions: box(0, 776, 390, 844) };
    const offsets = placeToastStack(viewport, { width: 358, height: 90 }, [overlay], GAP);
    expect(offsets).toEqual({ right: GAP, bottom: 844 - GAP - 90 });
  });

  it('measures open modal overlays with their footer and step-up notice as the area to keep clear', () => {
    document.body.innerHTML = `
      <div class="toast-stack"><div aria-modal="true" id="inside"></div></div>
      <aside class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-body"></div>
        <div class="step-up-notice step-up-notice--shown"></div>
        <div class="drawer-footer"></div>
      </aside>`;
    const rects: Record<string, Box> = {
      drawer: box(720, 0, 1280, 720),
      'step-up-notice': box(745, 585, 1256, 636),
      'drawer-footer': box(720, 652, 1280, 720),
    };
    for (const element of document.querySelectorAll<HTMLElement>('[class]')) {
      const rect = rects[element.classList[0]!];
      if (!rect) continue;
      element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => rect });
      element.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList;
    }
    document.getElementById('inside')!.getClientRects = () => [{}] as unknown as DOMRectList;
    expect(measureOverlays(document, document.querySelector('.toast-stack'))).toEqual([
      { panel: rects.drawer, actions: box(720, 585, 1280, 720) },
    ]);
    document.body.innerHTML = '';
  });
});
