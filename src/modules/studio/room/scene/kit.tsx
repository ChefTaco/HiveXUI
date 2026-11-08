// The room kit, drawn here as isometric SVG: floor, walls, desks, the discussion table, the display
// wall, the review station and the delivery shelf. Colors come from theme classes only.
import type { ReactNode } from 'react';
import { cn } from '@lib/cn';
import { DELIVERY_SHELF, REVIEW_STATION, ROOM_D, ROOM_W, TABLE_CENTER, TABLE_RADIUS, WALL_H, WALL_SLANT_DEG, type Iso } from './geometry';
import type { DisplayWall, Seat, ShelfItem } from './model';

const EDGE = 'stroke-border-strong/50';

/** A box on the floor: its top and the two faces that turn toward the viewer. */
export function IsoBox({ iso, x, y, w, d, h, z = 0, className, top, front }: { iso: Iso; x: number; y: number; w: number; d: number; h: number; z?: number; className?: string; top?: string | undefined; front?: string | undefined }) {
  const z1 = z + h;
  return (
    <g className={className}>
      <polygon className={cn(front ?? 'fill-surface-raised', EDGE)} strokeWidth={1} points={iso.poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z1], [x, y + d, z1]])} />
      <polygon className={cn('fill-surface', EDGE)} strokeWidth={1} points={iso.poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z1], [x + w, y, z1]])} />
      <polygon className={cn(top ?? 'fill-surface-hover', EDGE)} strokeWidth={1} points={iso.poly([[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]])} />
    </g>
  );
}

/** The floor grid and the two back walls with their lit trim. */
export function RoomShell({ iso, zoneLabels }: { iso: Iso; zoneLabels: Record<string, string> }) {
  const lines: ReactNode[] = [];
  for (let x = 1; x < ROOM_W; x += 1) {
    const a = iso.at(x, 0);
    const b = iso.at(x, ROOM_D);
    lines.push(<line key={`x${x}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
  }
  for (let y = 1; y < ROOM_D; y += 1) {
    const a = iso.at(0, y);
    const b = iso.at(ROOM_W, y);
    lines.push(<line key={`y${y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
  }
  const corner = iso.at(0, 0, WALL_H);
  const right = iso.at(ROOM_W, 0, WALL_H);
  const left = iso.at(0, ROOM_D, WALL_H);
  const { 'desks-east': east, 'desks-west': west } = zoneLabelPoints(iso);
  return (
    <g aria-hidden="true">
      <polygon className="fill-surface-sunken stroke-border" strokeWidth={1} points={iso.poly([[0, 0], [ROOM_W, 0], [ROOM_W, ROOM_D], [0, ROOM_D]])} />
      <g className="stroke-accent/10" strokeWidth={1}>{lines}</g>
      <polygon className="fill-surface stroke-border" strokeWidth={1} points={iso.poly([[0, 0, 0], [0, ROOM_D, 0], [0, ROOM_D, WALL_H], [0, 0, WALL_H]])} />
      <polygon className="fill-surface-raised stroke-border" strokeWidth={1} points={iso.poly([[0, 0, 0], [ROOM_W, 0, 0], [ROOM_W, 0, WALL_H], [0, 0, WALL_H]])} />
      <polyline className="room-trim stroke-accent/60" fill="none" strokeWidth={1.5} points={`${left.x},${left.y} ${corner.x},${corner.y} ${right.x},${right.y}`} />
      <polyline className="stroke-accent/40" fill="none" strokeWidth={1} points={iso.poly([[0, ROOM_D], [0, 0], [ROOM_W, 0]])} />
      {zoneLabels['desks-east'] && (
        <text className="room-wall-text fill-text-muted text-xs" transform={`translate(${east.x} ${east.y}) skewY(${WALL_SLANT_DEG})`} textAnchor="middle">
          {zoneLabels['desks-east']}
        </text>
      )}
      {zoneLabels['desks-west'] && (
        <text className="room-wall-text fill-text-muted text-xs" transform={`translate(${west.x} ${west.y}) skewY(${-WALL_SLANT_DEG})`} textAnchor="middle">
          {zoneLabels['desks-west']}
        </text>
      )}
    </g>
  );
}

/** A desk against a back wall with its monitor. The screen lights up while its agent works. */
export function Desk({ iso, seat, lit }: { iso: Iso; seat: Seat; lit: boolean }) {
  const west = seat.zone === 'desks-west';
  const [x, y, w, d] = west ? [seat.x - 0.5, seat.y - 1.05, 1, 2.1] : [seat.x - 1.05, seat.y - 0.5, 2.1, 1];
  // The monitor faces the room: its screen is the face that turns toward the viewer.
  const screen = west
    ? iso.poly([[seat.x - 0.05, seat.y - 0.62, 30], [seat.x - 0.05, seat.y + 0.62, 30], [seat.x - 0.05, seat.y + 0.62, 56], [seat.x - 0.05, seat.y - 0.62, 56]])
    : iso.poly([[seat.x - 0.62, seat.y - 0.05, 30], [seat.x + 0.62, seat.y - 0.05, 30], [seat.x + 0.62, seat.y - 0.05, 56], [seat.x - 0.62, seat.y - 0.05, 56]]);
  const glow = iso.at(seat.x, seat.y, 26);
  return (
    <g className="room-desk" aria-hidden="true">
      <IsoBox iso={iso} x={x} y={y} w={w} d={d} h={26} />
      {lit && <ellipse className="fx-screen-glow fill-accent/20" cx={glow.x} cy={glow.y} rx={34 * iso.scale} ry={14 * iso.scale} />}
      <IsoBox iso={iso} x={west ? seat.x - 0.35 : seat.x - 0.66} y={west ? seat.y - 0.66 : seat.y - 0.35} w={west ? 0.25 : 1.32} d={west ? 1.32 : 0.25} h={30} z={26} top="fill-surface-raised" />
      <polygon className={cn('room-screen', lit ? 'fx-screen-glow fill-accent/50 stroke-accent' : 'fill-surface-sunken stroke-border-strong/60')} strokeWidth={1} points={screen} />
    </g>
  );
}

/** Where the table, review station and shelf names sit: their baselines, shared with plate placement. */
export function zoneLabelPoints(iso: Iso): Record<'table' | 'review' | 'shelf' | 'desks-east' | 'desks-west', { x: number; y: number }> {
  const ry = Math.abs(iso.at(TABLE_RADIUS, TABLE_RADIUS).y - iso.at(0, 0).y);
  const top = iso.at(TABLE_CENTER.x, TABLE_CENTER.y, 24);
  return {
    table: { x: top.x, y: top.y - ry * 0.35 },
    review: iso.at(REVIEW_STATION.x + 1.1, REVIEW_STATION.y + 1.3),
    shelf: iso.at(DELIVERY_SHELF.x + 1.4, DELIVERY_SHELF.y + 1.6),
    'desks-east': iso.at(10.2, 0, WALL_H - 18),
    'desks-west': iso.at(0, 10.2, WALL_H - 18),
  };
}

/** The round discussion table. Its name sits on the tabletop. */
export function DiscussionTable({ iso, label }: { iso: Iso; label?: string | undefined }) {
  // A circle on the floor: its width and depth on screen come from the projection.
  const rx = Math.abs(iso.at(TABLE_RADIUS, -TABLE_RADIUS).x - iso.at(0, 0).x);
  const ry = Math.abs(iso.at(TABLE_RADIUS, TABLE_RADIUS).y - iso.at(0, 0).y);
  const top = iso.at(TABLE_CENTER.x, TABLE_CENTER.y, 24);
  const rim = iso.at(TABLE_CENTER.x, TABLE_CENTER.y, 18);
  const foot = iso.at(TABLE_CENTER.x, TABLE_CENTER.y, 0);
  return (
    <g className="room-table" aria-hidden="true">
      <ellipse className="fill-surface-sunken" cx={foot.x} cy={foot.y} rx={rx * 0.45} ry={ry * 0.45} />
      <rect className={cn('fill-surface', EDGE)} x={foot.x - 6 * iso.scale} y={rim.y} width={12 * iso.scale} height={foot.y - rim.y} />
      <ellipse className={cn('fill-surface-raised', EDGE)} cx={rim.x} cy={rim.y} rx={rx} ry={ry} />
      <rect className="fill-surface-raised" x={rim.x - rx} y={top.y} width={rx * 2} height={rim.y - top.y} />
      <ellipse className="fill-surface-hover stroke-accent/50" strokeWidth={1.2} cx={top.x} cy={top.y} rx={rx} ry={ry} />
      <ellipse className="stroke-accent/20" fill="none" strokeWidth={1} cx={top.x} cy={top.y} rx={rx * 0.7} ry={ry * 0.7} />
      {label && (
        <text className="fill-text-muted text-xs" x={top.x} y={zoneLabelPoints(iso).table.y} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

/** The review station: a lectern with a lens, where reviewers stand. */
export function ReviewStation({ iso, label, active }: { iso: Iso; label?: string | undefined; active: boolean }) {
  const lens = iso.at(REVIEW_STATION.x + 0.1, REVIEW_STATION.y + 0.1, 48);
  const name = zoneLabelPoints(iso).review;
  return (
    <g className="room-review" aria-hidden="true">
      <IsoBox iso={iso} x={REVIEW_STATION.x - 0.5} y={REVIEW_STATION.y - 0.7} w={1} d={1.4} h={34} top={active ? 'fill-info/30' : undefined} />
      <circle className={cn(active ? 'stroke-info' : 'stroke-border-strong')} fill="none" strokeWidth={2} cx={lens.x} cy={lens.y} r={8 * iso.scale} />
      <line className={cn(active ? 'stroke-info' : 'stroke-border-strong')} strokeWidth={2.5} x1={lens.x + 5.5 * iso.scale} y1={lens.y + 5.5 * iso.scale} x2={lens.x + 11 * iso.scale} y2={lens.y + 11 * iso.scale} />
      {label && (
        <text className="fill-text-muted text-xs" x={name.x} y={name.y} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

const SHELF_H = 64;
/** The delivery shelf: three boards, one block per delivered item, newest first. */
export function DeliveryShelf({ iso, label, items }: { iso: Iso; label?: string | undefined; items: readonly ShelfItem[] }) {
  const { x, y } = DELIVERY_SHELF;
  const boards = [0, 22, 44].map((z) => iso.poly([[x - 1.3, y + 0.4, z + 2], [x + 1.3, y + 0.4, z + 2]]));
  const name = zoneLabelPoints(iso).shelf;
  const shown = items.slice(0, 6);
  return (
    <g className="room-shelf" aria-hidden="true">
      <IsoBox iso={iso} x={x - 1.3} y={y - 0.4} w={2.6} d={0.8} h={SHELF_H} front="fill-surface" />
      {boards.map((points, index) => (
        <polyline key={index} className="stroke-border-strong" fill="none" strokeWidth={1.5} points={points} />
      ))}
      {shown.map((item, index) => {
        const level = Math.floor(index / 2);
        const column = index % 2;
        return <IsoBox key={item.id} iso={iso} x={x - 1 + column * 1.1} y={y - 0.2} w={0.6} d={0.4} h={14} z={4 + level * 22} top="fill-signal/60" front="fill-signal/30" />;
      })}
      {label && (
        <text className="fill-text-muted text-xs" x={name.x} y={name.y} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

const SLOTS: ReadonlyArray<{ key: keyof DisplayWall; title: string }> = [
  { key: 'brief', title: 'Brief' },
  { key: 'focus', title: 'Focus' },
  { key: 'decisions', title: 'Decisions' },
  { key: 'questions', title: 'Questions' },
];

/** The display wall's four slots. Empty slots say so; nothing is filled in for show. */
export function DisplayBoard({ wall, compact = false }: { wall: DisplayWall; compact?: boolean }) {
  return (
    <div className={cn('room-board border border-accent/40 bg-surface-raised text-text', compact && 'room-board--compact')}>
      {SLOTS.map(({ key, title }) => {
        const value = wall[key];
        const empty = value === undefined || value === '';
        return (
          <div key={key} className="room-board__slot">
            <span className="stat-label">{title}</span>
            <span className={cn('room-board__value text-xs', empty ? 'text-text-muted' : typeof value === 'number' ? 'data-figure text-lg text-text-strong' : 'text-text')}>{empty ? 'None yet' : value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Items on the delivery shelf as a list beside it. */
export function ShelfList({ items }: { items: readonly ShelfItem[] }) {
  return (
    <ul className="room-shelf-list border border-border bg-surface-raised text-xs text-text">
      {items.slice(0, 3).map((item) => (
        <li key={item.id} className="room-shelf-list__item">
          {item.label}
        </li>
      ))}
      {items.length > 3 && <li className="text-text-muted">{`+${items.length - 3} more`}</li>}
    </ul>
  );
}
