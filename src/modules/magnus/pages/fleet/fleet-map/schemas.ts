import { z } from 'zod';

// No contract yet: GET /topology and POST /topology/scan are browser routes outside the first wave.
// Shape from services/control-api/src/services/topology-service.ts in Magnus.
const topologyNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  ip: z.string(),
  port: z.number(),
  status: z.string(),
  subnet: z.string(),
  reachable: z.boolean(),
  latencyMs: z.number().nullable(),
});
const topologyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  latencyMs: z.number().nullable(),
  type: z.enum(['same-subnet', 'cross-subnet']),
});
const topologySubnetSchema = z.object({
  cidr: z.string(),
  nodeCount: z.number(),
  nodes: z.array(z.string()),
  isGateway: z.boolean(),
});
const topologyMapSchema = z.object({
  nodes: z.array(topologyNodeSchema),
  edges: z.array(topologyEdgeSchema),
  subnets: z.array(topologySubnetSchema),
  scannedAt: z.string(),
});
export const topologyResponseSchema = z.object({ success: z.literal(true), data: topologyMapSchema });

export type TopologyMap = z.output<typeof topologyMapSchema>;
export type TopologyNode = z.output<typeof topologyNodeSchema>;

// Records the server keeps for its own logs. They are not machines, and GET /topology still returns them.
const SENTINEL_NODE_IDS: ReadonlySet<string> = new Set(['__control-api__', '__dashboard__']);
export function fleetOnly(map: TopologyMap): TopologyMap {
  const real = (id: string) => !SENTINEL_NODE_IDS.has(id);
  return {
    ...map,
    nodes: map.nodes.filter((node) => real(node.id)),
    edges: map.edges.filter((edge) => real(edge.from) && real(edge.to)),
    subnets: map.subnets.flatMap((subnet) => {
      const nodes = subnet.nodes.filter(real);
      return nodes.length ? [{ ...subnet, nodes, nodeCount: nodes.length }] : [];
    }),
  };
}
