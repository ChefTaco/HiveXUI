// The room page's live data: the open conversation's transcript, agent presence, the project's tasks
// and its deliverables, all read from the Studio service and kept current by the project stream.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { messageSchema, taskSchema } from '@contracts/ardentstudio.generated';
import { listDeliverables, listMessages, listTasks, type Deliverable, type Message, type Snapshot, type Task } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import { emptyRoomPresence, nextRoomChange, pruneRoomPresence, reduceRoomPresence, type RoomPresenceState } from './room-presence';
import { emptyTranscript, reduceTranscript, type TranscriptState } from './transcript-state';

/** At most this many pages of 200 messages are read for one conversation. */
const MAX_PAGES = 20;

/** Every message of a conversation, oldest first. */
export async function readConversation(conversationId: string, signal?: AbortSignal): Promise<Message[]> {
  const messages: Message[] = [];
  let after = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listMessages(conversationId, after, signal);
    messages.push(...result.messages);
    if (result.next_after === null) break;
    after = result.next_after;
  }
  return messages;
}

/** The transcript of one conversation: read in full, then followed through the stream. */
export function useTranscript(store: ProjectStore, conversationId: string | null): { transcript: TranscriptState; reload: () => void } {
  const [transcript, dispatch] = useReducer(reduceTranscript, conversationId, emptyTranscript);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    dispatch({ type: 'open', conversationId });
    // A reply already streaming when the conversation opened starts from its whole text so far.
    for (const delta of store.liveDeltas()) dispatch({ type: 'delta', delta });
  }, [conversationId, store]);
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    readConversation(conversationId, controller.signal).then(
      (messages) => {
        if (!controller.signal.aborted) dispatch({ type: 'loaded', conversationId, messages });
      },
      () => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', conversationId });
      },
    );
    return () => controller.abort();
  }, [conversationId, generation]);
  useEffect(() => {
    const offEvent = store.onEvent((event) => {
      if (event.type !== 'message.created' && event.type !== 'message.updated') return;
      const parsed = messageSchema.safeParse(event.payload.message);
      if (parsed.success) dispatch({ type: 'message', message: parsed.data });
    });
    const offDelta = store.onDelta((delta) => dispatch({ type: 'delta', delta }));
    // The stream lost its place: messages may be missing, so the conversation is read again.
    const offReset = store.onReset(() => {
      dispatch({ type: 'reset' });
      reload();
    });
    return () => {
      offEvent();
      offDelta();
      offReset();
    };
  }, [store, reload]);
  return { transcript, reload };
}

/** Agent ref by binding id, from the team revisions and the stored activity. */
export function bindingAgents(snapshot: Snapshot): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of snapshot.activity) map.set(item.binding_id, item.agent_ref);
  for (const revision of [snapshot.team.current, snapshot.team.draft])
    for (const role of revision?.body.roles ?? []) if (role.binding_id && role.agent_ref) map.set(role.binding_id, role.agent_ref);
  return map;
}

const authorAgent = (message: Message, agents: Map<string, string>): string | null => (message.author.kind === 'agent' ? (agents.get(message.author.binding_id) ?? null) : null);

/** Presence for the scene: stored activity, live replies, and hand-off and delivery arcs. */
export function useRoomPresence(store: ProjectStore, snapshot: Snapshot, transcript: TranscriptState, deliverables: readonly Deliverable[] | null, clock: () => number = Date.now): { presence: RoomPresenceState; now: number } {
  const [presence, dispatch] = useReducer(
    (state: RoomPresenceState, event: Parameters<typeof reduceRoomPresence>[1] | { type: 'prune'; at: number }) => (event.type === 'prune' ? pruneRoomPresence(state, event.at) : reduceRoomPresence(state, event)),
    undefined,
    emptyRoomPresence,
  );
  const agents = useMemo(() => bindingAgents(snapshot), [snapshot]);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  useEffect(() => dispatch({ type: 'activity', items: snapshot.activity }), [snapshot.activity]);
  // Replies already in the transcript tell whose a later delta is.
  useEffect(() => {
    for (const message of transcript.messages) {
      const agent = authorAgent(message, agentsRef.current);
      if (agent && message.state === 'streaming') dispatch({ type: 'message', message, agent, at: clock() });
    }
  }, [transcript.messages, clock]);
  useEffect(() => {
    const offEvent = store.onEvent((event) => {
      if (event.type !== 'message.created' && event.type !== 'message.updated') return;
      const parsed = messageSchema.safeParse(event.payload.message);
      if (parsed.success) dispatch({ type: 'message', message: parsed.data, agent: authorAgent(parsed.data, agentsRef.current), at: clock() });
    });
    const offDelta = store.onDelta((delta) => dispatch({ type: 'delta', messageId: delta.message_id, at: clock() }));
    return () => {
      offEvent();
      offDelta();
    };
  }, [store, clock]);
  // A delivery arc for each revision that arrives while the room is open; the first read is history.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!deliverables) return;
    const revisions = deliverables.flatMap((deliverable) => deliverable.revisions.map((revision) => ({ deliverable, revision })));
    if (seen.current === null) {
      seen.current = new Set(revisions.map((item) => item.revision.id));
      return;
    }
    for (const { deliverable, revision } of revisions) {
      if (seen.current.has(revision.id)) continue;
      seen.current.add(revision.id);
      const agent = revision.producer_binding_id ? agentsRef.current.get(revision.producer_binding_id) : undefined;
      if (agent) dispatch({ type: 'delivery', id: revision.id, agent, label: `Delivered ${deliverable.name} rev ${revision.revision}`, at: clock() });
    }
  }, [deliverables, clock]);
  // Re-render when "Replied" or an arc runs out.
  const [tick, setTick] = useState(0);
  const now = useMemo(() => clock(), [presence, tick, clock]);
  useEffect(() => {
    const next = nextRoomChange(presence, now);
    if (next === null) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'prune', at: clock() });
      setTick((value) => value + 1);
    }, Math.max(0, next - now));
    return () => clearTimeout(timer);
  }, [presence, now, clock]);
  return { presence, now };
}

/** Every task of the project: the full list once, then the snapshot's live copies on top. */
export function useRoomTasks(store: ProjectStore, snapshot: Snapshot): { tasks: Task[]; error: unknown; retry: () => void } {
  const [history, setHistory] = useState<Task[]>([]);
  const [error, setError] = useState<unknown>(undefined);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    listTasks(store.projectId, { state: 'all' }, controller.signal).then(
      (tasks) => {
        if (controller.signal.aborted) return;
        setHistory(tasks);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setError(failure);
      },
    );
    return () => controller.abort();
  }, [store, generation]);
  useEffect(() => store.onReset(retry), [store, retry]);
  // The snapshot drops a task when it finishes; its events keep the finished copy here.
  const [updates, setUpdates] = useState<ReadonlyMap<string, Task>>(new Map());
  useEffect(
    () =>
      store.onEvent((event) => {
        if (event.type !== 'task.created' && event.type !== 'task.updated') return;
        const parsed = taskSchema.safeParse(event.payload.task);
        if (parsed.success) setUpdates((current) => new Map(current).set(parsed.data.id, parsed.data));
      }),
    [store],
  );
  const tasks = useMemo(() => {
    const byId = new Map(history.map((task) => [task.id, task] as const));
    for (const task of [...snapshot.tasks, ...updates.values()]) {
      const known = byId.get(task.id);
      if (!known || known.updated_at <= task.updated_at) byId.set(task.id, task);
    }
    return [...byId.values()];
  }, [history, snapshot.tasks, updates]);
  return { tasks, error, retry };
}

/** The project's deliverables, read again when a revision or a deliverable changes. Null until the first read. */
export function useDeliverables(store: ProjectStore): Deliverable[] | null {
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    listDeliverables(store.projectId, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setDeliverables(result.deliverables);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [store, generation]);
  useEffect(() => {
    const offEvent = store.onEvent((event) => {
      if (event.type === 'deliverable.revision.created' || event.type === 'deliverable.updated') setGeneration((value) => value + 1);
    });
    const offReset = store.onReset(() => setGeneration((value) => value + 1));
    return () => {
      offEvent();
      offReset();
    };
  }, [store]);
  return deliverables;
}
