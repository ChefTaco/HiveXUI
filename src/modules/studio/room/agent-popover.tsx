// The card an avatar opens: what the agent is doing (its current task and last message), and what a
// person can do about it. Docked in the room pane so it never covers the figure it describes.
import { useEffect, useRef } from 'react';
import { ExternalLink, MessageSquare, Users, X } from 'lucide-react';
import { Button } from '@ui';
import type { Deliverable, Message, Task } from '../api/endpoints';
import { StudioLink } from '../link';
import type { ProjectStore } from '../state/project-store';
import type { Role } from './addressing';
import type { SceneAgent } from './scene/model';
import { PortraitBadge } from './scene/portrait';
import { TaskRow } from './task-list';
import { isActive } from './tasks';
import { quote } from './transcript';

export interface AgentPopoverProps {
  agent: SceneAgent;
  roles: readonly Role[];
  task: Task | null;
  lastMessage: Message | null;
  store: ProjectStore;
  tasks: readonly Task[];
  deliverables: readonly Deliverable[];
  archived: boolean;
  studioHref: string;
  onMessage: () => void;
  onInvite: () => void;
  onOpenMessage: (messageId: string) => void;
  onClose: () => void;
}

/** The agent's most relevant task: the active one that shows in its state, else the newest active. */
export function currentTask(tasks: readonly Task[], roleKeys: readonly string[]): Task | null {
  const mine = tasks.filter((task) => task.role_key && roleKeys.includes(task.role_key) && isActive(task));
  const rank = (task: Task) => ['input_required', 'running', 'pausing', 'paused', 'queued'].indexOf(task.state);
  return [...mine].sort((a, b) => rank(a) - rank(b) || (b.updated_at > a.updated_at ? 1 : -1))[0] ?? null;
}

export function AgentPopover({ agent, roles, task, lastMessage, store, tasks, deliverables, archived, studioHref, onMessage, onInvite, onOpenMessage, onClose }: AgentPopoverProps) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    root.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.contains(document.activeElement)) return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [agent.ref]);
  const roleNames = roles.map((role) => role.name).join(', ');
  return (
    <section ref={root} className="room-popover panel panel--sm" role="dialog" aria-label={`${agent.displayName}, ${agent.label}`} tabIndex={-1} data-popover={agent.ref}>
      <header className="room-popover__head">
        <PortraitBadge portrait={agent.portrait} size={40} />
        <div className="room-popover__who">
          <p className="m-0 text-sm text-text-strong">{agent.displayName}</p>
          <p className="m-0 text-xs text-text-muted">{`${roleNames || 'No role'} · agent ${agent.roleName}`}</p>
          <p className="m-0 text-xs text-text">{agent.label}</p>
        </div>
        <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Close" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="room-popover__body">
        <div>
          <p className="stat-label m-0">Current task</p>
          {task ? (
            <ul className="room-task-list">
              <TaskRow task={task} store={store} roles={roles} tasks={new Map(tasks.map((item) => [item.id, item] as const))} deliverables={deliverables} archived={archived} />
            </ul>
          ) : (
            <p className="m-0 text-sm text-text-muted">No active task.</p>
          )}
        </div>
        <div>
          <p className="stat-label m-0">Last message</p>
          {lastMessage ? (
            <button type="button" className="room-quote text-left text-sm text-text hover:text-text-strong" onClick={() => onOpenMessage(lastMessage.id)}>
              {quote(lastMessage.body_md, 140) || 'A reply in progress'}
            </button>
          ) : (
            <p className="m-0 text-sm text-text-muted">Nothing in this conversation yet.</p>
          )}
        </div>
      </div>
      <footer className="room-popover__actions">
        <StudioLink href={studioHref} className="btn btn--sm no-underline">
          <ExternalLink className="btn-ico" aria-hidden="true" />
          Open in Agent Studio
        </StudioLink>
        {!archived ? (
          <>
            <Button size="sm" icon={<MessageSquare className="btn-ico" aria-hidden="true" />} onClick={onMessage}>
              Message directly
            </Button>
            <Button size="sm" icon={<Users className="btn-ico" aria-hidden="true" />} onClick={onInvite}>
              Invite to discussion
            </Button>
          </>
        ) : null}
      </footer>
    </section>
  );
}
