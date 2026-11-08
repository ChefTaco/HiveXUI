// The room layout as the Studio service stores it (seats, placements by role, zone labels, a
// revision) and as the scene draws it (seats with zones, placements by agent). Pure both ways, so a
// saved layout comes back exactly as it was edited.
import type { PutLayout, RoomLayoutRecord } from '../api/endpoints';
import { DEFAULT_ZONE_LABELS, defaultRoomLayout, homeSeats, roomSeats } from './scene/geometry';
import type { Placement, RoomLayout, Seat } from './scene/model';

/** An agent in the room and the role key it sits for. */
export interface Seated {
  ref: string;
  role: string;
}

const SCENE_KIND: Record<string, Seat['kind'] | undefined> = { desk: 'desk', discussion: 'table', review: 'review' };
const SERVICE_KIND: Record<Seat['kind'], 'desk' | 'discussion' | 'review'> = { desk: 'desk', table: 'discussion', review: 'review' };

/** Desks stand along the two back walls: along the east wall y is the small one. */
const zoneOf = (kind: Seat['kind'], x: number, y: number): string => (kind === 'desk' ? (y <= x ? 'desks-east' : 'desks-west') : kind);

/** The layout to draw: the saved one, with anyone it does not place given a free home seat, or a first layout. */
export function sceneLayout(saved: RoomLayoutRecord | null, agents: readonly Seated[]): RoomLayout {
  if (!saved || !saved.seats.some((seat) => SCENE_KIND[seat.kind])) return defaultRoomLayout(agents.map((agent) => agent.ref));
  const seats = saved.seats.flatMap((seat): Seat[] => {
    const kind = SCENE_KIND[seat.kind];
    return kind ? [{ id: seat.id, kind, x: seat.x, y: seat.y, zone: zoneOf(kind, seat.x, seat.y) }] : [];
  });
  const byRole = new Map(saved.placements.map((placement) => [placement.role_key, placement.seat_id] as const));
  const known = new Set(seats.map((seat) => seat.id));
  const placements: Placement[] = [];
  const taken = new Set<string>();
  for (const agent of agents) {
    const seat = byRole.get(agent.role);
    if (seat && known.has(seat) && !taken.has(seat)) {
      placements.push({ agent: agent.ref, seat });
      taken.add(seat);
    }
  }
  const free = homeSeats({ seats, placements, zoneLabels: {} })
    .filter((seat) => !taken.has(seat.id))
    .sort((a, b) => Number(b.kind === 'desk') - Number(a.kind === 'desk'));
  for (const agent of agents) {
    if (placements.some((placement) => placement.agent === agent.ref)) continue;
    const seat = free.shift();
    if (seat) placements.push({ agent: agent.ref, seat: seat.id });
  }
  return { seats, placements, zoneLabels: { ...DEFAULT_ZONE_LABELS, ...saved.zone_labels } };
}

/** The request that saves a layout the scene edited, as a new revision on top of `baseRevision`. */
export function layoutRequest(layout: RoomLayout, agents: readonly Seated[], baseRevision: number | null): PutLayout {
  const roleOf = new Map(agents.map((agent) => [agent.ref, agent.role] as const));
  const seats = (layout.seats.length ? layout.seats : roomSeats()).map((seat) => ({ id: seat.id, kind: SERVICE_KIND[seat.kind], x: seat.x, y: seat.y }));
  const placements = layout.placements.flatMap((placement) => {
    const role = roleOf.get(placement.agent);
    return role ? [{ role_key: role, seat_id: placement.seat }] : [];
  });
  const zone_labels = Object.fromEntries(Object.entries(layout.zoneLabels).map(([zone, label]) => [zone, label.trim().slice(0, 60)]));
  return { base_revision: baseRevision, seats, placements, zone_labels };
}

/** The zones a person can rename while editing, in the order the editor lists them. */
export const ZONE_FIELDS: ReadonlyArray<{ zone: string; label: string }> = [
  { zone: 'desks-east', label: 'Right wall' },
  { zone: 'desks-west', label: 'Left wall' },
  { zone: 'table', label: 'Table' },
  { zone: 'review', label: 'Review station' },
  { zone: 'shelf', label: 'Delivery shelf' },
];
