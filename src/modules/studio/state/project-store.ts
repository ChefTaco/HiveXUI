// One project's live state: its snapshot (project, files, team) kept current by the project stream.
// Pages share a store per project id, so the header, the Files drawer and Team Assignment read the
// same copy and the stream is opened once.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { activitySchema, conversationSchema, decisionSchema, fileSchema, projectCountsSchema, referenceLinkSchema, taskSchema, teamProposalRecordSchema } from '@contracts/ardentstudio.generated';
import type { StreamHandle, StreamState } from '../../magnus/api/stream';
import type { SseEvent } from '../../magnus/api/sse';
import { getSnapshot, type Project, type ReferenceLink, type Snapshot, type StudioFile, type TeamProposalRecord, type TeamState } from '../api/endpoints';
import { openProjectStream, reduceStreamFrame, type MessageDelta, type ProjectEvent } from '../api/stream';
import { StudioApiError } from '../api/client';

export interface ProjectState {
  status: 'loading' | 'ready' | 'missing' | 'error';
  snapshot: Snapshot | null;
  error: unknown;
  /** The last applied event. Every snapshot resets it to the snapshot's own. */
  seq: number;
  stream: StreamState | 'idle';
  streamDetail: string | null;
  /** A snapshot read is in flight while one is already shown. */
  refreshing: boolean;
}

const knowledgeSchema = fileSchema.shape.knowledge;
/** Events whose payload is enough to patch the copy; anything else re-reads the snapshot. */
const REFETCH_DELAY_MS = 150;
/**
 * Records that move the summary's last activity without a counts event. The summary is re-read with
 * the snapshot after a longer pause, so a burst of room messages costs one read.
 */
export const SUMMARY_EVENTS: ReadonlySet<string> = new Set([
  'message.created',
  'decision.created',
  'deliverable.revision.created',
  'review.decision.created',
  'file.created',
  'link.created',
  'team.revision.published',
  'export.created',
]);
const SUMMARY_REFETCH_DELAY_MS = 1500;
const OPEN_PROPOSAL = new Set<TeamProposalRecord['state']>(['queued', 'running']);

export interface ProjectStoreOptions {
  load?: (projectId: string, signal: AbortSignal) => Promise<Snapshot>;
  stream?: typeof openProjectStream;
}

export class ProjectStore {
  private state: ProjectState = { status: 'loading', snapshot: null, error: undefined, seq: 0, stream: 'idle', streamDetail: null, refreshing: false };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: ProjectEvent) => void>();
  private readonly deltaListeners = new Set<(delta: MessageDelta) => void>();
  private readonly resetListeners = new Set<() => void>();
  /** The live text of each reply still streaming, so a page opened mid-reply starts from all of it. */
  private readonly live = new Map<string, { step: number; text: string }>();
  private handle: StreamHandle | null = null;
  private loading: AbortController | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;
  private refetchDue = false;
  private stopped = false;
  private readonly load: NonNullable<ProjectStoreOptions['load']>;
  private readonly stream: typeof openProjectStream;

  constructor(readonly projectId: string, options: ProjectStoreOptions = {}) {
    this.load = options.load ?? ((id, signal) => getSnapshot(id, signal));
    this.stream = options.stream ?? openProjectStream;
  }

  getState = (): ProjectState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Persisted events after they are applied, for pages that keep their own lists. */
  onEvent(listener: (event: ProjectEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  onDelta(listener: (delta: MessageDelta) => void): () => void {
    this.deltaListeners.add(listener);
    return () => this.deltaListeners.delete(listener);
  }
  /** Live text of the replies streaming now, as replace deltas a new listener can start from. */
  liveDeltas(): MessageDelta[] {
    return [...this.live].map(([id, entry]) => ({ message_id: id, text: entry.text, mode: 'replace', step: entry.step }));
  }
  /** The stream lost its place (a reset or a skipped seq): pages that keep their own lists read them again. */
  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  private set(next: Partial<ProjectState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  /** Loads the snapshot, then follows the stream from its seq. Also the Retry after a failed load. */
  start(): void {
    this.stopped = false;
    void this.refetch();
  }

  private follow(): void {
    if (this.stopped || this.handle) return;
    this.handle = this.stream({
      projectId: this.projectId,
      cursor: () => this.state.seq,
      onFrame: (frame) => this.receive(frame),
      onState: (stream, detail) => this.set({ stream, streamDetail: detail ?? null }),
    });
  }

  stop(): void {
    this.stopped = true;
    this.live.clear();
    clearTimeout(this.refetchTimer);
    this.loading?.abort();
    this.handle?.close();
    this.handle = null;
  }

  /** Re-reads the snapshot. Concurrent calls share the newest read. */
  async refetch(): Promise<void> {
    clearTimeout(this.refetchTimer);
    this.refetchDue = false;
    this.loading?.abort();
    const controller = new AbortController();
    this.loading = controller;
    if (this.state.snapshot) this.set({ refreshing: true });
    try {
      const snapshot = await this.load(this.projectId, controller.signal);
      if (controller.signal.aborted) return;
      this.set({ status: 'ready', snapshot, seq: snapshot.seq, error: undefined, refreshing: false });
      this.follow();
    } catch (error) {
      if (controller.signal.aborted) return;
      const missing = error instanceof StudioApiError && error.notFound;
      // A failed refresh keeps the last good copy on screen; the error says why it may be stale.
      this.set({ status: this.state.snapshot && !missing ? 'ready' : missing ? 'missing' : 'error', error, refreshing: false });
    }
  }

  /** Debounced by default; a throttled request leaves a read that is already due in place. */
  private scheduleRefetch(delay = REFETCH_DELAY_MS, throttle = false): void {
    if (throttle && this.refetchDue) return;
    clearTimeout(this.refetchTimer);
    this.refetchDue = true;
    this.refetchTimer = setTimeout(() => void this.refetch(), delay);
  }

  /** One SSE frame. Public for tests and for pages that replay frames they hold. */
  receive(frame: SseEvent): void {
    const { seq, action } = reduceStreamFrame(this.state.seq, frame);
    switch (action.kind) {
      case 'ignore':
        return;
      case 'delta': {
        const { message_id: id, text, mode = 'append', step = 0 } = action.delta;
        const current = this.live.get(id);
        if (!current || mode === 'replace' || step > current.step) this.live.set(id, { step, text });
        else if (step === current.step) this.live.set(id, { step, text: current.text + text });
        for (const listener of [...this.deltaListeners]) listener(action.delta);
        return;
      }
      case 'reset':
        void this.refetch();
        for (const listener of [...this.resetListeners]) listener();
        return;
      case 'event':
        if (action.event.type === 'message.updated' || action.event.type === 'message.created') {
          const message = action.event.payload.message as { id?: unknown; state?: unknown } | undefined;
          if (typeof message?.id === 'string' && message.state !== 'streaming') this.live.delete(message.id);
        }
        this.apply(seq, action.event);
        for (const listener of [...this.eventListeners]) listener(action.event);
    }
  }

  private apply(seq: number, event: ProjectEvent): void {
    const snapshot = this.state.snapshot;
    if (event.type === 'file.updated' && snapshot) {
      const knowledge = knowledgeSchema.safeParse(event.payload.knowledge);
      const known = snapshot.files.some((file) => file.id === event.payload.file_id);
      if (knowledge.success && known) {
        this.set({ seq, snapshot: { ...snapshot, seq, files: snapshot.files.map((file) => (file.id === event.payload.file_id ? { ...file, knowledge: knowledge.data } : file)) } });
        return;
      }
    }
    // A counts change carries the counts; nothing else about the project moved.
    if (event.type === 'project.updated' && snapshot && Array.isArray(event.payload.fields) && event.payload.fields.length === 1 && event.payload.fields[0] === 'counts') {
      const counts = projectCountsSchema.safeParse(event.payload.counts);
      if (counts.success) {
        this.set({ seq, snapshot: { ...snapshot, seq, summary: { ...snapshot.summary, ...counts.data } } });
        return;
      }
    }
    if (/^link\./.test(event.type) && snapshot) {
      const link = referenceLinkSchema.safeParse(event.payload.link);
      if (link.success) {
        const links = event.type === 'link.deleted' || link.data.deleted_at ? snapshot.links.filter((item) => item.id !== link.data.id) : upsert(snapshot.links, link.data);
        this.set({ seq, snapshot: { ...snapshot, seq, links } });
        if (SUMMARY_EVENTS.has(event.type)) this.scheduleRefetch(SUMMARY_REFETCH_DELAY_MS, true);
        return;
      }
    }
    if (event.type === 'team.proposal.updated' && snapshot) {
      const proposal = teamProposalRecordSchema.safeParse(event.payload.proposal);
      if (proposal.success) {
        const rest = snapshot.team_proposals.filter((item) => item.id !== proposal.data.id);
        this.set({ seq, snapshot: { ...snapshot, seq, team_proposals: OPEN_PROPOSAL.has(proposal.data.state) ? [proposal.data, ...rest] : rest } });
        return;
      }
    }
    const patched = snapshot ? patchSnapshot(snapshot, event) : null;
    if (patched) {
      this.set({ seq, snapshot: { ...patched, seq } });
      if (SUMMARY_EVENTS.has(event.type)) this.scheduleRefetch(SUMMARY_REFETCH_DELAY_MS, true);
      return;
    }
    this.set({ seq });
    // Project, file, team and layout events carry only what changed, and so does a task event this copy
    // could not read: the snapshot holds the whole record.
    if (/^(project|file|team|task|layout)\./.test(event.type)) this.scheduleRefetch();
    else if (SUMMARY_EVENTS.has(event.type)) this.scheduleRefetch(SUMMARY_REFETCH_DELAY_MS, true);
  }

  // After a mutation the answer is applied at once; the event that follows confirms it.
  setProject(project: Project): void {
    if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, project } });
  }
  setTeam(team: TeamState): void {
    if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, team } });
  }
  /** A room record a mutation answered with, ahead of its event. */
  upsertRecord(kind: 'conversations' | 'tasks' | 'decisions', record: Snapshot['conversations'][number] | Snapshot['tasks'][number] | Snapshot['decisions'][number]): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (kind === 'tasks') {
      const task = record as Snapshot['tasks'][number];
      const tasks = SNAPSHOT_TASK_STATES.has(task.state) ? upsert(snapshot.tasks, task) : snapshot.tasks.filter((item) => item.id !== task.id);
      this.set({ snapshot: { ...snapshot, tasks } });
      return;
    }
    this.set({ snapshot: { ...snapshot, [kind]: upsert(snapshot[kind] as Array<typeof record>, record) } });
  }
  setLayout(layout: Snapshot['layout']): void {
    if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, layout } });
  }
  upsertLink(link: ReferenceLink): void {
    const snapshot = this.state.snapshot;
    if (snapshot) this.set({ snapshot: { ...snapshot, links: link.deleted_at ? snapshot.links.filter((item) => item.id !== link.id) : upsert(snapshot.links, link) } });
  }
  upsertFile(file: StudioFile): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const files = snapshot.files.some((item) => item.id === file.id) ? snapshot.files.map((item) => (item.id === file.id ? file : item)) : [...snapshot.files, file];
    this.set({ snapshot: { ...snapshot, files } });
  }
}

const upsert = <T extends { id: string }>(items: readonly T[], item: T): T[] =>
  items.some((existing) => existing.id === item.id) ? items.map((existing) => (existing.id === item.id ? item : existing)) : [...items, item];

const SNAPSHOT_TASK_STATES: ReadonlySet<string> = new Set(['queued', 'running', 'input_required', 'pausing', 'paused']);

/** The snapshot with a room record from an event's payload, or null when the event carries no whole record. */
export function patchSnapshot(snapshot: Snapshot, event: ProjectEvent): Snapshot | null {
  const payload = event.payload;
  if (event.type === 'conversation.created' || event.type === 'conversation.updated') {
    const parsed = conversationSchema.safeParse(payload.conversation);
    return parsed.success ? { ...snapshot, conversations: upsert(snapshot.conversations, parsed.data) } : null;
  }
  if (event.type === 'task.created' || event.type === 'task.updated') {
    const parsed = taskSchema.safeParse(payload.task);
    if (!parsed.success) return null;
    // The snapshot holds active tasks and those waiting for an answer; a finished one leaves it.
    const tasks = SNAPSHOT_TASK_STATES.has(parsed.data.state) ? upsert(snapshot.tasks, parsed.data) : snapshot.tasks.filter((task) => task.id !== parsed.data.id);
    return { ...snapshot, tasks };
  }
  if (event.type === 'decision.created' || event.type === 'decision.updated') {
    const parsed = decisionSchema.safeParse(payload.decision);
    return parsed.success ? { ...snapshot, decisions: upsert(snapshot.decisions, parsed.data) } : null;
  }
  if (event.type === 'presence.updated') {
    const parsed = activitySchema.safeParse(payload);
    if (!parsed.success) return null;
    const others = snapshot.activity.filter((item) => item.binding_id !== parsed.data.binding_id);
    return { ...snapshot, activity: [...others, parsed.data] };
  }
  return null;
}

interface Entry {
  store: ProjectStore;
  users: number;
  release?: ReturnType<typeof setTimeout>;
}
const stores = new Map<string, Entry>();
/** A page change unmounts one user and mounts the next; keep the store across that gap. */
const RELEASE_DELAY_MS = 2000;

/** The shared store for a project, started on first use and stopped shortly after its last user leaves. */
export function acquireProjectStore(projectId: string, create: (id: string) => ProjectStore = (id) => new ProjectStore(id)): { store: ProjectStore; release: () => void } {
  let entry = stores.get(projectId);
  if (!entry) {
    entry = { store: create(projectId), users: 0 };
    stores.set(projectId, entry);
    entry.store.start();
  }
  clearTimeout(entry.release);
  entry.users += 1;
  const current = entry;
  let released = false;
  return {
    store: current.store,
    release: () => {
      if (released) return;
      released = true;
      current.users -= 1;
      if (current.users > 0) return;
      current.release = setTimeout(() => {
        if (current.users > 0) return;
        current.store.stop();
        if (stores.get(projectId) === current) stores.delete(projectId);
      }, RELEASE_DELAY_MS);
    },
  };
}

/** Tests only: stop and forget every store. */
export function resetProjectStores(): void {
  for (const entry of stores.values()) {
    clearTimeout(entry.release);
    entry.store.stop();
  }
  stores.clear();
}

const IDLE: ProjectState = { status: 'loading', snapshot: null, error: undefined, seq: 0, stream: 'idle', streamDetail: null, refreshing: false };
const idleSubscribe = () => () => {};
const idleState = () => IDLE;

/** Like useProject, for a component that may have no project: it then reads nothing. */
export function useOptionalProject(projectId: string | undefined): { state: ProjectState; store: ProjectStore | null } {
  const store = useMemo(() => {
    if (!projectId) return null;
    const acquired = acquireProjectStore(projectId);
    acquired.release();
    return acquired.store;
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    const acquired = acquireProjectStore(projectId);
    return acquired.release;
  }, [projectId]);
  const state = useSyncExternalStore(store?.subscribe ?? idleSubscribe, store?.getState ?? idleState);
  return { state, store };
}

/** The project's live state for a component, and the store for its actions. */
export function useProject(projectId: string): { state: ProjectState; store: ProjectStore } {
  const { state, store } = useOptionalProject(projectId);
  return { state, store: store! };
}
