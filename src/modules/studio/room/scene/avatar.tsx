// One agent in the room: a focusable figure with a state marker above its head, and a name plate
// that the scene draws on top of everything so no furniture hides it. Every state has visible text.
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Ban, CircleDashed, Clock, Hourglass, Package, Pause, Search } from 'lucide-react';
import { cn } from '@lib/cn';
import { agentAccessibleName, type AgentState, type SceneAgent } from './model';
import { PLATE_H, plateBox, type PlateSide } from './plates';
import { ACCENT_EDGE, PortraitFigure } from './portrait';

/** The text color of a state: status colors only where the state is one. */
export const STATE_TONE: Record<AgentState, string> = {
  offline: 'text-text-muted',
  available: 'text-text-muted',
  queued: 'text-text-muted',
  working: 'text-text',
  speaking: 'text-text',
  asking: 'text-warning',
  waiting: 'text-text-muted',
  reviewing: 'text-text',
  delivering: 'text-text',
  paused: 'text-text-muted',
  blocked: 'text-danger',
  unknown: 'text-text-muted',
};

const MARK_Y = -68;

function IconMark({ children, tone }: { children: ReactNode; tone: string }) {
  return (
    <g className={cn('room-mark', tone)} transform={`translate(0 ${MARK_Y})`}>
      <circle className="fill-surface-raised" stroke="currentColor" strokeWidth={1.2} r={10} />
      {children}
    </g>
  );
}

/** The marker above an agent's head: a speech bubble, a question, an hourglass, a clock or a badge. */
export function StateMark({ state }: { state: AgentState }) {
  switch (state) {
    case 'speaking':
      return (
        <g className="room-mark fx-pulse text-accent" transform={`translate(0 ${MARK_Y})`}>
          <path className="fill-surface-raised" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" d="M-14,-9 H14 A4,4 0 0 1 18,-5 V5 A4,4 0 0 1 14,9 H2 L-4,15 L-4,9 H-14 A4,4 0 0 1 -18,5 V-5 A4,4 0 0 1 -14,-9 Z" />
          <circle fill="currentColor" cx={-7} cy={0} r={2} />
          <circle fill="currentColor" cx={0} cy={0} r={2} />
          <circle fill="currentColor" cx={7} cy={0} r={2} />
        </g>
      );
    case 'asking':
      return (
        <g className="room-mark text-warning" transform={`translate(0 ${MARK_Y})`}>
          <circle className="fill-warning/20" stroke="currentColor" strokeWidth={1.5} r={11} />
          <text className="room-mark__glyph text-base" fill="currentColor" y={5} textAnchor="middle">
            ?
          </text>
        </g>
      );
    case 'waiting':
      return (
        <IconMark tone="text-text-muted">
          <Hourglass x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'queued':
      return (
        <IconMark tone="text-text-muted">
          <Clock x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'reviewing':
      return (
        <IconMark tone="text-info">
          <Search x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'delivering':
      return (
        <IconMark tone="text-signal">
          <Package x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'paused':
      return (
        <IconMark tone="text-text-muted">
          <Pause x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'blocked':
      return (
        <IconMark tone="text-danger">
          <Ban x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    case 'unknown':
      return (
        <IconMark tone="text-text-muted">
          <CircleDashed x={-6} y={-6} width={12} height={12} />
        </IconMark>
      );
    default:
      return null;
  }
}

export interface AvatarProps {
  agent: SceneAgent;
  /** Portrait size relative to the room. */
  size: number;
  active: boolean;
  editing: boolean;
  carrying: boolean;
  /** Overrides the accessible name while the agent is being moved. */
  ariaLabel?: string | undefined;
  avatarRef: (node: SVGGElement | null) => void;
  onKeyDown: (event: KeyboardEvent<SVGGElement>) => void;
  onActivate: () => void;
  onFocus: () => void;
  onPointerDown?: ((event: PointerEvent<SVGGElement>) => void) | undefined;
}

/** The figure itself, as a button. Its position comes from the tweened group around it. */
export function Avatar({ agent, size, active, editing, carrying, ariaLabel, avatarRef, onKeyDown, onActivate, onFocus, onPointerDown }: AvatarProps) {
  return (
    <g
      ref={avatarRef}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? agentAccessibleName(agent)}
      aria-pressed={editing ? carrying : undefined}
      data-agent={agent.ref}
      data-state={agent.state}
      className={cn('room-avatar', `room-avatar--${agent.state}`, active && 'room-avatar--active', editing && 'room-avatar--editing', carrying && 'room-avatar--carrying')}
      onKeyDown={onKeyDown}
      onClick={onActivate}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
    >
      <ellipse className="room-avatar__focus" fill="none" strokeWidth={2} cx={0} cy={0} rx={24 * size} ry={12 * size} />
      <ellipse className="fill-bg/70" cx={0} cy={0} rx={18 * size} ry={8 * size} />
      {carrying && <ellipse className="fill-accent/15 stroke-accent" strokeDasharray="4 3" strokeWidth={1.5} cx={0} cy={0} rx={26 * size} ry={13 * size} />}
      <g transform={`scale(${Math.round(size * 100) / 100})`}>
        <PortraitFigure portrait={agent.portrait} />
        <StateMark state={agent.state} />
      </g>
    </g>
  );
}

/** The name plate beside an agent: name, then the state in words, with typing dots while it works. */
export function AgentPlate({ agent, width, size, side, shift = 0, active, onActivate }: { agent: SceneAgent; width: number; size: number; side: PlateSide; shift?: number; active: boolean; onActivate: () => void }) {
  const box = plateBox(side, width, size);
  const y = box.y + shift;
  // A plate pushed away from its figure keeps a leader line back to its feet.
  const lead = shift !== 0 ? { x: side === 'left' ? box.x + width : side === 'right' ? box.x : 0, y: side === 'below' ? y : y + PLATE_H / 2 } : null;
  return (
    <g className="room-plate-anchor" aria-hidden="true" data-plate={agent.ref} onClick={onActivate}>
      {lead && <line className="stroke-border-strong" strokeWidth={1} x1={0} y1={0} x2={lead.x} y2={lead.y} />}
      <foreignObject x={box.x} y={y} width={width} height={PLATE_H}>
        <div className={cn('room-plate border border-l-3 bg-surface-raised/90', active ? 'border-accent' : 'border-border-strong/60', ACCENT_EDGE[agent.portrait.accent], side === 'left' && 'room-plate--end')}>
          <span className="room-plate__name text-xs text-text-strong">{agent.displayName}</span>
          <span className={cn('room-plate__state text-xs', STATE_TONE[agent.state])}>
            {agent.state === 'working' && (
              <span className="typing-dots">
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="room-plate__text">{agent.label}</span>
          </span>
        </div>
      </foreignObject>
    </g>
  );
}
