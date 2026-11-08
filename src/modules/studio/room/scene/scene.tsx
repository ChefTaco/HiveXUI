// The Conversation Room's visual scene: an isometric room in SVG on wider screens, a roster ring
// around the display wall on phones. Prop-driven and stateless about agents: it draws what it is
// given, moves figures with a tween, and reports selections and layout edits through callbacks.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '@lib/cn';
import { useReducedMotion } from '@lib/motion';
import { AgentPlate, Avatar } from './avatar';
import {
  adjacentSeat,
  DELIVERY_SHELF,
  deskOf,
  homeSeats,
  isoProjection,
  moveAgent,
  NATIVE_WIDTH,
  sceneScale,
  seatNear,
  stagePositions,
  TABLE_CENTER,
  WALL_H,
  type Direction,
  type Iso,
  type Point,
} from './geometry';
import { DeliveryShelf, Desk, DiscussionTable, DisplayBoard, ReviewStation, RoomShell, ShelfList } from './kit';
import type { DisplayWall, RoomLayout, SceneAgent, SceneArc, Seat, ShelfItem } from './model';
import { placePlates, type PlateSide, type Rect } from './plates';
import { useTweenedPosition } from './tween';
import './scene.css';

export interface RoomSceneProps {
  agents: readonly SceneAgent[];
  layout: RoomLayout;
  wall?: DisplayWall;
  arcs?: readonly SceneArc[];
  shelf?: readonly ShelfItem[];
  /** Agents gathered at the table for a discussion. */
  discussion?: readonly string[];
  /** Layout editing: agents move between seats by drag or keyboard. */
  editing?: boolean;
  /** An avatar was clicked or activated with Enter or Space. */
  onSelect?: (ref: string) => void;
  /** A move was placed. The scene does not keep the new layout; the owner passes it back. */
  onLayoutChange?: (layout: RoomLayout) => void;
  /** The agent with focus, shared with the roster list. */
  activeRef?: string | null;
  onActiveChange?: (ref: string) => void;
  /** `auto` follows the screen: the ring below 640 px, the room above. */
  variant?: 'auto' | 'scene' | 'ring';
  label?: string;
}

const NARROW = '(max-width: 639.98px)';
function subscribeNarrow(onChange: () => void): () => void {
  const media = window.matchMedia?.(NARROW);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}
const useNarrowScreen = (): boolean => useSyncExternalStore(subscribeNarrow, () => Boolean(window.matchMedia?.(NARROW).matches), () => false);

/** The width of a box, followed as it resizes. Zero until measured, and in environments with no layout. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(Math.floor(node.getBoundingClientRect().width));
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(Math.floor(box.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const DIRECTIONS: Partial<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Focus between avatars with the arrow keys, Home and End, in the order the agents are listed. */
function useAvatarFocus(agents: readonly SceneAgent[]) {
  const nodes = useRef(new Map<string, SVGGElement>());
  const register = useCallback((ref: string) => (node: SVGGElement | null) => {
    if (node) nodes.current.set(ref, node);
    else nodes.current.delete(ref);
  }, []);
  const move = useCallback(
    (event: KeyboardEvent, ref: string): boolean => {
      const index = agents.findIndex((agent) => agent.ref === ref);
      if (index < 0 || agents.length === 0) return false;
      let next: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % agents.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + agents.length) % agents.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = agents.length - 1;
      if (next === null) return false;
      event.preventDefault();
      nodes.current.get(agents[next]!.ref)?.focus();
      return true;
    },
    [agents],
  );
  return { register, move, nodes };
}

export const seatName = (seat: Seat): string => {
  const number = seat.id.replace(/^\D+-/, '');
  if (seat.kind === 'desk') return `Desk ${number}`;
  if (seat.kind === 'table') return `Table seat ${number}`;
  return 'Review station';
};

/** A figure at its place in the room, gliding when the place changes. */
function PlacedAgent({ target, reduced, scale, children }: { target: Point; reduced: boolean; scale: number; children: ReactNode }) {
  const ref = useTweenedPosition<SVGGElement>(target, reduced, scale);
  return <g ref={ref}>{children}</g>;
}

interface Carry {
  ref: string;
  seat: Seat;
}

function IsoRoom({ agents, layout, wall = {}, arcs = [], shelf = [], discussion = [], editing = false, onSelect, onLayoutChange, activeRef, onActiveChange, label, width }: RoomSceneProps & { width: number }) {
  const reduced = useReducedMotion();
  const iso = useMemo(() => isoProjection(sceneScale(width || NATIVE_WIDTH * 0.9)), [width]);
  const size = Math.min(1.7, Math.max(1.15, iso.scale * 1.6));
  const plateWidth = iso.scale < 0.8 ? 128 : 148;
  const tableCenter = iso.at(TABLE_CENTER.x, TABLE_CENTER.y);
  const { register, move, nodes } = useAvatarFocus(agents);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [drag, setDrag] = useState<{ ref: string; point: Point; moved: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const helpId = useId();
  const seats = useMemo(() => homeSeats(layout), [layout]);
  const seatById = useMemo(() => new Map(layout.seats.map((seat) => [seat.id, seat] as const)), [layout]);

  useEffect(() => {
    if (!editing) {
      setCarry(null);
      setDrag(null);
      setStatus('');
    }
  }, [editing]);

  // While editing everyone stands at home, so the layout being edited is the one shown.
  const positions = useMemo(
    () => stagePositions(layout, editing ? agents.map((agent) => ({ ...agent, state: 'available' as const })) : agents, editing ? [] : discussion),
    [layout, agents, discussion, editing],
  );
  const screenOf = useCallback(
    (agent: SceneAgent): Point => {
      if (drag?.ref === agent.ref) return drag.point;
      if (carry?.ref === agent.ref) {
        const anchor = carry.seat.kind === 'desk' ? deskOf(carry.seat) : carry.seat;
        return iso.at(anchor.x, anchor.y);
      }
      const position = positions.get(agent.ref);
      return position ? iso.at(position.x, position.y) : iso.at(-4, -4);
    },
    [drag, carry, positions, iso],
  );
  const placed = agents.filter((agent) => positions.has(agent.ref));
  /** Plates face into the room from the desks, and outward from the table so a discussion stays readable. */
  const sideOf = (agent: SceneAgent): PlateSide => {
    const seat = carry?.ref === agent.ref ? carry.seat : positions.get(agent.ref)?.seat;
    if (!seat) return 'below';
    if (seat.kind === 'desk') return seat.zone === 'desks-west' ? 'right' : 'left';
    if (seat.kind === 'table') {
      const dx = screenOf(agent).x - tableCenter.x;
      return Math.abs(dx) < 24 * iso.scale ? 'below' : dx < 0 ? 'left' : 'right';
    }
    return 'left';
  };
  const depthOf = (agent: SceneAgent) => {
    const position = positions.get(agent.ref);
    return position ? position.x + position.y : 0;
  };
  const working = new Set(placed.filter((agent) => agent.state === 'working').map((agent) => agent.seat));

  const commit = (ref: string, seat: Seat) => {
    const name = agents.find((agent) => agent.ref === ref)?.displayName ?? ref;
    const next = moveAgent(layout, ref, seat.id);
    if (next !== layout) onLayoutChange?.(next);
    setStatus(`Placed ${name} at ${seatName(seat)}.`);
  };

  const onKeyDown = (agent: SceneAgent) => (event: KeyboardEvent<SVGGElement>) => {
    if (editing) {
      if (carry?.ref === agent.ref) {
        const direction = DIRECTIONS[event.key];
        if (direction) {
          event.preventDefault();
          const next = adjacentSeat(seats, carry.seat, direction);
          if (next) {
            setCarry({ ref: agent.ref, seat: next });
            const holder = layout.placements.find((placement) => placement.seat === next.id && placement.agent !== agent.ref);
            const other = holder ? agents.find((item) => item.ref === holder.agent)?.displayName : undefined;
            setStatus(`${seatName(next)}${other ? `, swaps with ${other}` : ''}.`);
          } else setStatus(`No seat further ${direction}.`);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          commit(agent.ref, carry.seat);
          setCarry(null);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setCarry(null);
          setStatus(`Move cancelled. ${agent.displayName} stays at ${seatName(seatById.get(agent.seat) ?? carry.seat)}.`);
          return;
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const seat = seatById.get(agent.seat);
        if (!seat) return;
        setCarry({ ref: agent.ref, seat });
        setStatus(`Moving ${agent.displayName} from ${seatName(seat)}. Arrow keys choose a seat, Enter places, Escape cancels.`);
        return;
      }
      if (event.key === 'Escape' && drag) {
        setDrag(null);
        return;
      }
      move(event, agent.ref);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(agent.ref);
      return;
    }
    move(event, agent.ref);
  };

  const toLocal = (event: PointerEvent): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const onPointerDown = (agent: SceneAgent) => (event: PointerEvent<SVGGElement>) => {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setCarry(null);
    setDrag({ ref: agent.ref, point: toLocal(event), moved: false });
    nodes.current.get(agent.ref)?.focus();
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag) setDrag({ ...drag, point: toLocal(event), moved: true });
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const seat = drag.moved ? seatNear(seats, toLocal(event), iso) : null;
    if (seat) commit(drag.ref, seat);
    setDrag(null);
  };

  const activate = (agent: SceneAgent) => () => {
    if (!editing) onSelect?.(agent.ref);
  };
  const focus = (agent: SceneAgent) => () => onActiveChange?.(agent.ref);

  const corner = iso.at(0, 0, WALL_H - 12);
  const boardWidth = Math.min(540, Math.max(380, 480 * iso.scale));
  const boardHeight = Math.max(96, (WALL_H - 30) * iso.scale);
  const shelfAt = iso.at(DELIVERY_SHELF.x + 1.4, DELIVERY_SHELF.y + 1.6);
  const head = (ref: string): Point | null => {
    const agent = agents.find((item) => item.ref === ref);
    if (!agent || !positions.has(ref)) return null;
    const point = screenOf(agent);
    return { x: point.x, y: point.y - 44 * size };
  };
  const shapes = arcShapes(arcs, head, iso.at(DELIVERY_SHELF.x, DELIVERY_SHELF.y, 72), iso.scale, size);
  // Fixed labels the name plates keep clear of: the display wall, the shelf list and hand-off labels.
  const obstacles: Rect[] = [
    { left: corner.x - boardWidth / 2, top: corner.y, right: corner.x + boardWidth / 2, bottom: corner.y + boardHeight },
    ...(shelf.length ? [{ left: shelfAt.x - 78, top: shelfAt.y + 8, right: shelfAt.x + 78, bottom: shelfAt.y + 92 }] : []),
    ...shapes.filter((shape) => shape.arc.kind === 'handoff').map((shape) => ({ left: shape.middle.x - 90, top: shape.middle.y - 14, right: shape.middle.x + 90, bottom: shape.middle.y + 14 })),
  ];
  const plates = placePlates(
    placed.map((agent) => ({ ref: agent.ref, ...screenOf(agent), prefer: sideOf(agent) })),
    plateWidth,
    size,
    iso,
    obstacles,
  );
  const drawables = [
    ...layout.seats.filter((seat) => seat.kind === 'desk').map((seat) => ({ depth: seat.x + seat.y + 0.3, key: seat.id, node: <Desk key={seat.id} iso={iso} seat={seat} lit={working.has(seat.id)} /> })),
    { depth: 19.2, key: 'table', node: <DiscussionTable key="table" iso={iso} label={layout.zoneLabels.table} /> },
    { depth: 22.8, key: 'review', node: <ReviewStation key="review" iso={iso} label={layout.zoneLabels.review} active={placed.some((agent) => agent.state === 'reviewing')} /> },
    { depth: 22, key: 'shelf', node: <DeliveryShelf key="shelf" iso={iso} label={layout.zoneLabels.shelf} items={shelf} /> },
    ...placed.map((agent) => ({
      depth: depthOf(agent) + (drag?.ref === agent.ref ? 100 : 0),
      key: agent.ref,
      node: (
        <PlacedAgent key={agent.ref} target={screenOf(agent)} reduced={reduced || drag?.ref === agent.ref} scale={iso.scale}>
          <Avatar
            agent={agent}
            size={size}
            active={activeRef === agent.ref}
            editing={editing}
            carrying={carry?.ref === agent.ref || drag?.ref === agent.ref}
            ariaLabel={carry?.ref === agent.ref ? `${agent.displayName}, moving to ${seatName(carry.seat)}` : undefined}
            avatarRef={register(agent.ref)}
            onKeyDown={onKeyDown(agent)}
            onActivate={activate(agent)}
            onFocus={focus(agent)}
            onPointerDown={editing ? onPointerDown(agent) : undefined}
          />
        </PlacedAgent>
      ),
    })),
  ].sort((a, b) => a.depth - b.depth);

  return (
    <div className="room-scene__frame">
      <svg
        ref={svgRef}
        className={cn('room-scene__svg', editing && 'room-scene__svg--editing')}
        role="group"
        aria-label={label ?? 'Conversation room'}
        aria-describedby={editing ? helpId : undefined}
        width={iso.width}
        height={iso.height}
        viewBox={`0 0 ${Math.round(iso.width)} ${Math.round(iso.height)}`}
        onPointerMove={editing ? onPointerMove : undefined}
        onPointerUp={editing ? onPointerUp : undefined}
        onPointerCancel={editing ? () => setDrag(null) : undefined}
      >
        <RoomShell iso={iso} zoneLabels={layout.zoneLabels} />
        <foreignObject x={corner.x - boardWidth / 2} y={corner.y} width={boardWidth} height={boardHeight} aria-hidden="true">
          <DisplayBoard wall={wall} />
        </foreignObject>
        {editing && <SeatMarks iso={iso} seats={seats} target={carry?.seat.id ?? (drag ? seatNear(seats, drag.point, iso)?.id : undefined)} />}
        {drawables.map((item) => item.node)}
        {shelf.length > 0 && (
          <foreignObject x={shelfAt.x - 78} y={shelfAt.y + 8} width={156} height={84} aria-hidden="true">
            <ShelfList items={shelf} />
          </foreignObject>
        )}
        <Arcs shapes={shapes} />
        {placed.map((agent) => (
          <PlacedAgent key={agent.ref} target={screenOf(agent)} reduced={reduced || drag?.ref === agent.ref} scale={iso.scale}>
            <AgentPlate agent={agent} width={plateWidth} size={size} side={plates.get(agent.ref)?.side ?? 'below'} shift={plates.get(agent.ref)?.shift ?? 0} active={activeRef === agent.ref} onActivate={activate(agent)} />
          </PlacedAgent>
        ))}
      </svg>
      {editing && (
        <>
          <p id={helpId} className="sr-only">
            Layout editing. Press Enter on an agent to pick it up, use the arrow keys to choose a seat, Enter to place it and Escape to cancel. You can also drag agents to a seat.
          </p>
          <p className="sr-only" role="status">
            {status}
          </p>
        </>
      )}
    </div>
  );
}

/** Seat outlines while editing, with the drop target lit. */
function SeatMarks({ iso, seats, target }: { iso: Iso; seats: readonly Seat[]; target: string | undefined }) {
  return (
    <g className="room-seats" aria-hidden="true">
      {seats.map((seat) => {
        const anchor = seat.kind === 'desk' ? deskOf(seat) : seat;
        const at = iso.at(anchor.x, anchor.y);
        const lit = seat.id === target;
        return (
          <g key={seat.id} data-seat={seat.id}>
            <ellipse className={cn(lit ? 'fill-accent/25 stroke-accent' : 'stroke-border-strong')} fill={lit ? undefined : 'none'} strokeDasharray="5 4" strokeWidth={1.5} cx={at.x} cy={at.y} rx={26 * iso.scale} ry={13 * iso.scale} />
          </g>
        );
      })}
    </g>
  );
}

interface ArcShape {
  arc: SceneArc;
  from: Point;
  to: Point;
  control: Point;
  middle: Point;
}

/** Each arc as a curve that rises over the heads between its ends, with its label at the top. */
function arcShapes(arcs: readonly SceneArc[], head: (ref: string) => Point | null, shelf: Point, scale: number, size: number): ArcShape[] {
  return arcs.flatMap((arc): ArcShape[] => {
    const from = head(arc.from);
    const to = arc.kind === 'delivery' ? shelf : arc.to ? head(arc.to) : null;
    if (!from || !to) return [];
    const lift = Math.max(2 * (34 * size + 18), 28 * scale + Math.hypot(to.x - from.x, to.y - from.y) * 0.22);
    const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
    const middle = { x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x, y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y };
    return [{ arc, from, to, control, middle }];
  });
}

/** Hand-off arcs between agents and delivery arcs to the shelf. */
function Arcs({ shapes }: { shapes: readonly ArcShape[] }) {
  return (
    <g className="room-arcs" aria-hidden="true">
      {shapes.map(({ arc, from, to, control, middle }) => {
        const tone = arc.kind === 'delivery' ? 'stroke-signal' : 'stroke-accent';
        return (
          <g key={arc.id} data-arc={arc.kind}>
            <path className={cn('fx-dash-flow', tone)} fill="none" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" d={`M${from.x},${from.y} Q${control.x},${control.y} ${to.x},${to.y}`} />
            <circle className={arc.kind === 'delivery' ? 'fill-signal' : 'fill-accent'} cx={to.x} cy={to.y} r={3.5} />
            {/* A delivery's words are on its agent's plate; a hand-off names what it asks for. */}
            {arc.kind === 'handoff' && (
              <foreignObject x={middle.x - 90} y={middle.y - 14} width={180} height={28}>
                <div className="room-arc-label border border-accent/60 bg-surface-raised text-xs text-text">
                  <span className="room-arc-label__text">{arc.label}</span>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </g>
  );
}

const RING_PLATE = 104;
const RING_SIZE = 0.82;

/** The board's half size in the middle of the ring: as large as fits between the figures and plates. */
function ringBoard(points: readonly Point[], center: Point, start: { hw: number; hh: number }): { hw: number; hh: number } {
  let { hw, hh } = start;
  const clear = () =>
    points.every((point) => {
      const left = point.x - RING_PLATE / 2 - 4;
      const right = point.x + RING_PLATE / 2 + 4;
      const top = point.y - 64 * RING_SIZE - 4;
      const bottom = point.y + 8 + 44 + 4;
      return right < center.x - hw || left > center.x + hw || bottom < center.y - hh || top > center.y + hh;
    });
  while (!clear() && hw > 40) {
    hw *= 0.94;
    hh *= 0.94;
  }
  return { hw, hh };
}

/** Phones: the display wall in the middle and the team in a ring around it. */
function RoomRing({ agents, wall = {}, onSelect, activeRef, onActiveChange, label, width }: RoomSceneProps & { width: number }) {
  const reduced = useReducedMotion();
  const { register, move } = useAvatarFocus(agents);
  const w = Math.max(300, width || 360);
  const rx = w / 2 - RING_PLATE / 2 - 4;
  const ry = rx * 1.45;
  const cx = w / 2;
  const cy = ry + 64;
  const h = Math.round(cy + ry + 60);
  const points = agents.map((_, index): Point => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, agents.length);
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
  const board = ringBoard(points, { x: cx, y: cy }, { hw: rx - 8, hh: Math.min(ry - 40, 110) });
  return (
    <div className="room-scene__frame">
      <svg className="room-scene__svg" role="group" aria-label={label ?? 'Conversation room'} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <ellipse className="fill-surface-sunken stroke-accent/30" strokeWidth={1} cx={cx} cy={cy} rx={rx} ry={ry} aria-hidden="true" />
        <foreignObject x={cx - board.hw} y={cy - board.hh} width={board.hw * 2} height={board.hh * 2} aria-hidden="true">
          <DisplayBoard wall={wall} compact />
        </foreignObject>
        {agents.map((agent, index) => (
          <PlacedAgent key={agent.ref} target={points[index]!} reduced={reduced} scale={w}>
            <Avatar
              agent={agent}
              size={RING_SIZE}
              active={activeRef === agent.ref}
              editing={false}
              carrying={false}
              avatarRef={register(agent.ref)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(agent.ref);
                  return;
                }
                move(event, agent.ref);
              }}
              onActivate={() => onSelect?.(agent.ref)}
              onFocus={() => onActiveChange?.(agent.ref)}
            />
            <AgentPlate agent={agent} width={RING_PLATE} size={RING_SIZE} side="below" active={activeRef === agent.ref} onActivate={() => onSelect?.(agent.ref)} />
          </PlacedAgent>
        ))}
      </svg>
    </div>
  );
}

export function RoomScene({ variant = 'auto', ...props }: RoomSceneProps) {
  const narrow = useNarrowScreen();
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const ring = variant === 'ring' || (variant === 'auto' && narrow);
  return (
    <div ref={frameRef} className={cn('room-scene', ring ? 'room-scene--ring' : 'room-scene--iso')} data-variant={ring ? 'ring' : 'scene'}>
      {ring ? <RoomRing {...props} width={width} /> : <IsoRoom {...props} width={width} />}
    </div>
  );
}
