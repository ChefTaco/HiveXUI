// Parametric agent portraits: a bust silhouette, an identity color and a chest emblem. Original
// shapes drawn here; the origin is the floor point the figure stands on, and it rises 52 units.
import type { Portrait, PortraitAccent, PortraitEmblem, PortraitPreset } from './model';

/** Literal class names, so Tailwind sees every one it has to generate. */
const ACCENT: Record<PortraitAccent, { fill: string; stroke: string; soft: string }> = {
  'persona-1': { fill: 'fill-persona-1', stroke: 'stroke-persona-1', soft: 'fill-persona-1/20' },
  'persona-2': { fill: 'fill-persona-2', stroke: 'stroke-persona-2', soft: 'fill-persona-2/20' },
  'persona-3': { fill: 'fill-persona-3', stroke: 'stroke-persona-3', soft: 'fill-persona-3/20' },
  'persona-4': { fill: 'fill-persona-4', stroke: 'stroke-persona-4', soft: 'fill-persona-4/20' },
  'persona-5': { fill: 'fill-persona-5', stroke: 'stroke-persona-5', soft: 'fill-persona-5/20' },
  'persona-6': { fill: 'fill-persona-6', stroke: 'stroke-persona-6', soft: 'fill-persona-6/20' },
};
/** The edge that ties a name plate to its figure's color. */
export const ACCENT_EDGE: Record<PortraitAccent, string> = {
  'persona-1': 'border-l-persona-1',
  'persona-2': 'border-l-persona-2',
  'persona-3': 'border-l-persona-3',
  'persona-4': 'border-l-persona-4',
  'persona-5': 'border-l-persona-5',
  'persona-6': 'border-l-persona-6',
};

const HEAD_Y = -36;
const HEAD_R = 10.5;

function Headgear({ preset, fill, stroke, soft }: { preset: PortraitPreset; fill: string; stroke: string; soft: string }) {
  switch (preset) {
    case 'crest':
      return <polygon className={`${soft} ${stroke}`} strokeWidth={1.5} strokeLinejoin="round" points="-9,-41 -6,-53 -2,-45 1,-56 4,-45 8,-52 9,-41" />;
    case 'hood':
      return <path className={`${soft} ${stroke}`} strokeWidth={1.5} d="M-15,-24 C-17,-40 -12,-51 0,-51 C12,-51 17,-40 15,-24 L11,-26 C12,-38 8,-45 0,-45 C-8,-45 -12,-38 -11,-26 Z" />;
    case 'visor':
      return <rect className={fill} x={-10} y={HEAD_Y - 4} width={20} height={6} rx={3} />;
    case 'bun':
      return (
        <>
          <circle className={`${soft} ${stroke}`} strokeWidth={1.5} cx={0} cy={HEAD_Y - 13} r={5} />
          <path className={`${soft} ${stroke}`} strokeWidth={1.5} d="M-10,-38 C-9,-46 9,-46 10,-38 C5,-42 -5,-42 -10,-38 Z" />
        </>
      );
    case 'cap':
      return <path className={`${fill} ${stroke}`} strokeWidth={1} strokeLinejoin="round" d="M-10,-39 C-10,-50 10,-50 10,-39 L16,-38 L16,-36 L-10,-37 Z" />;
    case 'antenna':
      return (
        <>
          <line className={stroke} strokeWidth={1.5} x1={0} y1={HEAD_Y - HEAD_R} x2={4} y2={HEAD_Y - HEAD_R - 9} />
          <circle className={fill} cx={4} cy={HEAD_Y - HEAD_R - 10} r={2.5} />
        </>
      );
  }
}

function Emblem({ emblem, fill, stroke }: { emblem: PortraitEmblem; fill: string; stroke: string }) {
  switch (emblem) {
    case 'star':
      return <polygon className={fill} points="0,-18 1.5,-14.2 5.5,-14 2.4,-11.5 3.5,-7.6 0,-9.8 -3.5,-7.6 -2.4,-11.5 -5.5,-14 -1.5,-14.2" />;
    case 'quill':
      return <path className={fill} d="M4,-18 C-1,-16 -4,-12 -4,-7 L-2.5,-7 C-1,-11 1,-14 4,-18 Z" />;
    case 'compass':
      return (
        <>
          <circle className={stroke} fill="none" strokeWidth={1.2} cx={0} cy={-12.5} r={5} />
          <polygon className={fill} points="0,-17 1.6,-12.5 0,-8 -1.6,-12.5" />
        </>
      );
    case 'gear':
      return (
        <>
          <circle className={stroke} fill="none" strokeWidth={2.4} strokeDasharray="2.1 1.6" cx={0} cy={-12.5} r={4} />
          <circle className={fill} cx={0} cy={-12.5} r={1.6} />
        </>
      );
    case 'leaf':
      return <path className={fill} d="M-5,-8 C-5,-15 0,-18 5,-18 C5,-12 1,-8 -5,-8 Z" />;
    case 'bolt':
      return <polygon className={fill} points="1.5,-18.5 -4,-11.5 -0.5,-11.5 -2,-6.5 4,-13.5 0.5,-13.5" />;
    case 'eye':
      return (
        <>
          <path className={stroke} fill="none" strokeWidth={1.2} d="M-6,-12.5 C-3,-17 3,-17 6,-12.5 C3,-8 -3,-8 -6,-12.5 Z" />
          <circle className={fill} cx={0} cy={-12.5} r={1.8} />
        </>
      );
    case 'book':
      return <path className={fill} d="M-6,-16 L-0.6,-14.6 L-0.6,-8 L-6,-9.4 Z M6,-16 L0.6,-14.6 L0.6,-8 L6,-9.4 Z" />;
  }
}

/** A bust standing on the origin. Decorative: the avatar around it carries the name. */
export function PortraitFigure({ portrait }: { portrait: Portrait }) {
  const tone = ACCENT[portrait.accent];
  return (
    <g className="room-portrait" aria-hidden="true">
      <path className={`fill-surface-raised ${tone.stroke}`} strokeWidth={1.6} strokeLinejoin="round" d="M-16,0 L-16,-14 C-16,-22 -9,-26 0,-26 C9,-26 16,-22 16,-14 L16,0 Z" />
      <path className={tone.soft} d="M-16,0 L-16,-14 C-16,-22 -9,-26 0,-26 C9,-26 16,-22 16,-14 L16,0 Z" />
      <Emblem emblem={portrait.emblem} fill={tone.fill} stroke={tone.stroke} />
      <rect className="fill-surface-raised" x={-3.5} y={-28} width={7} height={4} />
      <circle className={`fill-surface-hover ${tone.stroke}`} strokeWidth={1.6} cx={0} cy={HEAD_Y} r={HEAD_R} />
      {portrait.preset !== 'visor' && (
        <>
          <circle className="fill-text-strong" cx={-3.6} cy={HEAD_Y - 0.5} r={1.4} />
          <circle className="fill-text-strong" cx={3.6} cy={HEAD_Y - 0.5} r={1.4} />
        </>
      )}
      <Headgear preset={portrait.preset} {...tone} />
    </g>
  );
}

/** A portrait on its own, for lists. */
export function PortraitBadge({ portrait, size = 32 }: { portrait: Portrait; size?: number }) {
  return (
    <svg className="room-portrait-badge" width={size} height={size} viewBox="-22 -58 44 60" aria-hidden="true" focusable="false">
      <PortraitFigure portrait={portrait} />
    </svg>
  );
}
