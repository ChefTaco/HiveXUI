import { useRef, useState, type PointerEvent } from 'react';
import { cn } from '@lib/cn';
import { regionFromPoints, type Region } from '../anchors';

export interface MarkedRegion {
  id: string;
  region: Region;
}

/**
 * A layer over an image or a PDF page that shows commented regions and, when drawing, turns a drag
 * into a normalized region. Geometry is SVG attributes in a 0..1 viewBox, so nothing is styled inline.
 */
export function RegionLayer({ regions, focused, drawing, onRegion, label }: { regions: readonly MarkedRegion[]; focused: string | null; drawing: boolean; onRegion: (region: Region) => void; label: string }) {
  const svg = useRef<SVGSVGElement>(null);
  // A ref, so a fast drag whose events arrive before a render still ends where it began.
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const box = () => svg.current!.getBoundingClientRect();
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing || event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety: a drag that leaves the layer still ends where the pointer is released.
    }
    start.current = { x: event.clientX, y: event.clientY };
    setDraft(null);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (start.current) setDraft(regionFromPoints(start.current, { x: event.clientX, y: event.clientY }, box()));
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (!start.current) return;
    const region = regionFromPoints(start.current, { x: event.clientX, y: event.clientY }, box());
    start.current = null;
    setDraft(region);
    if (region) onRegion(region);
  };
  return (
    <svg
      ref={svg}
      className={cn('review-regions', drawing && 'review-regions--drawing')}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role={drawing ? 'application' : 'presentation'}
      aria-label={drawing ? label : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      {regions.map(({ id, region }) => (
        <rect key={id} className={cn('review-region', id === focused && 'review-region--focus')} x={region.x} y={region.y} width={region.w} height={region.h} vectorEffect="non-scaling-stroke" />
      ))}
      {draft ? <rect className="review-region review-region--draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}
