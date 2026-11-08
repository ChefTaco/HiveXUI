// Moves an SVG group between positions with a requestAnimationFrame tween on its `transform`
// attribute, so React does not re-render every frame. Under reduced motion the move is instant.
import { useLayoutEffect, useRef } from 'react';
import { round, type Point } from './geometry';

export const TWEEN_MS = 650;
const ease = (t: number) => 1 - (1 - t) ** 3;
const translate = (point: Point) => `translate(${round(point.x)} ${round(point.y)})`;

/**
 * A ref for a `<g>` that stands at `target`. When the target moves the group glides there; a new
 * `scale` (the pane was resized) or `reduced` motion moves it at once.
 */
export function useTweenedPosition<T extends SVGElement>(target: Point, reduced: boolean, scale: number) {
  const ref = useRef<T | null>(null);
  const current = useRef<Point | null>(null);
  const lastScale = useRef(scale);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const place = (point: Point) => {
      current.current = point;
      node.setAttribute('transform', translate(point));
    };
    const from = current.current;
    const rescaled = lastScale.current !== scale;
    lastScale.current = scale;
    if (!from || reduced || rescaled || (from.x === target.x && from.y === target.y) || typeof requestAnimationFrame !== 'function') {
      place(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (time: number) => {
      start ??= time;
      const t = Math.min(1, (time - start) / TWEEN_MS);
      const k = ease(t);
      place({ x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k });
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, reduced, scale]);

  return ref;
}
