// Room geometry: the floor plan in tiles, the isometric projection to screen pixels, the default
// layout and seat moves. Pure, so the renderer and the layout editor share one source of truth.
import type { AgentState, Placement, RoomLayout, Seat } from './model';

/** Floor size in tiles: x runs from the back corner down to the right, y down to the left. */
export const ROOM_W = 16;
export const ROOM_D = 16;
/** Half a tile on screen at scale 1: a tile is 64 by 40 pixels, a dimetric view a little above isometric. */
const HALF_W = 32;
const HALF_H = 20;
/** The slant of the back walls on screen, for text drawn on them. */
export const WALL_SLANT_DEG = (Math.atan(HALF_H / HALF_W) * 180) / Math.PI;
export const WALL_H = 132;
const PAD_X = 28;
const PAD_TOP = 24;
const PAD_BOTTOM = 72;

/** The scene's size at scale 1. */
export const NATIVE_WIDTH = (ROOM_W + ROOM_D) * HALF_W + PAD_X * 2;
export const NATIVE_HEIGHT = (ROOM_W + ROOM_D) * HALF_H + WALL_H + PAD_TOP + PAD_BOTTOM;

export interface Point {
  x: number;
  y: number;
}
export interface Iso {
  scale: number;
  width: number;
  height: number;
  /** Floor tile (x, y) at height z (pixels at scale 1) to screen pixels. */
  at: (x: number, y: number, z?: number) => Point;
  /** `points` attribute for a polygon through floor positions at one height. */
  poly: (corners: ReadonlyArray<readonly [number, number, number?]>) => string;
}

export function isoProjection(scale: number): Iso {
  const ox = (PAD_X + ROOM_D * HALF_W) * scale;
  const oy = (PAD_TOP + WALL_H) * scale;
  const at = (x: number, y: number, z = 0): Point => ({ x: ox + (x - y) * HALF_W * scale, y: oy + (x + y) * HALF_H * scale - z * scale });
  const poly = (corners: ReadonlyArray<readonly [number, number, number?]>) =>
    corners
      .map(([x, y, z]) => at(x, y, z ?? 0))
      .map((point) => `${round(point.x)},${round(point.y)}`)
      .join(' ');
  return { scale, width: NATIVE_WIDTH * scale, height: NATIVE_HEIGHT * scale, at, poly };
}
export const round = (value: number): number => Math.round(value * 10) / 10;

/** Scene scale for a container width: the room shrinks with the pane but labels keep their size. */
export const sceneScale = (width: number): number => Math.min(1.3, Math.max(0.6, width / NATIVE_WIDTH));

/** Where the furniture stands, in tiles. Desks sit against the two back walls, facing the room. */
const DESK_SLOTS: ReadonlyArray<{ x: number; y: number; zone: string }> = [
  { x: 5.8, y: 1.3, zone: 'desks-east' },
  { x: 1.3, y: 5.8, zone: 'desks-west' },
  { x: 8.85, y: 1.3, zone: 'desks-east' },
  { x: 1.3, y: 8.85, zone: 'desks-west' },
  { x: 11.9, y: 1.3, zone: 'desks-east' },
  { x: 1.3, y: 11.9, zone: 'desks-west' },
  { x: 14.95, y: 1.3, zone: 'desks-east' },
  { x: 1.3, y: 14.95, zone: 'desks-west' },
];
export const MAX_DESKS = DESK_SLOTS.length;
export const TABLE_CENTER = { x: 10, y: 10 } as const;
export const TABLE_RADIUS = 1.8;
const TABLE_SEAT_RADIUS = 3.3;
export const TABLE_SEATS = 8;
export const REVIEW_STATION = { x: 15, y: 6.4 } as const;
export const DELIVERY_SHELF = { x: 6.4, y: 15 } as const;

/** Where an agent stands relative to the desk it sits at: between the desk and the wall, facing out. */
export function deskOf(seat: Seat): { x: number; y: number } {
  return seat.zone === 'desks-west' ? { x: seat.x + 1.15, y: seat.y } : { x: seat.x, y: seat.y + 1.15 };
}

export const DEFAULT_ZONE_LABELS: Readonly<Record<string, string>> = {
  'desks-east': 'Desks',
  'desks-west': 'Desks',
  table: 'Discussion table',
  review: 'Review station',
  shelf: 'Delivery shelf',
};

/** Every seat the room has: eight desks, eight places at the table and the review station. */
export function roomSeats(): Seat[] {
  const desks = DESK_SLOTS.map((slot, index): Seat => ({ id: `desk-${index + 1}`, kind: 'desk', x: slot.x, y: slot.y, zone: slot.zone }));
  const table = Array.from({ length: TABLE_SEATS }, (_, index): Seat => {
    // Seat 1 faces the viewer across the table, then around clockwise on screen.
    const angle = Math.PI / 4 + (index * 2 * Math.PI) / TABLE_SEATS;
    return { id: `table-${index + 1}`, kind: 'table', x: round(TABLE_CENTER.x + Math.cos(angle) * TABLE_SEAT_RADIUS), y: round(TABLE_CENTER.y + Math.sin(angle) * TABLE_SEAT_RADIUS), zone: 'table' };
  });
  return [...desks, ...table, { id: 'review', kind: 'review', x: REVIEW_STATION.x - 1.2, y: REVIEW_STATION.y, zone: 'review' }];
}

/** Desks handed out so a small team spreads along both walls instead of filling one corner. */
const DESK_ORDER = [0, 1, 4, 5, 2, 3, 6, 7];

/** A first layout for a team: each agent at a desk, overflow at the table. */
export function defaultRoomLayout(agentRefs: readonly string[]): RoomLayout {
  const seats = roomSeats();
  const desks = seats.filter((seat) => seat.kind === 'desk');
  const homes = [...DESK_ORDER.map((index) => desks[index]!), ...seats.filter((seat) => seat.kind === 'table')];
  return { seats, placements: agentRefs.slice(0, homes.length).map((agent, index) => ({ agent, seat: homes[index]!.id })), zoneLabels: { ...DEFAULT_ZONE_LABELS } };
}

/** Seats an agent can call home. The review station is where reviewers go, not a home. */
export const homeSeats = (layout: RoomLayout): Seat[] => layout.seats.filter((seat) => seat.kind !== 'review');

/**
 * Where each agent stands right now: a discussion gathers its participants at the table, a reviewer
 * goes to the review station, everyone else stays at their home seat.
 */
export function stagePositions(
  layout: RoomLayout,
  agents: ReadonlyArray<{ ref: string; seat: string; state: AgentState }>,
  discussion: readonly string[] = [],
): Map<string, { x: number; y: number; seat: Seat }> {
  const byId = new Map(layout.seats.map((seat) => [seat.id, seat] as const));
  const positions = new Map<string, { x: number; y: number; seat: Seat }>();
  const tableSeats = layout.seats.filter((seat) => seat.kind === 'table');
  const taken = new Set(agents.filter((agent) => byId.get(agent.seat)?.kind === 'table' && !discussion.includes(agent.ref)).map((agent) => agent.seat));
  // Participants spread around the table rather than bunching on one side.
  const gathering = discussion.filter((ref) => agents.some((agent) => agent.ref === ref)).length;
  const spread = tableSeats.map((_, index) => tableSeats[Math.round((index * tableSeats.length) / Math.max(1, gathering)) % tableSeats.length]!);
  const freeTable = [...new Set([...spread.slice(0, gathering), ...tableSeats])].filter((seat) => !taken.has(seat.id));
  const review = layout.seats.find((seat) => seat.kind === 'review');
  let reviewers = 0;
  for (const agent of agents) {
    const home = byId.get(agent.seat);
    if (discussion.includes(agent.ref)) {
      const ownTable = home?.kind === 'table' ? home : undefined;
      const seat = ownTable ?? freeTable.shift();
      if (ownTable) freeTable.splice(freeTable.indexOf(ownTable), 1);
      if (seat) {
        positions.set(agent.ref, { x: seat.x, y: seat.y, seat });
        continue;
      }
    }
    if (agent.state === 'reviewing' && review) {
      positions.set(agent.ref, { x: review.x - reviewers * 0.9, y: review.y + reviewers * 0.9, seat: review });
      reviewers += 1;
      continue;
    }
    if (home) positions.set(agent.ref, home.kind === 'desk' ? { ...deskOf(home), seat: home } : { x: home.x, y: home.y, seat: home });
  }
  return positions;
}

export type Direction = 'up' | 'down' | 'left' | 'right';
const VECTORS: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** The nearest seat on screen in a direction, within 60 degrees of it; null at the edge of the room. */
export function adjacentSeat(seats: readonly Seat[], from: Seat, direction: Direction): Seat | null {
  const iso = isoProjection(1);
  const anchor = (seat: Seat) => (seat.kind === 'desk' ? deskOf(seat) : seat);
  const start = anchor(from);
  const origin = iso.at(start.x, start.y);
  const want = VECTORS[direction];
  let best: { seat: Seat; score: number } | null = null;
  for (const seat of seats) {
    if (seat.id === from.id) continue;
    const end = anchor(seat);
    const point = iso.at(end.x, end.y);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) continue;
    const cos = (dx * want.x + dy * want.y) / distance;
    if (cos < 0.5) continue;
    // Prefer seats straight ahead: distance grows as the angle opens.
    const score = distance * (2 - cos);
    if (!best || score < best.score) best = { seat, score };
  }
  return best?.seat ?? null;
}

/** Moves an agent to a seat. Whoever sat there takes the agent's old seat, so nobody is left out. */
export function moveAgent(layout: RoomLayout, agent: string, seatId: string): RoomLayout {
  const current = layout.placements.find((placement) => placement.agent === agent);
  if (!current || current.seat === seatId || !layout.seats.some((seat) => seat.id === seatId)) return layout;
  const placements = layout.placements.map((placement): Placement => {
    if (placement.agent === agent) return { agent, seat: seatId };
    if (placement.seat === seatId) return { agent: placement.agent, seat: current.seat };
    return placement;
  });
  return { ...layout, placements };
}

/** The home seat nearest a screen point, for a drop; null when the point is far from every seat. */
export function seatNear(seats: readonly Seat[], point: Point, iso: Iso, reach = 48): Seat | null {
  let best: { seat: Seat; distance: number } | null = null;
  for (const seat of seats) {
    const anchor = seat.kind === 'desk' ? deskOf(seat) : seat;
    const at = iso.at(anchor.x, anchor.y);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= reach * iso.scale && (!best || distance < best.distance)) best = { seat, distance };
  }
  return best?.seat ?? null;
}
