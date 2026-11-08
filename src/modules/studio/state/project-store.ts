// One project's live state: its snapshot (project, files, team) kept current by the project stream.
// Pages share a store per project id, so the header, the Files drawer and Team Assignment read the
// same copy and the stream is opened once.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fileSchema } from '@contracts/ardentstudio.generated';
import type { StreamHandle, StreamState } from '../../magnus/api/stream';
import type { SseEvent } from '../../magnus/api/sse';
import { getSnapshot, type Project, type Snapshot, type StudioFile, type TeamState } from '../api/endpoints';
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

export interface ProjectStoreOptions {
  load?: (projectId: string, signal: AbortSignal) => Promise<Snapshot>;
  stream?: typeof openProjectStream;
}

export class ProjectStore {
  private state: ProjectState = { status: 'loading', snapshot: null, error: undefined, seq: 0, stream: 'idle', streamDetail: null, refreshing: false };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: ProjectEvent) => void>();
  private readonly deltaListeners = new Set<(delta: MessageDelta) => void>();
  private handle: StreamHandle | null = null;
  private loading: AbortController | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;
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
    clearTimeout(this.refetchTimer);
    this.loading?.abort();
    this.handle?.close();
    this.handle = null;
  }

  /** Re-reads the snapshot. Concurrent calls share the newest read. */
  async refetch(): Promise<void> {
    clearTimeout(this.refetchTimer);
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

  private scheduleRefetch(): void {
    clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => void this.refetch(), REFETCH_DELAY_MS);
  }

  /** One SSE frame. Public for tests and for pages that replay frames they hold. */
  receive(frame: SseEvent): void {
    const { seq, action } = reduceStreamFrame(this.state.seq, frame);
    switch (action.kind) {
      case 'ignore':
        return;
      case 'delta':
        for (const listener of [...this.deltaListeners]) listener(action.delta);
        return;
      case 'reset':
        void this.refetch();
        return;
      case 'event':
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
    this.set({ seq });
    // Project, file, team and task events carry only what changed: the snapshot holds the whole record.
    if (/^(project|file|team|task)\./.test(event.type)) this.scheduleRefetch();
  }

  // After a mutation the answer is applied at once; the event that follows confirms it.
  setProject(project: Project): void {
    if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, project } });
  }
  setTeam(team: TeamState): void {
    if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, team } });
  }
  upsertFile(file: StudioFile): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const files = snapshot.files.some((item) => item.id === file.id) ? snapshot.files.map((item) => (item.id === file.id ? file : item)) : [...snapshot.files, file];
    this.set({ snapshot: { ...snapshot, files } });
  }
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
