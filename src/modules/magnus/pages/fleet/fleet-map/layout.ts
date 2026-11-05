import type { ThemeColors } from '@lib/theme-colors';
import type { TopologyMap, TopologyNode } from './schemas';

export const TAU = Math.PI * 2;

export interface LaidOutNode {
  node: TopologyNode;
  x: number;
  y: number;
  phase: number;
  /** 0 is healthy, 1 is critical. */
  stress: number;
}
export interface Cluster {
  x: number;
  y: number;
  r: number;
  cidr: string;
  isGateway: boolean;
  size: number;
}

/** The fractional part in [0, 1), also for negative input. */
export const frac = (value: number): number => ((value % 1) + 1) % 1;

export function stressFromNode(node: Pick<TopologyNode, 'reachable' | 'status' | 'latencyMs'>): number {
  if (!node.reachable || node.status === 'OFFLINE') return 1;
  if (node.status === 'DEGRADED') return 0.75;
  if (node.status === 'PROVISIONING') return 0.45;
  const latency = node.latencyMs ?? 0;
  if (latency > 100) return 0.8;
  if (latency > 50) return 0.55;
  if (latency > 20) return 0.3;
  return 0.12;
}

/** Theme tokens are hex today. rgb() is read too, so a token change cannot turn the map white. */
export function parseColor(color: string): [number, number, number] {
  const text = color.trim();
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(text);
  if (long) return [parseInt(long[1]!, 16), parseInt(long[2]!, 16), parseInt(long[3]!, 16)];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return [parseInt(short[1]! + short[1]!, 16), parseInt(short[2]! + short[2]!, 16), parseInt(short[3]! + short[3]!, 16)];
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [128, 128, 128];
}

/** success, then warning, then danger, in the theme's colors. */
export function makeStressColor(colors: Pick<ThemeColors, 'success' | 'warning' | 'danger'>): (stress: number, alpha?: number) => string {
  const stops = [parseColor(colors.success), parseColor(colors.warning), parseColor(colors.danger)] as const;
  return (stress, alpha = 1) => {
    const t = Math.max(0, Math.min(1, stress));
    const [from, to, k] = t < 0.5 ? [stops[0], stops[1], t / 0.5] : [stops[1], stops[2], (t - 0.5) / 0.5];
    const mix = (index: 0 | 1 | 2) => Math.round(from[index] + (to[index] - from[index]) * k);
    return `rgba(${mix(0)},${mix(1)},${mix(2)},${alpha})`;
  };
}

/** Each subnet is a ring of nodes, and the rings stand on an outer ring around the gateway subnet. */
export function layoutNodes(topology: Pick<TopologyMap, 'nodes' | 'subnets'>, width: number, height: number): { nodes: LaidOutNode[]; clusters: Cluster[] } {
  const subnets = topology.subnets.length > 0 ? topology.subnets : [{ cidr: 'default', nodeCount: topology.nodes.length, nodes: topology.nodes.map((node) => node.id), isGateway: false }];
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) * 0.38;
  const single = subnets.length === 1;
  const nodes: LaidOutNode[] = [];
  const clusters: Cluster[] = [];
  subnets.forEach((subnet, subnetIndex) => {
    const angle = (subnetIndex / subnets.length) * TAU;
    const x = subnet.isGateway || single ? cx : cx + Math.cos(angle) * outerR;
    const y = subnet.isGateway || single ? cy : cy + Math.sin(angle) * outerR;
    const members = topology.nodes.filter((node) => subnet.nodes.includes(node.id));
    const r = members.length <= 1 ? 0 : Math.min(single ? outerR * 0.75 : 80, 24 + members.length * 8);
    clusters.push({ x, y, r: r + 18, cidr: subnet.cidr, isGateway: subnet.isGateway, size: members.length });
    members.forEach((node, index) => {
      const a = (index / members.length) * TAU;
      let hash = 0;
      for (let char = 0; char < node.id.length; char += 1) hash = (hash * 31 + node.id.charCodeAt(char)) | 0;
      nodes.push({ node, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, phase: (Math.abs(hash % 1000) / 1000) * TAU, stress: stressFromNode(node) });
    });
  });
  return { nodes, clusters };
}

export const HIT_RADIUS = 14;
export function hitTest(nodes: readonly LaidOutNode[], x: number, y: number): TopologyNode | null {
  return nodes.find((item) => (item.x - x) ** 2 + (item.y - y) ** 2 < HIT_RADIUS ** 2)?.node ?? null;
}
