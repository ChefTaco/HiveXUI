import { describe, expect, it } from 'vitest';
import { adjacentSeat, defaultRoomLayout, homeSeats, isoProjection, MAX_DESKS, moveAgent, roomSeats, seatNear, stagePositions } from './geometry';
import { AnnouncementThrottle, ANNOUNCE_INTERVAL_MS } from './live';
import { defaultPortrait, PORTRAIT_ACCENTS, PORTRAIT_EMBLEMS, PORTRAIT_PRESETS } from './model';
import { labelBox, PLATE_H, placePlates, plateBox } from './plates';

const refs = (count: number) => Array.from({ length: count }, (_, index) => `node-1~agent-${index + 1}`);

describe('the room layout', () => {
  it('has eight desks, eight table seats and a review station', () => {
    const seats = roomSeats();
    expect(seats.filter((seat) => seat.kind === 'desk')).toHaveLength(MAX_DESKS);
    expect(seats.filter((seat) => seat.kind === 'table')).toHaveLength(8);
    expect(seats.filter((seat) => seat.kind === 'review')).toHaveLength(1);
    expect(new Set(seats.map((seat) => seat.id)).size).toBe(seats.length);
  });

  it('gives a small team desks on both walls, and overflow seats at the table', () => {
    const three = defaultRoomLayout(refs(3));
    const zones = three.placements.map((placement) => three.seats.find((seat) => seat.id === placement.seat)!.zone);
    expect(new Set(zones)).toEqual(new Set(['desks-east', 'desks-west']));
    const ten = defaultRoomLayout(refs(10));
    expect(ten.placements.slice(8).map((placement) => placement.seat)).toEqual(['table-1', 'table-2']);
    expect(new Set(ten.placements.map((placement) => placement.seat)).size).toBe(10);
  });

  it('moves an agent to a free seat, or swaps with whoever sits there', () => {
    const layout = defaultRoomLayout(refs(2));
    const [a, b] = layout.placements.map((placement) => placement.seat);
    expect(moveAgent(layout, 'node-1~agent-1', 'table-4').placements[0]).toEqual({ agent: 'node-1~agent-1', seat: 'table-4' });
    expect(moveAgent(layout, 'node-1~agent-1', b!).placements).toEqual([
      { agent: 'node-1~agent-1', seat: b },
      { agent: 'node-1~agent-2', seat: a },
    ]);
    expect(moveAgent(layout, 'node-1~agent-1', a!)).toBe(layout);
    expect(moveAgent(layout, 'node-1~agent-1', 'nowhere')).toBe(layout);
    expect(moveAgent(layout, 'node-1~nobody', 'table-1')).toBe(layout);
  });

  it('finds the next seat on screen in each direction, and none past the edge', () => {
    const seats = homeSeats(defaultRoomLayout([]));
    const desk1 = seats.find((seat) => seat.id === 'desk-1')!;
    expect(adjacentSeat(seats, desk1, 'left')?.id).toBe('desk-2');
    const front = seats.find((seat) => seat.id === 'table-1')!;
    expect(adjacentSeat(seats, front, 'down')).toBeNull();
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      const next = adjacentSeat(seats, front, direction);
      if (next) expect(next.id).not.toBe(front.id);
    }
  });

  it('finds the seat under a drop point, within reach', () => {
    const iso = isoProjection(1);
    const seats = homeSeats(defaultRoomLayout([]));
    const table = seats.find((seat) => seat.id === 'table-5')!;
    const point = iso.at(table.x, table.y);
    expect(seatNear(seats, { x: point.x + 5, y: point.y + 5 }, iso)?.id).toBe('table-5');
    expect(seatNear(seats, { x: -500, y: -500 }, iso)).toBeNull();
  });

  it('gathers a discussion at the table, sends reviewers to the station and keeps everyone else home', () => {
    const layout = defaultRoomLayout(refs(4));
    const agents = layout.placements.map((placement, index) => ({ ref: placement.agent, seat: placement.seat, state: index === 3 ? ('reviewing' as const) : ('working' as const) }));
    const positions = stagePositions(layout, agents, ['node-1~agent-1', 'node-1~agent-2']);
    expect(positions.get('node-1~agent-1')?.seat.kind).toBe('table');
    expect(positions.get('node-1~agent-2')?.seat.kind).toBe('table');
    expect(positions.get('node-1~agent-1')?.seat.id).not.toBe(positions.get('node-1~agent-2')?.seat.id);
    expect(positions.get('node-1~agent-3')?.seat.kind).toBe('desk');
    expect(positions.get('node-1~agent-4')?.seat.kind).toBe('review');
  });
});

describe('name plates', () => {
  it('never overlap, even for a full room', () => {
    const layout = defaultRoomLayout(refs(8));
    const iso = isoProjection(0.77);
    const agents = layout.placements.map((placement) => ({ ref: placement.agent, seat: placement.seat, state: 'working' as const }));
    const positions = stagePositions(layout, agents, refs(5));
    const requests = [...positions].map(([ref, position]) => ({ ref, ...iso.at(position.x, position.y), prefer: 'below' as const }));
    const placements = placePlates(requests, 148, 1.2, iso);
    const rects = requests.map((request) => {
      const placement = placements.get(request.ref)!;
      const box = plateBox(placement.side, 148, 1.2);
      return { left: request.x + box.x, top: request.y + box.y + placement.shift, right: request.x + box.x + 148, bottom: request.y + box.y + placement.shift + PLATE_H };
    });
    for (const [index, a] of rects.entries())
      for (const b of rects.slice(index + 1)) expect(a.left >= b.right || b.left >= a.right || a.top >= b.bottom || b.top >= a.bottom).toBe(true);
  });

  it('keeps clear of a fixed label, such as the discussion table name', () => {
    const label = labelBox(400, 340, 'Discussion table');
    const placement = placePlates([{ ref: 'a', x: 400, y: 300, prefer: 'below' }], 148, 1, { width: 800, height: 600 }, [label]).get('a')!;
    const box = plateBox(placement.side, 148, 1);
    const plate = { left: 400 + box.x, top: 300 + box.y + placement.shift, right: 400 + box.x + 148, bottom: 300 + box.y + placement.shift + PLATE_H };
    expect(plate.right <= label.left || plate.left >= label.right || plate.bottom <= label.top || plate.top >= label.bottom).toBe(true);
  });

  it('does not sit on a neighbouring figure when another side is free', () => {
    // b stands just right of and below a: a's preferred right-hand plate would cover b's state mark and face.
    const placements = placePlates(
      [
        { ref: 'a', x: 300, y: 300, prefer: 'right' },
        { ref: 'b', x: 380, y: 350, prefer: 'below' },
      ],
      148,
      1,
      { width: 800, height: 600 },
    );
    expect(placements.get('a')!.side).not.toBe('right');
  });

  it('keeps the preferred side when it is free', () => {
    const placements = placePlates([{ ref: 'a', x: 400, y: 300, prefer: 'right' }], 148, 1, { width: 800, height: 600 });
    expect(placements.get('a')).toEqual({ side: 'right', shift: 0 });
  });
});

describe('portraits', () => {
  it('are the same for the same agent and vary across agents', () => {
    expect(defaultPortrait('node-1~lead')).toEqual(defaultPortrait('node-1~lead'));
    const many = refs(40).map(defaultPortrait);
    for (const portrait of many) {
      expect(PORTRAIT_PRESETS).toContain(portrait.preset);
      expect(PORTRAIT_ACCENTS).toContain(portrait.accent);
      expect(PORTRAIT_EMBLEMS).toContain(portrait.emblem);
    }
    expect(new Set(many.map((portrait) => portrait.accent)).size).toBeGreaterThan(3);
    expect(new Set(many.map((portrait) => portrait.preset)).size).toBeGreaterThan(3);
  });
});

describe('the announcement throttle', () => {
  it('lets one announcement per agent through every interval and keeps the latest of the rest', () => {
    const throttle = new AnnouncementThrottle();
    expect(throttle.offer('a', 'A1', 0)).toBe('A1');
    expect(throttle.offer('b', 'B1', 10)).toBe('B1');
    expect(throttle.offer('a', 'A2', 100)).toBeNull();
    expect(throttle.offer('a', 'A3', 200)).toBeNull();
    expect(throttle.nextDue()).toBe(ANNOUNCE_INTERVAL_MS);
    expect(throttle.due(ANNOUNCE_INTERVAL_MS - 1)).toEqual({ ready: [], next: ANNOUNCE_INTERVAL_MS });
    expect(throttle.due(ANNOUNCE_INTERVAL_MS)).toEqual({ ready: ['A3'], next: null });
    expect(throttle.offer('a', 'A4', ANNOUNCE_INTERVAL_MS + 1)).toBeNull();
    throttle.forget('a');
    expect(throttle.nextDue()).toBeNull();
  });
});
