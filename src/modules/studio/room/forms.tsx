// The room's forms, each in a drawer: start a discussion, pin a decision, create a task from a
// message, ask an agent to follow up, and the Decisions list. Every submit carries one idempotency
// key per attempt at the same request, so a retry after a timeout cannot create twice.
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Pin } from 'lucide-react';
import { Badge, Button, EmptyState } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { createConversation, createDecision, createTask, requestFollowUp, type Conversation, type Decision, type Message, type Task } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import type { Role } from './addressing';
import { quote } from './transcript';

/** Submit state shared by the forms: busy, the error, and a key kept until the request succeeds. */
function useSubmit<T>(run: (key: string) => Promise<T>, onDone: (value: T) => void, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  return {
    busy,
    error,
    setError,
    /** A changed form is a different request: it gets a new key. */
    changed: () => {
      key.current = null;
    },
    submit: async (event?: FormEvent) => {
      event?.preventDefault();
      setBusy(true);
      setError(null);
      key.current ??= idempotencyKey();
      try {
        const value = await run(key.current);
        key.current = null;
        onDone(value);
      } catch (failure) {
        setError(errorMessage(failure, fallback));
      } finally {
        setBusy(false);
      }
    },
  };
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="m-0 text-sm text-danger" role="alert">
      {error}
    </p>
  ) : null;
}

function TextField({ label, value, onChange, rows, hint, required }: { label: string; value: string; onChange: (value: string) => void; rows?: number; hint?: string; required?: boolean }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      {rows ? <textarea id={id} rows={rows} value={value} required={required} onChange={(event) => onChange(event.target.value)} /> : <input id={id} value={value} required={required} onChange={(event) => onChange(event.target.value)} />}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const DESIRED_OUTPUTS: ReadonlyArray<{ value: 'decision' | 'short_doc' | 'options'; label: string; hint: string }> = [
  { value: 'decision', label: 'A decision', hint: 'The coordinator sums up one recommendation.' },
  { value: 'short_doc', label: 'A short document', hint: 'The coordinator writes the outcome up.' },
  { value: 'options', label: 'Options', hint: 'The coordinator lists the options with trade-offs.' },
];

export function DiscussionForm({ store, roles, parent, initial, onStarted }: { store: ProjectStore; roles: readonly Role[]; parent: Conversation | null; initial: readonly string[]; onStarted: (conversation: Conversation) => void }) {
  const [participants, setParticipants] = useState<string[]>(() => initial.filter((key) => roles.some((role) => role.key === key && role.agent_ref)));
  const [question, setQuestion] = useState('');
  const [output, setOutput] = useState<'decision' | 'short_doc' | 'options'>('decision');
  const [rounds, setRounds] = useState(2);
  const roundsId = useId();
  const form = useSubmit(
    (key) => {
      if (!participants.length) throw new Error('Choose at least one participant.');
      if (!question.trim()) throw new Error('Write the question to discuss.');
      const ordered = roles.map((role) => role.key).filter((key) => participants.includes(key));
      return createConversation(store.projectId, { kind: 'discussion', question: question.trim(), desired_output: output, participants: ordered, max_rounds: rounds, ...(parent?.kind === 'team' ? { parent_id: parent.id } : {}) }, key);
    },
    (conversation) => {
      store.upsertRecord('conversations', conversation);
      onStarted(conversation);
    },
    'The discussion could not be started',
  );
  const toggle = (key: string, on: boolean) => {
    form.changed();
    setParticipants((list) => (on ? [...list, key] : list.filter((item) => item !== key)));
  };
  return (
    <form className="room-form" onSubmit={(event) => void form.submit(event)} aria-label="Start a discussion">
      <fieldset className="room-fieldset">
        <legend className="field-label">Participants</legend>
        {roles.map((role) => (
          <label key={role.key} className={cn('check-field text-sm', !role.agent_ref && 'text-text-muted')}>
            <input type="checkbox" checked={participants.includes(role.key)} disabled={!role.agent_ref} onChange={(event) => toggle(role.key, event.target.checked)} />
            {role.name}
            {role.coordinator ? <Badge tone="accent">Coordinator</Badge> : null}
            {!role.agent_ref ? <span className="text-xs">No agent bound</span> : null}
          </label>
        ))}
        <span className="field-hint">They speak in this order, once each round. To invite a specialist, add the role in Team Assignment and bind an agent.</span>
      </fieldset>
      <TextField
        label="Question"
        rows={3}
        value={question}
        required
        onChange={(value) => {
          form.changed();
          setQuestion(value);
        }}
      />
      <fieldset className="room-fieldset">
        <legend className="field-label">Desired output</legend>
        {DESIRED_OUTPUTS.map((item) => (
          <label key={item.value} className="check-field text-sm">
            <input
              type="radio"
              name="desired-output"
              checked={output === item.value}
              onChange={() => {
                form.changed();
                setOutput(item.value);
              }}
            />
            <span>
              {item.label}
              <span className="field-hint">{` ${item.hint}`}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field" htmlFor={roundsId}>
        <span className="field-label">Rounds</span>
        <select
          id={roundsId}
          value={rounds}
          onChange={(event) => {
            form.changed();
            setRounds(Number(event.target.value));
          }}
        >
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              {value === 1 ? '1 round' : `${value} rounds`}
            </option>
          ))}
        </select>
        <span className="field-hint">Each participant speaks once a round. You can stop the discussion at any time.</span>
      </label>
      <FormError error={form.error} />
      <div>
        <Button type="submit" variant="primary" loading={form.busy}>
          Start discussion
        </Button>
      </div>
    </form>
  );
}

const proposalOf = (message: Message | null) => {
  const proposal = message?.links.proposal && typeof message.links.proposal === 'object' ? (message.links.proposal as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return { title: text(proposal.title), statement: text(proposal.statement), rationale: text(proposal.rationale) };
};

/** Pins a decision; from a message it keeps the message as its source. */
export function DecisionForm({ store, source, onPinned }: { store: ProjectStore; source: Message | null; onPinned: (decision: Decision) => void }) {
  const proposal = proposalOf(source);
  const [title, setTitle] = useState(proposal.title || (source ? quote(source.body_md, 80) : ''));
  const [statement, setStatement] = useState(proposal.statement || source?.body_md || '');
  const [rationale, setRationale] = useState(proposal.rationale);
  const form = useSubmit(
    (key) => createDecision(store.projectId, { title: title.trim(), statement_md: statement.trim(), rationale_md: rationale, ...(source ? { source_message_id: source.id } : {}) }, key),
    (decision) => {
      store.upsertRecord('decisions', decision);
      onPinned(decision);
    },
    'The decision could not be pinned',
  );
  const edit = (set: (value: string) => void) => (value: string) => {
    form.changed();
    set(value);
  };
  return (
    <form className="room-form" onSubmit={(event) => void form.submit(event)} aria-label="Pin a decision">
      {source?.kind === 'decision_proposal' ? <p className="m-0 text-sm text-text-muted">An agent proposed this. Pinning makes it a project decision every agent is told about.</p> : null}
      <TextField label="Title" value={title} onChange={edit(setTitle)} required />
      <TextField label="Decision" rows={4} value={statement} onChange={edit(setStatement)} required />
      <TextField label="Why (optional)" rows={2} value={rationale} onChange={edit(setRationale)} />
      <FormError error={form.error} />
      <div>
        <Button type="submit" variant="primary" loading={form.busy} icon={<Pin className="btn-ico" aria-hidden="true" />}>
          Pin decision
        </Button>
      </div>
    </form>
  );
}

/** Creates an assignment or review task for a role, from a message or from scratch. */
export function TaskForm({ store, roles, source, conversation, onCreated }: { store: ProjectStore; roles: readonly Role[]; source: Message | null; conversation: Conversation | null; onCreated: (task: Task) => void }) {
  const bound = roles.filter((role) => role.agent_ref);
  const author = source?.author.kind === 'agent' ? source.author.role_key : null;
  const [title, setTitle] = useState(source ? quote(source.body_md, 80) : '');
  const [instructions, setInstructions] = useState(source?.body_md ?? '');
  const [role, setRole] = useState(bound.find((item) => item.key !== author && !item.coordinator)?.key ?? bound[0]?.key ?? '');
  const [mode, setMode] = useState<'assignment' | 'review'>('assignment');
  const roleId = useId();
  const modeId = useId();
  const form = useSubmit(
    (key) =>
      createTask(
        store.projectId,
        { title: title.trim(), instructions_md: instructions, role_key: role, mode, ...(conversation ? { conversation_id: conversation.id } : {}), ...(source ? { source_message_id: source.id } : {}) },
        key,
      ),
    (task) => {
      store.upsertRecord('tasks', task);
      onCreated(task);
    },
    'The task could not be created',
  );
  if (!bound.length) return <EmptyState compact title="No role has an agent" message="Bind an agent to a role in Team Assignment, then create tasks for it." />;
  return (
    <form className="room-form" onSubmit={(event) => void form.submit(event)} aria-label="Create a task">
      <TextField
        label="Title"
        value={title}
        required
        onChange={(value) => {
          form.changed();
          setTitle(value);
        }}
      />
      <label className="field" htmlFor={roleId}>
        <span className="field-label">Role</span>
        <select
          id={roleId}
          value={role}
          onChange={(event) => {
            form.changed();
            setRole(event.target.value);
          }}
        >
          {bound.map((item) => (
            <option key={item.key} value={item.key}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={modeId}>
        <span className="field-label">Kind</span>
        <select
          id={modeId}
          value={mode}
          onChange={(event) => {
            form.changed();
            setMode(event.target.value as 'assignment' | 'review');
          }}
        >
          <option value="assignment">Assignment</option>
          <option value="review">Review</option>
        </select>
      </label>
      <TextField
        label="Instructions"
        rows={5}
        value={instructions}
        onChange={(value) => {
          form.changed();
          setInstructions(value);
        }}
      />
      <FormError error={form.error} />
      <div>
        <Button type="submit" variant="primary" loading={form.busy}>
          Create task
        </Button>
      </div>
    </form>
  );
}

/** Asks the agent that wrote a message to follow up on it, in the same conversation. */
export function FollowUpForm({ store, message, onSent }: { store: ProjectStore; message: Message; onSent: () => void }) {
  const [note, setNote] = useState('');
  const form = useSubmit(
    (key) => requestFollowUp(message.id, note.trim(), key),
    (result) => {
      for (const task of result.tasks) store.upsertRecord('tasks', task);
      onSent();
    },
    'The follow-up could not be requested',
  );
  return (
    <form className="room-form" onSubmit={(event) => void form.submit(event)} aria-label="Request a follow-up">
      <blockquote className="room-blockquote m-0 border-l-3 border-border-strong text-sm text-text-muted">{quote(message.body_md, 240)}</blockquote>
      <TextField
        label="What should the follow-up cover? (optional)"
        rows={3}
        value={note}
        onChange={(value) => {
          form.changed();
          setNote(value);
        }}
      />
      <FormError error={form.error} />
      <div>
        <Button type="submit" variant="primary" loading={form.busy}>
          Request follow-up
        </Button>
      </div>
    </form>
  );
}

/** The project's decisions, newest first, with what replaced the superseded ones. */
export function DecisionList({ decisions, onOpenSource, action }: { decisions: readonly Decision[]; onOpenSource: (messageId: string) => void; action?: ReactNode }) {
  const [showOld, setShowOld] = useState(false);
  const sorted = [...decisions].sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  const current = sorted.filter((decision) => !decision.superseded_by);
  const old = sorted.filter((decision) => decision.superseded_by);
  const byId = new Map(decisions.map((decision) => [decision.id, decision] as const));
  const item = (decision: Decision) => {
    const source = decision.sources.find((entry) => entry.kind === 'message');
    return (
      <li key={decision.id} className="room-decision rounded-control border border-border bg-surface-raised">
        <p className="m-0 text-sm text-text-strong">{decision.title}</p>
        <p className="room-msg__text m-0 text-sm text-text">{decision.statement_md}</p>
        {decision.rationale_md ? <p className="m-0 text-xs text-text-muted">{`Why: ${decision.rationale_md}`}</p> : null}
        <p className="m-0 text-xs text-text-muted">
          {`Pinned by ${decision.decided_by}`}
          {decision.superseded_by ? ` · replaced by “${byId.get(decision.superseded_by)?.title ?? 'a newer decision'}”` : ''}
        </p>
        {source ? (
          <button type="button" className="room-link text-xs text-accent" onClick={() => onOpenSource(source.ref)}>
            Open the source message
          </button>
        ) : null}
      </li>
    );
  };
  return (
    <div className="room-task-groups">
      {action}
      {current.length ? <ul className="room-task-list">{current.map(item)}</ul> : <EmptyState compact title="No decisions yet" message="Pin a message or an agent's proposal from the transcript, or write one here." />}
      {old.length ? (
        <div>
          <Button size="sm" variant="ghost" aria-expanded={showOld} onClick={() => setShowOld((value) => !value)}>
            {showOld ? 'Hide superseded decisions' : `Show ${old.length} superseded`}
          </Button>
          {showOld ? <ul className="room-task-list">{old.map(item)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
