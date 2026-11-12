// The Team view: roles on an @xyflow/react canvas. This module and its dependencies load only when a
// canvas is shown. Roles are focusable in reporting-tree order and the designer's keyboard model
// runs on them; the library's own keyboard handling is off so the two never disagree.
import '@xyflow/react/dist/base.css';
import { createContext, memo, useContext, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { cn } from '@lib/cn';
import { useReducedMotion } from '@lib/motion';
import type { Agent, ValidationIssue } from '../../api/endpoints';
import { EDGE_LOOK, EdgeMarkers } from '../legend';
import { keyCommand, RELATIONSHIP_LABEL, treeOrder, type KeyCommand, type Relationship, type Role, type TeamDraft } from '../model';
import { bindingOf, bindingText, RoleCard } from '../role-card';
import type { GhostChange } from '../proposal';
import { autoLayout, NODE_HEIGHT, type Positions } from './layout';
import { IconButton } from '@ui';

export interface TeamCanvasProps {
  draft: TeamDraft;
  positions: Positions;
  agents: ReadonlyMap<string, Agent>;
  creating: ReadonlySet<string>;
  issues: ReadonlyMap<string, ValidationIssue[]>;
  selected: string | null;
  /** The role to move keyboard focus to; changes of `focusTick` repeat the request. */
  focus?: { key: string; tick: number } | null;
  /** A new value lays the roles out again. */
  layoutTick?: number;
  readOnly?: boolean;
  /** A small, static rendering for template details: no editing, no keyboard stops. */
  mini?: boolean;
  label: string;
  onSelect?: (key: string | null) => void;
  onInspect?: (key: string) => void;
  onCommand?: (key: string, command: KeyCommand) => void;
  onPositions?: ((positions: Positions) => void) | undefined;
  onConnect?: (from: string, to: string) => void;
  onEdgeSelect?: (index: number) => void;
  /** A proposal drawn over the team: how each role, and each line by index, differs. Display only. */
  ghost?: { roles: ReadonlyMap<string, GhostChange>; edges: readonly GhostChange[] } | undefined;
}

const GHOST_WORDS: Record<GhostChange, string> = { added: 'added by the proposal', changed: 'changed by the proposal', removed: 'removed by the proposal', same: 'unchanged' };

type RoleData = { role: Role; index: number };
type RoleNode = Node<RoleData, 'role'>;
type EdgeData = { relationship: Relationship; index: number };
type RelationshipEdge = Edge<EdgeData, 'relationship'>;

interface CanvasContext {
  props: TeamCanvasProps;
  draft: TeamDraft;
}
const Context = createContext<CanvasContext | null>(null);

const SIDE_HANDLES: ReadonlyArray<readonly [string, 'source' | 'target', Position]> = [
  ['ts', 'source', Position.Top],
  ['bt', 'target', Position.Bottom],
  ['r', 'source', Position.Right],
  ['rt', 'target', Position.Right],
  ['l', 'target', Position.Left],
  ['ls', 'source', Position.Left],
];

/** Which sides a line leaves and enters by: down the tree, up it, or across a row. */
export function anchors(source: { x: number; y: number }, target: { x: number; y: number }): { sourceHandle: string; targetHandle: string } {
  const dy = target.y - source.y;
  if (Math.abs(dy) < NODE_HEIGHT * 0.75) return target.x >= source.x ? { sourceHandle: 'r', targetHandle: 'l' } : { sourceHandle: 'ls', targetHandle: 'rt' };
  return dy > 0 ? { sourceHandle: 'b', targetHandle: 't' } : { sourceHandle: 'ts', targetHandle: 'bt' };
}

const RoleNodeView = memo(function RoleNodeView({ id, data }: NodeProps<RoleNode>) {
  const { props, draft } = useContext(Context)!;
  const { role } = data;
  const binding = bindingOf(role, props.agents, props.creating);
  const issues = props.issues.get(role.key) ?? [];
  const interactive = !props.mini;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = keyCommand(draft, id, event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    if (command.kind === 'inspect') props.onInspect?.(id);
    else props.onCommand?.(id, command);
  };
  const change = props.ghost?.roles.get(role.key);
  const label = `${role.name}${role.coordinator ? ', coordinator' : ''}${change ? `, ${GHOST_WORDS[change]}` : ''}. ${bindingText(binding)}.${issues.length ? ` ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}.` : ''}`;
  return (
    <div
      className={cn('studio-node', change && change !== 'same' && 'studio-node--ghost')}
      data-role-key={role.key}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={interactive ? label : undefined}
      aria-pressed={interactive ? props.selected === role.key : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      onFocus={interactive ? () => props.onSelect?.(role.key) : undefined}
    >
      <Handle id="t" type="target" position={Position.Top} isConnectable={!props.readOnly && interactive} className="studio-node__handle" />
      <RoleCard role={role} binding={binding} issues={issues} selected={props.selected === role.key} compact={props.mini ?? false} ghost={change} />
      <Handle id="b" type="source" position={Position.Bottom} isConnectable={!props.readOnly && interactive} className="studio-node__handle" />
      {/* Anchors for lines between roles side by side or drawn upwards; not for drawing new lines. */}
      {SIDE_HANDLES.map(([handle, type, position]) => (
        <Handle key={handle} id={handle} type={type} position={position} isConnectable={false} className="studio-node__handle studio-node__handle--anchor" />
      ))}
    </div>
  );
});

function RelationshipEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<RelationshipEdge>) {
  const relationship = data!.relationship;
  const look = EDGE_LOOK[relationship.type];
  const { props } = useContext(Context)!;
  const change = props.ghost?.edges[data!.index];
  const [path, labelX, labelY] =
    relationship.type === 'reports_to'
      ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })
      : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: relationship.type === 'reviews' ? 0.6 : relationship.type === 'delegates_to' ? 0.35 : 0.25 });
  const marker = look.arrow ? `url(#studio-canvas-${props.mini ? 'mini' : 'main'}-${relationship.type})` : undefined;
  return (
    <g className="studio-edge" data-edge={id}>
      <title>{`${relationship.from} ${RELATIONSHIP_LABEL[relationship.type]} ${relationship.to}${relationship.stage === 'revise' ? ' (revise loop)' : ''}${change && change !== 'same' ? `, ${GHOST_WORDS[change]}` : ''}`}</title>
      {change === 'added' || change === 'removed' ? (
        // A wide halo in the change's color under the line keeps the relationship's own style readable.
        <path d={path} fill="none" className={cn('studio-edge__ghost', change === 'added' ? 'stroke-success' : 'stroke-danger')} strokeWidth={change === 'added' ? 9 : 7} strokeDasharray={change === 'removed' ? '3 6' : undefined} strokeLinecap="round" />
      ) : null}
      <path d={path} fill="none" className={cn(look.stroke, change === 'removed' && 'studio-edge--removed')} strokeWidth={look.width} strokeDasharray={look.dash} strokeLinecap="round" markerEnd={marker} />
      {change === 'added' || change === 'removed' ? (
        <text x={labelX} y={labelY + 4} textAnchor="middle" className={cn('studio-edge__ghost-mark', change === 'added' ? 'fill-success' : 'fill-danger')} aria-hidden="true">
          {change === 'added' ? '+' : '−'}
        </text>
      ) : null}
      {props.mini ? null : <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="studio-edge__hit" onClick={() => props.onEdgeSelect?.(data!.index)} />}
      {relationship.stage === 'revise' ? (
        <text x={labelX} y={labelY - 6} textAnchor="middle" className="studio-edge__label fill-text-muted">
          revise
        </text>
      ) : null}
    </g>
  );
}

const nodeTypes = { role: RoleNodeView };
const edgeTypes = { relationship: RelationshipEdgeView };

function Canvas(props: TeamCanvasProps) {
  const { draft, positions, readOnly, mini } = props;
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);

  // Roles without a position are placed by the layout; a layout request places every role again.
  const missing = draft.roles.some((role) => !positions[role.key]);
  const fallback = useMemo(() => (missing ? autoLayout(draft) : null), [missing, draft]);
  const effective = fallback ? { ...fallback, ...positions } : positions;
  useEffect(() => {
    if (fallback) props.onPositions?.({ ...fallback, ...positions });
    // Only a new fallback is reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);
  const handledTick = useRef(props.layoutTick ?? 0);
  useEffect(() => {
    if ((props.layoutTick ?? 0) === handledTick.current) return;
    handledTick.current = props.layoutTick ?? 0;
    props.onPositions?.(autoLayout(draft));
    // A tick is the request; the draft is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layoutTick]);
  useEffect(() => {
    const timer = setTimeout(() => void flow.fitView({ padding: 0.15, duration: reduced ? 0 : 250 }), 30);
    return () => clearTimeout(timer);
  }, [flow, props.layoutTick, draft.roles.length, reduced]);

  useEffect(() => {
    if (!props.focus) return;
    host.current?.querySelector<HTMLElement>(`[data-role-key="${CSS.escape(props.focus.key)}"]`)?.focus();
  }, [props.focus]);

  const order = useMemo(() => treeOrder(draft), [draft]);
  const nodes: RoleNode[] = useMemo(() => {
    const index = new Map(draft.roles.map((role) => [role.key, role]));
    return order.map((key, at) => ({
      id: key,
      type: 'role',
      position: effective[key] ?? { x: 0, y: 0 },
      data: { role: index.get(key)!, index: at },
      draggable: !readOnly && !mini,
      selectable: false,
      focusable: false,
    }));
  }, [draft, order, effective, readOnly, mini]);
  const edges: RelationshipEdge[] = useMemo(
    () =>
      draft.relationships.map((relationship, index) => {
        // Structure is drawn manager above report; the others run from the role that acts.
        const [source, target] = relationship.type === 'reports_to' ? [relationship.to, relationship.from] : [relationship.from, relationship.to];
        const handles = relationship.type === 'reports_to' ? { sourceHandle: 'b', targetHandle: 't' } : anchors(effective[source] ?? { x: 0, y: 0 }, effective[target] ?? { x: 0, y: 0 });
        return { id: `e${index}`, source, target, ...handles, type: 'relationship', data: { relationship, index }, focusable: false, selectable: false, className: EDGE_LOOK[relationship.type].className };
      }),
    [draft.relationships, effective],
  );

  const onNodesChange = (changes: NodeChange<RoleNode>[]) => {
    if (!props.onPositions) return;
    const moved: Positions = {};
    for (const change of changes) if (change.type === 'position' && change.position) moved[change.id] = { x: Math.round(change.position.x), y: Math.round(change.position.y) };
    if (Object.keys(moved).length) props.onPositions({ ...effective, ...moved });
  };
  const onConnect = (connection: Connection) => {
    if (connection.source && connection.target && connection.source !== connection.target) props.onConnect?.(connection.source, connection.target);
  };
  const context = useMemo(() => ({ props, draft }), [props, draft]);

  return (
    <Context.Provider value={context}>
      <div ref={host} className={cn('studio-canvas', mini && 'studio-canvas--mini')} role="group" aria-label={props.label}>
        <svg className="studio-canvas__defs" aria-hidden="true" focusable="false">
          <EdgeMarkers prefix={`studio-canvas-${mini ? 'mini' : 'main'}`} />
        </svg>
        <ReactFlow<RoleNode, RelationshipEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onPaneClick={() => props.onSelect?.(null)}
          onNodeClick={(_, node) => props.onSelect?.(node.id)}
          onNodeDoubleClick={(_, node) => props.onInspect?.(node.id)}
          nodesDraggable={!readOnly && !mini}
          nodesConnectable={!readOnly && !mini}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          panOnDrag={!mini}
          zoomOnScroll={!mini}
          zoomOnPinch={!mini}
          zoomOnDoubleClick={false}
          preventScrolling={!mini}
          minZoom={mini ? 0.05 : 0.3}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
        />
        {mini ? null : (
          <div className="studio-canvas__zoom" role="group" aria-label="Zoom">
            <IconButton type="button" variant="default" size="sm" label="Zoom in" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => void flow.zoomIn()} />
            <IconButton type="button" variant="default" size="sm" label="Zoom out" icon={<Minus className="size-4" aria-hidden="true" />} onClick={() => void flow.zoomOut()} />
            <IconButton type="button" variant="default" size="sm" label="Fit the team in view" title="Fit" icon={<Maximize className="size-4" aria-hidden="true" />} onClick={() => void flow.fitView({ padding: 0.15 })} />
          </div>
        )}
      </div>
    </Context.Provider>
  );
}

export default function TeamCanvas(props: TeamCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
