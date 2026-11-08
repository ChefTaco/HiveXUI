// The roster: the same agents and states as the room, as a plain list. It is the room's text
// equivalent, so it shows every agent the scene shows, in the same order, with the same words.
import { cn } from '@lib/cn';
import { STATE_TONE } from './avatar';
import type { SceneAgent } from './model';
import { PortraitBadge } from './portrait';

export function RoomRoster({ id, agents, activeRef, onSelect, onActiveChange }: { id?: string; agents: readonly SceneAgent[]; activeRef?: string | null | undefined; onSelect?: ((ref: string) => void) | undefined; onActiveChange?: ((ref: string) => void) | undefined }) {
  if (agents.length === 0)
    return (
      <p id={id} className="room-roster text-sm text-text-muted">
        No agents are in this room yet.
      </p>
    );
  return (
    <ul id={id} className="room-roster" aria-label="Roster">
      {agents.map((agent) => (
        <li key={agent.ref}>
          <button
            type="button"
            className={cn('room-roster__item border bg-surface-raised text-left hover:bg-surface-hover', activeRef === agent.ref ? 'border-accent' : 'border-border')}
            aria-current={activeRef === agent.ref ? 'true' : undefined}
            data-agent={agent.ref}
            onClick={() => onSelect?.(agent.ref)}
            onFocus={() => onActiveChange?.(agent.ref)}
          >
            <PortraitBadge portrait={agent.portrait} size={32} />
            <span className="room-roster__text">
              <span className="room-roster__name text-sm">
                <span className="text-text-strong">{agent.displayName}</span>
                <span className="text-xs text-text-muted">{` · ${agent.roleName}`}</span>
              </span>
              <span className={cn('room-roster__state text-xs', STATE_TONE[agent.state])} data-state={agent.state}>
                {agent.label}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
