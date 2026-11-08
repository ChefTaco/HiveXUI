// The Conversation Room: the visual room beside the transcript, over real records only. The room is
// fed by stored activity and the live reply stream, the transcript by the open conversation's
// messages, and both by the project stream. Deep links: ?c= conversation, ?m= message, ?task= task,
// ?agent= avatar card.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ListChecks, MessagesSquare, PencilRuler, Pin, Plus, Save, Square, X } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, EmptyState, StatusDot } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { idempotencyKey, StudioApiError } from '../api/client';
import { createConversation, listAgents, putLayout, stopConversation, updateProject, type Conversation, type Message, type Snapshot, type Task } from '../api/endpoints';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { agentHref, projectHref } from '../routes';
import { useProject, type ProjectState } from '../state/project-store';
import { ProjectFrame } from '../projects/project-page';
import type { Role } from './addressing';
import { AgentPopover, currentTask } from './agent-popover';
import { Composer, type ComposerHandle, type ReplyTarget } from './composer';
import { DecisionForm, DecisionList, DiscussionForm, FollowUpForm, TaskForm } from './forms';
import { layoutRequest, sceneLayout, ZONE_FIELDS, type Seated } from './layout-map';
import { roomArcs, roomPresenceOf } from './room-presence';
import { defaultPortrait, PORTRAIT_ACCENTS, PORTRAIT_EMBLEMS, PORTRAIT_PRESETS, type Portrait, type RoomLayout, type SceneAgent, type ShelfItem } from './scene/model';
import { RoomStage } from './scene/stage';
import { useRoomShortcuts, type RoomTarget } from './shortcuts';
import { ActivityStrip, TaskGroups } from './task-list';
import { groupTasks, type TaskGroup } from './tasks';
import { authorOf, quote, Transcript, type TranscriptActions } from './transcript';
import { readConversation, useDeliverables, useRoomPresence, useRoomTasks, useTranscript } from './use-room';
import './room.css';

type Mode = 'wide' | 'tabs' | 'compact';
const TABS_QUERY = '(max-width: 1023.98px)';
const COMPACT_QUERY = '(max-width: 639.98px)';
function useRoomMode(): Mode {
  const read = (): Mode => (window.matchMedia?.(COMPACT_QUERY).matches ? 'compact' : window.matchMedia?.(TABS_QUERY).matches ? 'tabs' : 'wide');
  const [mode, setMode] = useState<Mode>(read);
  useEffect(() => {
    const queries = [window.matchMedia?.(TABS_QUERY), window.matchMedia?.(COMPACT_QUERY)].filter(Boolean) as MediaQueryList[];
    const update = () => setMode(read());
    for (const query of queries) query.addEventListener?.('change', update);
    return () => {
      for (const query of queries) query.removeEventListener?.('change', update);
    };
  }, []);
  return mode;
}

/** Splitter stops, as classes: the room takes this share of the width. */
export const SPLITS = [40, 45, 50, 55, 60, 65, 70, 75] as const;
const SPLIT_KEY = 'studio-room-split';
const readSplit = (): number => {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    return (SPLITS as readonly number[]).includes(value) ? value : 60;
  } catch {
    return 60;
  }
};
const snapSplit = (value: number): number => SPLITS.reduce((best, stop) => (Math.abs(stop - value) < Math.abs(best - value) ? stop : best), SPLITS[0]);

const CONVERSATION_ORDER: Record<Conversation['kind'], number> = { team: 0, direct: 1, discussion: 2 };
const DISCUSSION_STATE: Record<string, string> = { running: 'in progress', summarizing: 'summarizing', stopped: 'stopped', done: 'done' };
export const conversationLabel = (conversation: Conversation, roles: readonly Role[]): string => {
  if (conversation.kind === 'team') return 'Team room';
  if (conversation.kind === 'direct') return `Direct: ${roles.find((role) => role.key === conversation.role_key)?.name ?? conversation.title}`;
  const state = conversation.discussion ? DISCUSSION_STATE[conversation.discussion.state] : null;
  return `Discussion: ${quote(conversation.discussion?.question ?? conversation.title, 48)}${state ? ` (${state})` : ''}`;
};

const portraitOf = (value: { preset: string; accent: string; emblem: string } | null | undefined, ref: string): Portrait => {
  const fallback = defaultPortrait(ref);
  if (!value) return fallback;
  const pick = <T extends string>(list: readonly T[], item: string, other: T): T => ((list as readonly string[]).includes(item) ? (item as T) : other);
  return { preset: pick(PORTRAIT_PRESETS, value.preset, fallback.preset), accent: pick(PORTRAIT_ACCENTS, value.accent, fallback.accent), emblem: pick(PORTRAIT_EMBLEMS, value.emblem, fallback.emblem) };
};

const STREAM_TEXT: Record<ProjectState['stream'], { status: string; label: string }> = {
  open: { status: 'ONLINE', label: 'Live' },
  connecting: { status: 'PENDING', label: 'Connecting' },
  retrying: { status: 'PENDING', label: 'Reconnecting' },
  stopped: { status: 'OFFLINE', label: 'Offline' },
  idle: { status: 'PENDING', label: 'Connecting' },
};

type Form =
  | { kind: 'discussion'; participants: string[] }
  | { kind: 'decision'; source: Message | null }
  | { kind: 'task'; source: Message | null }
  | { kind: 'follow-up'; message: Message };
const FORM_TITLE: Record<Form['kind'], string> = { discussion: 'Start a discussion', decision: 'Pin a decision', task: 'Create a task', 'follow-up': 'Request a follow-up' };

export function ConversationRoom({ projectId }: { projectId: string }) {
  return <ProjectFrame projectId={projectId}>{(state) => <Room projectId={projectId} snapshot={state.snapshot} stream={state.stream} />}</ProjectFrame>;
}

function Room({ projectId, snapshot, stream }: { projectId: string; snapshot: Snapshot; stream: ProjectState['stream'] }) {
  const { store } = useProject(projectId);
  const search = useStudioSearch();
  const mode = useRoomMode();
  const archived = snapshot.project.status === 'archived';
  const team = snapshot.team.current;
  const roles = useMemo(() => team?.body.roles ?? [], [team]);
  const conversations = useMemo(() => [...snapshot.conversations].sort((a, b) => CONVERSATION_ORDER[a.kind] - CONVERSATION_ORDER[b.kind] || (a.created_at < b.created_at ? -1 : 1)), [snapshot.conversations]);
  const teamConversation = conversations.find((item) => item.kind === 'team') ?? null;
  const asked = search.get('c');
  const conversation = (asked ? conversations.find((item) => item.id === asked) : undefined) ?? teamConversation;
  const conversationId = conversation?.id ?? null;
  const highlight = search.get('m');
  const taskParam = search.get('task');
  const agentParam = search.get('agent');

  const { transcript, reload } = useTranscript(store, conversationId);
  const loadedDeliverables = useDeliverables(store);
  const deliverables = useMemo(() => loadedDeliverables ?? [], [loadedDeliverables]);
  const { presence, now } = useRoomPresence(store, snapshot, transcript, loadedDeliverables);
  const { tasks, error: tasksError, retry: retryTasks } = useRoomTasks(store, snapshot);
  const agentList = useMagnusResource((signal) => listAgents(signal), []);

  // Who sits in the room: each agent bound in the published team, once, with the roles it holds.
  const seated = useMemo(() => {
    const byRef = new Map<string, Role[]>();
    for (const role of roles) if (role.agent_ref) byRef.set(role.agent_ref, [...(byRef.get(role.agent_ref) ?? []), role]);
    return byRef;
  }, [roles]);
  const seats: Seated[] = useMemo(() => [...seated].map(([ref, held]) => ({ ref, role: held[0]!.key })), [seated]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoomLayout | null>(null);
  const [layoutError, setLayoutError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const layoutKey = useRef<string | null>(null);
  const savedLayout = useMemo(() => sceneLayout(snapshot.layout, seats), [snapshot.layout, seats]);
  const layout = editing && draft ? draft : savedLayout;

  const agents: SceneAgent[] = useMemo(
    () =>
      [...seated].map(([ref, held]) => {
        const info = agentList.data?.agents.find((item) => item.agent_ref === ref);
        const shown = roomPresenceOf(presence, ref, now);
        return {
          ref,
          displayName: held.map((role) => role.name).join(' · '),
          roleName: info?.display_name ?? ref.split('~')[1] ?? ref,
          portrait: portraitOf(info?.portrait, ref),
          seat: layout.placements.find((placement) => placement.agent === ref)?.seat ?? '',
          state: shown.state,
          label: shown.label,
          since: shown.since,
        };
      }),
    [seated, agentList.data, presence, now, layout],
  );
  const agentForRole = useCallback((key: string) => roles.find((role) => role.key === key)?.agent_ref ?? undefined, [roles]);
  const arcs = useMemo(() => roomArcs(presence, now, agentForRole), [presence, now, agentForRole]);
  const shelf: ShelfItem[] = useMemo(
    () =>
      deliverables
        .flatMap((deliverable) => deliverable.revisions.map((revision) => ({ id: revision.id, label: `${deliverable.name} rev ${revision.revision}`, at: revision.received_at })))
        .sort((a, b) => (b.at > a.at ? 1 : -1))
        .map(({ id, label }) => ({ id, label })),
    [deliverables],
  );
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const decisions = snapshot.decisions.filter((decision) => !decision.superseded_by);
  const discussion = conversation?.kind === 'discussion' && conversation.discussion && ['running', 'summarizing'].includes(conversation.discussion.state) ? conversation : conversations.find((item) => item.discussion && ['running', 'summarizing'].includes(item.discussion.state));
  const gathered = (discussion?.discussion?.participants ?? []).flatMap((key) => {
    const ref = agentForRole(key);
    return ref ? [ref] : [];
  });
  const coordinator = roles.find((role) => role.coordinator);
  const coordinatorTask = coordinator ? currentTask(tasks, [coordinator.key]) : null;
  const wall = {
    ...(snapshot.project.brief_md.trim() ? { brief: quote(snapshot.project.brief_md, 90) } : {}),
    ...(discussion?.discussion ? { focus: quote(discussion.discussion.question, 70) } : coordinatorTask ? { focus: quote(coordinatorTask.title, 70) } : {}),
    decisions: decisions.length,
    questions: groups.questions.length,
  };

  // Panels, drawers and forms.
  const [tab, setTab] = useState<'room' | 'transcript' | 'activity'>('transcript');
  const [split, setSplit] = useState(readSplit);
  const [tasksOpen, setTasksOpen] = useState<TaskGroup | 'all' | null>(taskParam ? 'all' : null);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const composer = useRef<ComposerHandle>(null);
  const roomPane = useRef<HTMLDivElement>(null);
  const transcriptList = useRef<HTMLOListElement>(null);
  const transcriptPane = useRef<HTMLDivElement>(null);
  const splitFrame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (taskParam) setTasksOpen((open) => open ?? 'all');
  }, [taskParam]);
  useEffect(() => setReply(null), [conversationId]);
  // Opening the project later returns here.
  const lastArea = snapshot.project.last_area;
  useEffect(() => {
    if (lastArea === 'room') return;
    updateProject(projectId, { last_area: 'room' }, idempotencyKey()).then(
      (project) => store.setProject(project),
      () => undefined,
    );
    // Once per visit: the answer updates last_area, which must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      // The split is a convenience; it resets on the next visit.
    }
  }, [split]);

  // A finished reply is announced once, by its text, never per delta.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const id = transcript.finished.at(-1);
    if (!id || announced.current.has(id)) return;
    announced.current.add(id);
    const message = transcript.messages.find((item) => item.id === id);
    if (message) setAnnouncement(`${authorOf(message, roles).name} replied: ${quote(message.body_md, 200)}`);
  }, [transcript.finished, transcript.messages, roles]);

  const go = useCallback((values: Record<string, string | null>) => setStudioQuery(values, 'push'), []);
  const openConversation = useCallback((id: string | null) => go({ c: id && id !== teamConversation?.id ? id : null, m: null }), [go, teamConversation]);

  const jump = useCallback(
    async (messageId: string, inConversation?: string | null) => {
      if (transcript.messages.some((message) => message.id === messageId)) {
        go({ m: messageId });
        return;
      }
      if (inConversation) {
        go({ c: inConversation === teamConversation?.id ? null : inConversation, m: messageId });
        return;
      }
      for (const item of conversations) {
        if (item.id === conversationId) continue;
        const found = await readConversation(item.id).then((messages) => messages.some((message) => message.id === messageId)).catch(() => false);
        if (found) {
          go({ c: item.id === teamConversation?.id ? null : item.id, m: messageId });
          return;
        }
      }
      setNotice('That message is not in any conversation of this project any more.');
    },
    [transcript.messages, conversations, conversationId, teamConversation, go],
  );

  const actions: TranscriptActions = {
    reply: (message, thread) => {
      setReply({ message, thread });
      if (mode === 'tabs') setTab('transcript');
    },
    pin: (message) => setForm({ kind: 'decision', source: message }),
    createTask: (message) => setForm({ kind: 'task', source: message }),
    followUp: (message) => setForm({ kind: 'follow-up', message }),
    openTask: (taskId) => {
      go({ task: taskId });
      setTasksOpen('all');
    },
    jump: (messageId) => void jump(messageId),
    copyLink: (message) => {
      const query = new URLSearchParams({ ...(message.conversation_id !== teamConversation?.id ? { c: message.conversation_id } : {}), m: message.id });
      const link = `${location.origin}${projectHref(projectId, '/room')}?${query}`;
      void navigator.clipboard?.writeText(link).then(
        () => setNotice('Link copied.'),
        () => setNotice(`Copy this link: ${link}`),
      );
    },
  };

  // The avatar card.
  const selected = agentParam ? agents.find((agent) => agent.ref === agentParam) : undefined;
  const selectAgent = (ref: string) => setStudioQuery({ agent: ref }, 'replace');
  const closeAgent = () => {
    const ref = agentParam;
    setStudioQuery({ agent: null }, 'replace');
    requestAnimationFrame(() => document.querySelector<SVGGElement>(`[data-agent="${CSS.escape(ref ?? '')}"][role="button"]`)?.focus());
  };
  async function messageDirectly(roleKey: string) {
    const existing = conversations.find((item) => item.kind === 'direct' && item.role_key === roleKey && !item.stopped_at);
    try {
      const target = existing ?? (await createConversation(projectId, { kind: 'direct', role_key: roleKey }, idempotencyKey()));
      if (!existing) store.upsertRecord('conversations', target);
      setStudioQuery({ agent: null, c: target.id, m: null }, 'push');
      if (mode === 'tabs') setTab('transcript');
      requestAnimationFrame(() => composer.current?.focus());
    } catch (failure) {
      setNotice(errorMessage(failure, 'The direct conversation could not be opened'));
    }
  }

  async function saveLayout() {
    if (!draft) return;
    setSavingLayout(true);
    setLayoutError(null);
    layoutKey.current ??= idempotencyKey();
    try {
      const saved = await putLayout(projectId, layoutRequest(draft, seats, snapshot.layout?.revision ?? null), layoutKey.current);
      layoutKey.current = null;
      store.setLayout(saved);
      setEditing(false);
      setDraft(null);
      setNotice(`Layout saved as revision ${saved?.revision ?? ''}.`);
    } catch (failure) {
      const conflict = failure instanceof StudioApiError && failure.conflict;
      setLayoutError({ message: conflict ? 'Someone saved the layout while you edited it. Reload it, then make your changes again.' : errorMessage(failure, 'The layout could not be saved'), conflict });
    } finally {
      setSavingLayout(false);
    }
  }
  const editLayout = (next: RoomLayout) => {
    layoutKey.current = null;
    setDraft(next);
  };

  async function stopDiscussion() {
    if (!conversation) return;
    setStopError(null);
    try {
      store.upsertRecord('conversations', await stopConversation(conversation.id, idempotencyKey()));
    } catch (failure) {
      setStopError(errorMessage(failure, 'The discussion could not be stopped'));
    } finally {
      setStopping(false);
    }
  }

  const focusTarget = useCallback(
    (target: RoomTarget) => {
      if (mode === 'tabs') setTab(target === 'room' ? 'room' : 'transcript');
      requestAnimationFrame(() => {
        if (target === 'room') (roomPane.current?.querySelector<HTMLElement>('[role="button"][data-agent]') ?? roomPane.current?.querySelector<HTMLElement>('svg[role="group"]') ?? roomPane.current)?.focus();
        else if (target === 'transcript') (transcriptList.current ?? transcriptPane.current)?.focus();
        else composer.current?.focus();
      });
    },
    [mode],
  );
  useRoomShortcuts(focusTarget, !form && !tasksOpen && !decisionsOpen);

  // The splitter between the room and the transcript, in steps of five percent.
  const onSplitKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = SPLITS.indexOf(split as (typeof SPLITS)[number]);
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = SPLITS[Math.max(0, index - 1)]!;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = SPLITS[Math.min(SPLITS.length - 1, index + 1)]!;
    else if (event.key === 'Home') next = SPLITS[0];
    else if (event.key === 'End') next = SPLITS.at(-1)!;
    if (next === null) return;
    event.preventDefault();
    setSplit(next);
  };
  const onSplitPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const frame = splitFrame.current?.getBoundingClientRect();
    if (!frame) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const move = (moveEvent: PointerEvent) => setSplit(snapSplit(((moveEvent.clientX - frame.left) / frame.width) * 100));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const selectedRoles = selected ? (seated.get(selected.ref) ?? []) : [];
  const lastMessage = selected ? ([...transcript.messages].reverse().find((message) => message.author.kind === 'agent' && selectedRoles.some((role) => role.binding_id === (message.author as { binding_id: string }).binding_id || role.key === (message.author as { role_key: string | null }).role_key)) ?? null) : null;
  const emptyMessage = !team
    ? 'Publish a team in Team Assignment, then talk to it here.'
    : conversation?.kind === 'discussion'
      ? 'The discussion starts with its question.'
      : conversation?.kind === 'direct'
        ? `Write to ${roles.find((role) => role.key === conversation.role_key)?.name ?? 'this role'} below.`
        : 'Write to the team below. The coordinator answers, or the roles you address.';

  const streamText = STREAM_TEXT[stream];
  const runningDiscussion = conversation?.kind === 'discussion' && conversation.discussion && ['running', 'summarizing'].includes(conversation.discussion.state) && !conversation.stopped_at;

  const header = (
    <div className="room-head">
      <label className="room-head__switch text-sm text-text-muted">
        <span className="room-head__label">Conversation</span>
        <select className="room-select" value={conversationId ?? ''} onChange={(event) => openConversation(event.target.value || null)} aria-label="Conversation">
          {teamConversation ? null : <option value="">Team room</option>}
          {(['team', 'direct', 'discussion'] as const).map((kind) => {
            const items = conversations.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <optgroup key={kind} label={kind === 'team' ? 'Team' : kind === 'direct' ? 'Direct' : 'Discussions'}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {conversationLabel(item, roles)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      <div className="room-head__actions">
        {!archived && team ? (
          <Button size="sm" icon={<Plus className="btn-ico" aria-hidden="true" />} onClick={() => setForm({ kind: 'discussion', participants: [] })}>
            Start discussion
          </Button>
        ) : null}
        {runningDiscussion && !archived ? (
          <Button size="sm" variant="warning" icon={<Square className="btn-ico" aria-hidden="true" />} onClick={() => setStopping(true)}>
            Stop discussion
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon={<ListChecks className="btn-ico" aria-hidden="true" />} onClick={() => setTasksOpen('all')} aria-label={`Tasks, ${groups.assignments.length + groups.reviews.length} active`}>
          Tasks
          <span className="tab-count">{groups.assignments.length + groups.reviews.length}</span>
        </Button>
        <Button size="sm" variant="ghost" icon={<Pin className="btn-ico" aria-hidden="true" />} onClick={() => setDecisionsOpen(true)} aria-label={`Decisions, ${decisions.length}`}>
          Decisions
          <span className="tab-count">{decisions.length}</span>
        </Button>
        <span className="room-live text-xs text-text-muted" role="status">
          <StatusDot status={streamText.status} pulse={stream !== 'open' && stream !== 'stopped'} />
          {streamText.label}
        </span>
      </div>
      {stopError ? (
        <p className="room-head__error m-0 text-sm text-danger" role="alert">
          {stopError}
        </p>
      ) : null}
    </div>
  );

  const layoutActions =
    mode !== 'compact' && !archived && agents.length ? (
      editing ? (
        <>
          <Button size="sm" variant="primary" icon={<Save className="btn-ico" aria-hidden="true" />} loading={savingLayout} disabled={!draft} onClick={() => void saveLayout()}>
            Save layout
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="btn-ico" aria-hidden="true" />}
            onClick={() => {
              setEditing(false);
              setDraft(null);
              setLayoutError(null);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          icon={<PencilRuler className="btn-ico" aria-hidden="true" />}
          onClick={() => {
            setDraft(savedLayout);
            setEditing(true);
          }}
        >
          Edit layout
        </Button>
      )
    ) : null;

  const room = (
    <div ref={roomPane} className="room-pane room-pane--scene" aria-label="Room">
      {agents.length ? (
        <RoomStage
          agents={agents}
          layout={layout}
          wall={wall}
          arcs={editing ? [] : arcs}
          shelf={shelf}
          discussion={gathered}
          editing={editing}
          onSelect={selectAgent}
          onLayoutChange={editLayout}
          activeRef={agentParam}
          variant={mode === 'compact' ? 'ring' : 'scene'}
          label={`Conversation room, ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`}
          actions={layoutActions}
        />
      ) : (
        <EmptyState
          framed
          icon={<MessagesSquare className="size-6" />}
          title={team ? 'No agent is bound yet' : 'No published team'}
          message={team ? 'Bind an agent to each role in Team Assignment. They appear here at their desks.' : 'Design the team and publish it in Team Assignment. Its agents then appear here.'}
          action={
            <StudioLink href={projectHref(projectId, '/team')} className="btn no-underline">
              Open Team Assignment
            </StudioLink>
          }
        />
      )}
      {editing ? (
        <fieldset className="room-zones rounded-control border border-border bg-surface">
          <legend className="text-xs text-text-muted">Zone labels</legend>
          {ZONE_FIELDS.map(({ zone, label }) => (
            <label key={zone} className="field">
              <span className="field-label">{label}</span>
              <input value={layout.zoneLabels[zone] ?? ''} maxLength={60} onChange={(event) => editLayout({ ...layout, zoneLabels: { ...layout.zoneLabels, [zone]: event.target.value } })} />
            </label>
          ))}
        </fieldset>
      ) : null}
      {layoutError ? (
        <div className="warning-banner text-sm" role="alert">
          <span>{layoutError.message}</span>
          {layoutError.conflict ? (
            <Button
              size="sm"
              onClick={() => {
                void store.refetch();
                setDraft(null);
                setEditing(false);
                setLayoutError(null);
              }}
            >
              Reload layout
            </Button>
          ) : null}
        </div>
      ) : null}
      {selected ? (
        <AgentPopover
          agent={selected}
          roles={selectedRoles}
          task={currentTask(tasks, selectedRoles.map((role) => role.key))}
          lastMessage={lastMessage}
          store={store}
          tasks={tasks}
          deliverables={deliverables}
          archived={archived}
          studioHref={`${agentHref(selected.ref, projectId)}?from=room${conversationId ? `&c=${encodeURIComponent(conversationId)}` : ''}`}
          onMessage={() => void messageDirectly(selectedRoles[0]!.key)}
          onInvite={() => {
            setStudioQuery({ agent: null }, 'replace');
            setForm({ kind: 'discussion', participants: selectedRoles.map((role) => role.key) });
          }}
          onOpenMessage={(id) => go({ m: id, agent: null })}
          onClose={closeAgent}
        />
      ) : null}
    </div>
  );

  const transcriptPaneNode = (
    <div ref={transcriptPane} className="room-pane room-pane--transcript" tabIndex={-1} aria-label="Transcript">
      <Transcript
        transcript={transcript}
        roles={roles}
        files={snapshot.files}
        tasks={tasks}
        projectId={projectId}
        archived={archived}
        highlight={highlight}
        actions={actions}
        onRetry={reload}
        emptyMessage={emptyMessage}
        listRef={transcriptList}
      />
      {team || archived ? (
        <Composer
          ref={composer}
          store={store}
          conversation={conversation}
          roles={roles}
          files={snapshot.files}
          archived={archived}
          reply={reply}
          onClearReply={() => setReply(null)}
          onConversation={(created) => openConversation(created.id)}
          onSent={() => setNotice('')}
        />
      ) : null}
    </div>
  );

  const strip = <ActivityStrip tasks={tasks} decisions={decisions.length} onOpen={(group) => setTasksOpen(group)} onDecisions={() => setDecisionsOpen(true)} />;
  const taskProps = { store, roles, deliverables, archived, onOpenMessage: (id: string, inConversation: string | null) => void jump(id, inConversation) };

  let body;
  if (mode === 'wide')
    body = (
      <>
        <div ref={splitFrame} className={cn('room-split', `room-split--${split}`)}>
          {room}
          <div
            className="room-splitter"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize the room and the transcript"
            aria-valuemin={SPLITS[0]}
            aria-valuemax={SPLITS.at(-1)}
            aria-valuenow={split}
            aria-valuetext={`Room ${split} percent`}
            onKeyDown={onSplitKey}
            onPointerDown={onSplitPointer}
          />
          {transcriptPaneNode}
        </div>
        {strip}
      </>
    );
  else if (mode === 'tabs')
    body = (
      <>
        <div className="tabs room-tabs" role="tablist" aria-label="Room views">
          {(['room', 'transcript', 'activity'] as const).map((item) => (
            <button key={item} type="button" role="tab" id={`room-tab-${item}`} aria-selected={tab === item} aria-controls={tab === item ? `room-panel-${item}` : undefined} className={cn('tab', tab === item && 'tab--active')} onClick={() => setTab(item)}>
              {item === 'room' ? 'Room' : item === 'transcript' ? 'Transcript' : 'Activity'}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`room-panel-${tab}`} aria-labelledby={`room-tab-${tab}`} className="room-tabpanel">
          {tab === 'room' ? room : tab === 'transcript' ? transcriptPaneNode : (
            <>
              {strip}
              <TaskGroups tasks={tasks} error={tasksError} onRetry={retryTasks} {...taskProps} />
            </>
          )}
        </div>
      </>
    );
  else
    body = (
      <div className="room-compact">
        {room}
        {strip}
        {transcriptPaneNode}
      </div>
    );

  return (
    <div className={cn('room-page', `room-page--${mode}`)}>
      <h2 className="sr-only">Conversation Room</h2>
      {header}
      {notice ? (
        <p className="room-notice info-banner m-0 text-sm" role="status">
          {notice}
          <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Dismiss" onClick={() => setNotice('')}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {body}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-transcript-live="">
        {announcement}
      </p>
      <Drawer
        open={tasksOpen !== null}
        title="Tasks"
        eyebrow={snapshot.project.name}
        onClose={() => {
          setTasksOpen(null);
          if (taskParam) setStudioQuery({ task: null }, 'replace');
        }}
      >
        <TaskGroups tasks={tasks} focus={tasksOpen && tasksOpen !== 'all' ? tasksOpen : null} highlightTask={taskParam} error={tasksError} onRetry={retryTasks} {...taskProps} />
      </Drawer>
      <Drawer open={decisionsOpen} title="Decisions" eyebrow={snapshot.project.name} onClose={() => setDecisionsOpen(false)}>
        <DecisionList
          decisions={snapshot.decisions}
          onOpenSource={(id) => {
            setDecisionsOpen(false);
            void jump(id);
          }}
          action={
            archived ? undefined : (
              <div>
                <Button size="sm" icon={<Plus className="btn-ico" aria-hidden="true" />} onClick={() => { setDecisionsOpen(false); setForm({ kind: 'decision', source: null }); }}>
                  New decision
                </Button>
              </div>
            )
          }
        />
      </Drawer>
      <Drawer open={form !== null} title={form ? FORM_TITLE[form.kind] : ''} eyebrow={snapshot.project.name} onClose={() => setForm(null)}>
        {form?.kind === 'discussion' ? (
          <DiscussionForm
            store={store}
            roles={roles}
            parent={conversation}
            initial={form.participants}
            onStarted={(created) => {
              setForm(null);
              openConversation(created.id);
            }}
          />
        ) : form?.kind === 'decision' ? (
          <DecisionForm
            store={store}
            source={form.source}
            onPinned={(decision) => {
              setForm(null);
              setNotice(`Pinned “${decision.title}”.`);
            }}
          />
        ) : form?.kind === 'task' ? (
          <TaskForm
            store={store}
            roles={roles}
            source={form.source}
            conversation={conversation}
            onCreated={(task: Task) => {
              setForm(null);
              setNotice(`Task created: ${task.title}.`);
            }}
          />
        ) : form?.kind === 'follow-up' ? (
          <FollowUpForm
            store={store}
            message={form.message}
            onSent={() => {
              setForm(null);
              setNotice('Follow-up requested.');
            }}
          />
        ) : null}
      </Drawer>
      <ConfirmDialog
        open={stopping}
        title="Stop this discussion?"
        message="Turns that have not started are cancelled and the running one is stopped. The transcript stays."
        confirmLabel="Stop discussion"
        tone="warning"
        onCancel={() => setStopping(false)}
        onConfirm={() => void stopDiscussion()}
      />
    </div>
  );
}

