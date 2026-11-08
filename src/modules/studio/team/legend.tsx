// How each relationship type looks wherever relationships are drawn: four distinct line styles
// (solid, dashed, heavy with an arrow, dotted), each also in its own color and named in a legend.
import { cn } from '@lib/cn';
import { RELATIONSHIP_LABEL, RELATIONSHIP_MEANING, type RelationshipType } from './model';

export interface EdgeLook {
  /** Sets the stroke color through a custom property the canvas reads. */
  className: string;
  /** For the legend's own SVG sample. */
  stroke: string;
  dash: string | undefined;
  width: number;
  arrow: boolean;
}
export const EDGE_LOOK: Record<RelationshipType, EdgeLook> = {
  reports_to: { className: 'studio-edge--reports', stroke: 'stroke-text-muted', dash: undefined, width: 1.5, arrow: false },
  delegates_to: { className: 'studio-edge--delegates', stroke: 'stroke-signal', dash: '7 5', width: 1.5, arrow: true },
  hands_off_to: { className: 'studio-edge--hands-off', stroke: 'stroke-accent', dash: undefined, width: 3, arrow: true },
  reviews: { className: 'studio-edge--reviews', stroke: 'stroke-warning', dash: '1.5 5', width: 2.25, arrow: true },
};
export const RELATIONSHIP_ORDER: readonly RelationshipType[] = ['reports_to', 'delegates_to', 'hands_off_to', 'reviews'];
const ARROW_FILL: Record<RelationshipType, string> = { reports_to: 'fill-text-muted', delegates_to: 'fill-signal', hands_off_to: 'fill-accent', reviews: 'fill-warning' };

/** One SVG marker per type, for edges drawn in an SVG that includes these defs. */
export function EdgeMarkers({ prefix }: { prefix: string }) {
  return (
    <defs>
      {RELATIONSHIP_ORDER.map((type) => (
        <marker key={type} id={`${prefix}-${type}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" className={ARROW_FILL[type]} />
        </marker>
      ))}
    </defs>
  );
}

export function EdgeSample({ type, prefix }: { type: RelationshipType; prefix: string }) {
  const look = EDGE_LOOK[type];
  return (
    <svg className="studio-legend__sample" width="44" height="12" viewBox="0 0 44 12" aria-hidden="true" focusable="false">
      <EdgeMarkers prefix={prefix} />
      <line x1="2" y1="6" x2={look.arrow ? 36 : 42} y2="6" className={look.stroke} strokeWidth={look.width} strokeDasharray={look.dash} strokeLinecap="round" markerEnd={look.arrow ? `url(#${prefix}-${type})` : undefined} />
    </svg>
  );
}

export function EdgeLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('studio-legend text-xs text-text-muted', className)} aria-label="Relationship types">
      {RELATIONSHIP_ORDER.map((type) => (
        <li key={type} title={RELATIONSHIP_MEANING[type]}>
          <EdgeSample type={type} prefix={`legend-${type}`} />
          <span>{RELATIONSHIP_LABEL[type]}</span>
        </li>
      ))}
    </ul>
  );
}
