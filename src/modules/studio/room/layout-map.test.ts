import { describe, expect, it } from 'vitest';
import { PROJECT_ID } from '../test-fixtures';
import { layoutRequest, sceneLayout } from './layout-map';
import { defaultRoomLayout, moveAgent } from './scene/geometry';

const seated = [
  { ref: 'node-1~lead', role: 'lead' },
  { ref: 'node-1~world', role: 'world' },
];

describe('the room layout record', () => {
  it('starts from the first layout when none is saved', () => {
    expect(sceneLayout(null, seated)).toEqual(defaultRoomLayout(['node-1~lead', 'node-1~world']));
  });

  it('saves placements by role with the base revision, and reads them back the same', () => {
    const edited = { ...moveAgent(sceneLayout(null, seated), 'node-1~world', 'table-3'), zoneLabels: { ...sceneLayout(null, seated).zoneLabels, table: 'Round table ' } };
    const request = layoutRequest(edited, seated, 4);
    expect(request.base_revision).toBe(4);
    expect(request.placements).toContainEqual({ role_key: 'world', seat_id: 'table-3' });
    expect(request.seats.find((seat) => seat.id === 'table-3')?.kind).toBe('discussion');
    expect(request.zone_labels?.table).toBe('Round table');
    const saved = { project_id: PROJECT_ID, revision: 5, seats: request.seats, placements: request.placements!, zone_labels: request.zone_labels!, created_by: 'operator', created_at: '2026-11-08T10:00:00.000Z' };
    const back = sceneLayout(saved, seated);
    expect(back.placements).toEqual(edited.placements);
    expect(back.seats).toEqual(edited.seats);
  });

  it('seats an agent the saved layout does not place at a free desk', () => {
    const request = layoutRequest(sceneLayout(null, seated.slice(0, 1)), seated.slice(0, 1), null);
    const saved = { project_id: PROJECT_ID, revision: 1, seats: request.seats, placements: request.placements!, zone_labels: {}, created_by: 'operator', created_at: '2026-11-08T10:00:00.000Z' };
    const placements = sceneLayout(saved, seated).placements;
    expect(placements).toHaveLength(2);
    expect(placements[1]!.seat).toMatch(/^desk-/);
    expect(placements[1]!.seat).not.toBe(placements[0]!.seat);
  });
});
