import { describe, expect, it } from 'vitest';
import { activityStateSchema } from '@contracts/ardentstudio.generated';
import { activity, BINDING, message, messageId } from '../test-fixtures';
import { emptyRoomPresence, nextRoomChange, reduceRoomPresence, roomArcs, roomPresenceOf, type RoomPresenceEvent } from './room-presence';
import { AGENT_STATES } from './scene/model';
import { ARC_HOLD_MS, SPEAKING_HOLD_MS } from './scene/presence';

const LEAD = 'node-1~lead';
const WORLD = 'node-1~world';
const fold = (events: RoomPresenceEvent[]) => events.reduce(reduceRoomPresence, emptyRoomPresence());
const agentReply = (state: 'streaming' | 'complete', extra = {}) => message({ id: messageId(2), author: { kind: 'agent', binding_id: BINDING.lead, role_key: 'lead' }, kind: 'reply', state, ...extra });

describe('room presence', () => {
  it('shows the stored activity, and says when nothing was checked yet', () => {
    const state = fold([{ type: 'activity', items: [activity({ state: 'working', label: 'Working: plan' })] }]);
    expect(roomPresenceOf(state, LEAD, 0)).toMatchObject({ state: 'working', label: 'Working: plan' });
    expect(roomPresenceOf(state, WORLD, 0)).toMatchObject({ state: 'unknown', label: 'Status not checked yet' });
  });

  it('shows every state the service sends as sent, with its label, including Blocked', () => {
    for (const state of activityStateSchema.options) {
      expect(AGENT_STATES).toContain(state);
      const folded = fold([{ type: 'presence', activity: activity({ state, label: `Label for ${state}` }) }]);
      expect(roomPresenceOf(folded, LEAD, 0)).toMatchObject({ state, label: `Label for ${state}` });
    }
    const blocked = fold([{ type: 'activity', items: [activity({ state: 'blocked', label: 'Blocked: The model provider refused the request' })] }]);
    expect(roomPresenceOf(blocked, LEAD, 0)).toMatchObject({ state: 'blocked', label: 'Blocked: The model provider refused the request' });
    // Only the live reply stream is laid over it.
    const speaking = reduceRoomPresence(blocked, { type: 'message', message: agentReply('streaming'), agent: LEAD, at: 5 });
    expect(roomPresenceOf(speaking, LEAD, 6)).toMatchObject({ state: 'speaking', label: 'Replying…' });
  });

  it('speaks while a reply streams and holds "Replied" for a moment after its final message', () => {
    let state = fold([{ type: 'activity', items: [activity()] }, { type: 'message', message: agentReply('streaming'), agent: LEAD, at: 100 }]);
    expect(roomPresenceOf(state, LEAD, 150)).toMatchObject({ state: 'speaking', label: 'Replying…' });
    state = reduceRoomPresence(state, { type: 'message', message: agentReply('complete'), agent: LEAD, at: 1_000 });
    expect(roomPresenceOf(state, LEAD, 1_000 + SPEAKING_HOLD_MS - 1)).toMatchObject({ label: 'Replied' });
    expect(nextRoomChange(state, 1_000)).toBe(1_000 + SPEAKING_HOLD_MS);
    expect(roomPresenceOf(state, LEAD, 1_000 + SPEAKING_HOLD_MS)).toMatchObject({ state: 'available' });
  });

  it('puts a bare delta on the agent whose reply it is', () => {
    let state = fold([{ type: 'message', message: agentReply('complete', { id: messageId(3) }), agent: LEAD, at: 1 }]);
    state = reduceRoomPresence(state, { type: 'delta', messageId: messageId(3), at: 50 });
    expect(roomPresenceOf(state, LEAD, 60)).toMatchObject({ label: 'Replying…' });
    expect(reduceRoomPresence(state, { type: 'delta', messageId: messageId(8), at: 70 })).toBe(state);
  });

  it('draws allowed hand-offs and deliveries, never refused ones, and lets them run out', () => {
    const handoff = (allowed: boolean, n: number) => message({ id: messageId(n), author: { kind: 'agent', binding_id: BINDING.lead, role_key: 'lead' }, kind: 'handoff', links: { handoff: { to_role: 'world', objective: 'Name the regions', allowed } } });
    const state = fold([
      { type: 'message', message: handoff(true, 4), agent: LEAD, at: 10 },
      { type: 'message', message: handoff(false, 5), agent: LEAD, at: 10 },
      { type: 'delivery', id: 'drv_1', agent: WORLD, label: 'Delivered map rev 2', at: 10 },
    ]);
    const forRole = (role: string) => (role === 'world' ? WORLD : undefined);
    expect(roomArcs(state, 20, forRole)).toEqual([
      { id: messageId(4), kind: 'handoff', from: LEAD, to: WORLD, label: 'Name the regions' },
      { id: 'drv_1', kind: 'delivery', from: WORLD, label: 'Delivered map rev 2' },
    ]);
    expect(roomArcs(state, 10 + ARC_HOLD_MS, forRole)).toEqual([]);
  });
});
