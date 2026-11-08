// Auto-layout for the team canvas: the reporting tree top to bottom, with dagre. Loaded with the
// canvas only.
import { graphlib, layout } from '@dagrejs/dagre';
import type { TeamDraft } from '../model';

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 104;
export type Positions = Record<string, { x: number; y: number }>;

export function autoLayout(draft: TeamDraft): Positions {
  const graph = new graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 72, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  const keys = new Set(draft.roles.map((role) => role.key));
  for (const role of draft.roles) graph.setNode(role.key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  // Structure decides the ranks; managers sit above their reports.
  for (const edge of draft.relationships) if (edge.type === 'reports_to' && keys.has(edge.from) && keys.has(edge.to) && edge.from !== edge.to) graph.setEdge(edge.to, edge.from);
  layout(graph);
  const positions: Positions = {};
  for (const key of keys) {
    const node = graph.node(key) as { x: number; y: number } | undefined;
    if (node) positions[key] = { x: Math.round(node.x - NODE_WIDTH / 2), y: Math.round(node.y - NODE_HEIGHT / 2) };
  }
  return positions;
}
