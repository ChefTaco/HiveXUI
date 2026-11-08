// Name plates must never cover each other. Each plate tries its preferred side of its figure, then the
// others; when every side is taken it moves down until it is clear. Pure, so it is tested alone.

export type PlateSide = 'below' | 'left' | 'right';
export const PLATE_H = 44;

export interface PlateBox {
  x: number;
  y: number;
}

/** Where a plate sits relative to its figure's floor point: under its feet or level with its chest. */
export function plateBox(side: PlateSide, width: number, size: number): PlateBox {
  if (side === 'below') return { x: -width / 2, y: 8 };
  const gap = 19 * size + 6;
  const y = -30 * size - PLATE_H / 2;
  return side === 'right' ? { x: gap, y } : { x: -gap - width, y };
}

export interface PlateRequest {
  ref: string;
  /** The figure's floor point on screen. */
  x: number;
  y: number;
  prefer: PlateSide;
}
export interface PlatePlacement {
  side: PlateSide;
  /** Extra downward shift when every side was taken. */
  shift: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const MARGIN = 3;
const overlaps = (a: Rect, b: Rect) => a.left < b.right + MARGIN && b.left < a.right + MARGIN && a.top < b.bottom + MARGIN && b.top < a.bottom + MARGIN;
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** What a side costs over the preferred one, and each pixel of shift away from the figure. */
const SIDE_COST = 120;
const SHIFT_COST = 6;
const SHIFTS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8].map((step) => step * (PLATE_H / 2));

/**
 * Sides for every plate, back-most figures first: the front of the room has more free floor. A plate
 * never covers another plate or a fixed label; among the places that are left it takes the one that
 * hides the least of other faces, staying on its preferred side and close to its figure when it can.
 */
export function placePlates(requests: readonly PlateRequest[], width: number, size: number, bounds: { width: number; height: number }, obstacles: readonly Rect[] = []): Map<string, PlatePlacement> {
  const placed: Rect[] = [...obstacles];
  const result = new Map<string, PlatePlacement>();
  const rect = (request: PlateRequest, side: PlateSide, shift: number): Rect => {
    const box = plateBox(side, width, size);
    const left = request.x + box.x;
    const top = request.y + box.y + shift;
    return { left, top, right: left + width, bottom: top + PLATE_H };
  };
  const heads = requests.map((request) => ({ ref: request.ref, rect: { left: request.x - 13 * size, top: request.y - 62 * size, right: request.x + 13 * size, bottom: request.y - 26 * size } }));
  const inside = (r: Rect) => r.left >= 0 && r.right <= bounds.width && r.top >= 0 && r.bottom <= bounds.height;
  for (const request of [...requests].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const sides: PlateSide[] = [request.prefer, ...(['below', 'right', 'left'] as const).filter((side) => side !== request.prefer)];
    let best: { side: PlateSide; shift: number; rect: Rect; cost: number } | null = null;
    for (const shift of SHIFTS) {
      for (const side of sides) {
        const r = rect(request, side, shift);
        if (!inside(r) || placed.some((other) => overlaps(r, other))) continue;
        const hidden = heads.reduce((sum, head) => (head.ref === request.ref ? sum : sum + overlapArea(r, head.rect)), 0);
        const cost = hidden + (side === request.prefer ? 0 : SIDE_COST) + Math.abs(shift) * SHIFT_COST;
        if (!best || cost < best.cost) best = { side, shift, rect: r, cost };
      }
    }
    const choice = best ?? { side: request.prefer, shift: 0, rect: rect(request, request.prefer, 0) };
    placed.push(choice.rect);
    result.set(request.ref, { side: choice.side, shift: choice.shift });
  }
  return result;
}
