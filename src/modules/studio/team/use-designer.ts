// The designer's working copy of the team: edits apply locally at once, save to the service's draft
// revision after a pause, and are validated twice: by the mirrored rules immediately and by the
// service once it has seen the same draft.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey, StudioApiError } from '../api/client';
import { publishTeam, putTeamDraft, validateTeam, type AgentList, type TeamState, type ValidationResult } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import { draftFromRevision, draftSignature, emptyDraft, type TeamDraft } from './model';
import { validateDraft } from './validation';

export const SAVE_DELAY_MS = 800;
export const VALIDATE_DELAY_MS = 500;

export type SaveState = { state: 'saved' } | { state: 'pending' } | { state: 'saving' } | { state: 'failed'; message: string } | { state: 'conflict'; message: string };

const baseDraft = (team: TeamState): TeamDraft => (team.draft ? draftFromRevision(team.draft.body) : team.current ? draftFromRevision(team.current.body) : emptyDraft());

export interface Designer {
  draft: TeamDraft;
  /** Apply an edit to the working copy. Ignored while the project is read-only. */
  edit: (change: (draft: TeamDraft) => TeamDraft) => void;
  save: SaveState;
  /** Saves now instead of after the pause. Resolves once the service has the draft. */
  flush: () => Promise<boolean>;
  publish: () => Promise<void>;
  publishing: boolean;
  publishError: string | null;
  /** The service's verdict when it covers the draft on screen, else the mirrored rules. */
  validation: ValidationResult;
  /** True when `validation` is the service's answer for exactly this draft. */
  confirmed: boolean;
  /** Takes the service's newest team, dropping unsaved edits (after a conflict). */
  reload: () => void;
  /** Replaces the working copy and saves it now, for a change the person accepted as a whole. */
  replace: (next: TeamDraft) => Promise<boolean>;
  /** Pins the draft to another template version with the next save, after its changes were applied. */
  pinTemplate: (ref: { template_id: string; version: number }) => void;
  readOnly: boolean;
}

export interface DesignerOptions {
  save?: typeof putTeamDraft;
  check?: typeof validateTeam;
  publish?: typeof publishTeam;
}

export function useDesigner(store: ProjectStore, team: TeamState, context: { archived: boolean; deliverables: ReadonlyArray<{ name: string; producer_role_key: string | null }>; agents: AgentList | undefined }, options: DesignerOptions = {}): Designer {
  const { save: send = putTeamDraft, check = validateTeam, publish: sendPublish = publishTeam } = options;
  const [draft, setDraft] = useState<TeamDraft>(() => baseDraft(team));
  const saved = useRef(draftSignature(baseDraft(team)));
  const [save, setSave] = useState<SaveState>({ state: 'saved' });
  const [server, setServer] = useState<{ signature: string; result: ValidationResult } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pendingPin = useRef<{ template_id: string; version: number } | null>(null);
  const signature = draftSignature(draft);
  const dirty = signature !== saved.current;
  const readOnly = context.archived;

  // The service's team changed (another tab, a publish, an applied template): follow it unless
  // this tab holds edits it has not saved.
  const teamSignature = draftSignature(baseDraft(team));
  useEffect(() => {
    if (draftSignature(latest.current) !== saved.current || inFlight.current) return;
    if (teamSignature === saved.current) return;
    const next = baseDraft(team);
    saved.current = teamSignature;
    setDraft(next);
    // Only the team signature matters; team itself is read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamSignature]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const body = latest.current;
    const text = draftSignature(body);
    if (text === saved.current) return true;
    setSave({ state: 'saving' });
    const attempt = (async () => {
      try {
        const state = store.getState().snapshot?.team;
        const pin = pendingPin.current;
        const next = await send(store.projectId, { base_revision: state?.current?.revision ?? null, body, ...(pin ? { source_template: pin } : {}) }, idempotencyKey());
        if (pendingPin.current === pin) pendingPin.current = null;
        saved.current = text;
        store.setTeam(next);
        setSave(draftSignature(latest.current) === text ? { state: 'saved' } : { state: 'pending' });
        if (next.validation && next.draft && draftSignature(draftFromRevision(next.draft.body)) === text) setServer({ signature: text, result: next.validation });
        return true;
      } catch (error) {
        setSave(error instanceof StudioApiError && error.conflict
          ? { state: 'conflict', message: 'A newer team revision was published elsewhere. Reload to edit the current team; your unsaved changes here will be dropped.' }
          : { state: 'failed', message: errorMessage(error, 'The draft could not be saved') });
        return false;
      }
    })();
    inFlight.current = attempt;
    try {
      return await attempt;
    } finally {
      inFlight.current = null;
    }
  }, [send, store]);

  const edit = useCallback((change: (draft: TeamDraft) => TeamDraft) => {
    if (readOnly) return;
    setDraft((current) => change(current));
  }, [readOnly]);

  useEffect(() => {
    if (!dirty || readOnly || save.state === 'conflict') return;
    setSave((current) => (current.state === 'saving' ? current : { state: 'pending' }));
    const timer = setTimeout(() => void persist(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // save.state is read to stop retrying after a conflict, not to re-run on every change of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, dirty, readOnly, persist]);

  // Ask the service after each pause; its answer counts only for the draft it was given.
  useEffect(() => {
    if (server?.signature === signature) return;
    const controller = new AbortController();
    const body = draft;
    const timer = setTimeout(() => {
      check(store.projectId, body, controller.signal).then(
        (result) => setServer({ signature: draftSignature(body), result }),
        () => {},
      );
    }, VALIDATE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // draft is captured through signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, check, store.projectId]);

  const available = useMemo(() => new Map((context.agents?.agents ?? []).map((agent) => [agent.agent_ref, agent.available])), [context.agents]);
  const mirrored = useMemo(() => validateDraft(draft, context.deliverables, available), [draft, context.deliverables, available]);
  const confirmed = server?.signature === signature;
  const validation = confirmed ? server!.result : mirrored;

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      if (!(await persist())) throw new Error('Save the draft before publishing.');
      const revision = store.getState().snapshot?.team.draft?.revision;
      if (!revision) throw new Error('There is no draft to publish.');
      store.setTeam(await sendPublish(store.projectId, revision, idempotencyKey()));
    } catch (error) {
      setPublishError(errorMessage(error, 'The draft could not be published'));
    } finally {
      setPublishing(false);
    }
  }, [persist, sendPublish, store]);

  const reload = useCallback(() => {
    const team = store.getState().snapshot?.team;
    const next = team ? baseDraft(team) : emptyDraft();
    saved.current = draftSignature(next);
    setDraft(next);
    setSave({ state: 'saved' });
    void store.refetch();
  }, [store]);

  const replace = useCallback(
    async (next: TeamDraft): Promise<boolean> => {
      if (readOnly) return false;
      // persist reads the latest copy, so set it before the render that would.
      latest.current = next;
      setDraft(next);
      return persist();
    },
    [readOnly, persist],
  );

  const pinTemplate = useCallback((ref: { template_id: string; version: number }) => {
    pendingPin.current = ref;
  }, []);

  return { draft, edit, replace, pinTemplate, save: dirty || save.state !== 'saved' ? save : { state: 'saved' }, flush: persist, publish, publishing, publishError, validation, confirmed, reload, readOnly };
}
