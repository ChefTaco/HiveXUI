import { describe, expect, it } from 'vitest';
import { frac, hitTest, layoutNodes, makeStressColor, parseColor, stressFromNode } from './layout';
import { fleetOnly, topologyResponseSchema, type TopologyNode } from './schemas';

const node = (id: string, extra: Partial<TopologyNode> = {}): TopologyNode => ({ id, name: id, hostname: id, ip: '192.0.2.1', port: 4100, status: 'ONLINE', subnet: '192.0.2.0/24', reachable: true, latencyMs: 1, ...extra });
const subnet = (cidr: string, nodes: string[], isGateway = false) => ({ cidr, nodeCount: nodes.length, nodes, isGateway });

describe('fleet map layout', () => {
  it('rates a node by reachability, status and latency', () => {
    expect(stressFromNode(node('a', { reachable: false }))).toBe(1);
    expect(stressFromNode(node('a', { status: 'OFFLINE' }))).toBe(1);
    expect(stressFromNode(node('a', { status: 'DEGRADED' }))).toBe(0.75);
    expect(stressFromNode(node('a', { status: 'PROVISIONING' }))).toBe(0.45);
    expect(stressFromNode(node('a', { latencyMs: 101 }))).toBe(0.8);
    expect(stressFromNode(node('a', { latencyMs: 51 }))).toBe(0.55);
    expect(stressFromNode(node('a', { latencyMs: 21 }))).toBe(0.3);
    expect(stressFromNode(node('a', { latencyMs: null }))).toBe(0.12);
  });
  it('keeps a phase in range for an id whose hash is negative', () => {
    expect(frac(-0.25)).toBe(0.75);
    const { nodes } = layoutNodes({ nodes: [node('zzzzzzzzzzzzzzzz')], subnets: [] }, 800, 600);
    expect(nodes[0]!.phase).toBeGreaterThanOrEqual(0);
    expect(nodes[0]!.phase).toBeLessThan(Math.PI * 2);
  });
  it('centers the only subnet and rings its nodes', () => {
    const { nodes, clusters } = layoutNodes({ nodes: [node('a'), node('b'), node('c')], subnets: [subnet('s', ['a', 'b', 'c'])] }, 800, 600);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ x: 400, y: 300, size: 3 });
    expect(new Set(nodes.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`)).size).toBe(3);
  });
  it('puts the gateway in the middle and the others around it, inside the canvas', () => {
    const { nodes, clusters } = layoutNodes({ nodes: [node('a'), node('b'), node('c')], subnets: [subnet('g', ['a'], true), subnet('x', ['b']), subnet('y', ['c'])] }, 800, 600);
    expect(clusters[0]).toMatchObject({ x: 400, y: 300, isGateway: true });
    for (const item of nodes) {
      expect(item.x).toBeGreaterThan(0);
      expect(item.x).toBeLessThan(800);
      expect(item.y).toBeGreaterThan(0);
      expect(item.y).toBeLessThan(600);
    }
  });
  it('lays out an empty fleet without failing', () => {
    expect(layoutNodes({ nodes: [], subnets: [] }, 320, 320).nodes).toEqual([]);
  });
  it('hits a node within reach and nothing beyond it', () => {
    const { nodes } = layoutNodes({ nodes: [node('a')], subnets: [subnet('s', ['a'])] }, 800, 600);
    expect(hitTest(nodes, 410, 300)?.id).toBe('a');
    expect(hitTest(nodes, 430, 300)).toBeNull();
  });
});

describe('fleet map colors', () => {
  it('reads hex and rgb tokens', () => {
    expect(parseColor('#216d69')).toEqual([0x21, 0x6d, 0x69]);
    expect(parseColor('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseColor('rgb(1 2 3 / 0.5)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(4, 5, 6, 0.5)')).toEqual([4, 5, 6]);
    expect(parseColor('')).toEqual([128, 128, 128]);
  });
  it('runs from success through warning to danger', () => {
    const color = makeStressColor({ success: '#000000', warning: '#808080', danger: '#ffffff' });
    expect(color(0)).toBe('rgba(0,0,0,1)');
    expect(color(0.5, 0.5)).toBe('rgba(128,128,128,0.5)');
    expect(color(1)).toBe('rgba(255,255,255,1)');
    expect(color(9)).toBe('rgba(255,255,255,1)');
  });
});

describe('the topology answer', () => {
  it('leaves out the own records of the server, and a subnet that held only those', () => {
    const map = fleetOnly({
      nodes: [node('__control-api__'), node('__dashboard__'), node('a')],
      edges: [{ from: '__control-api__', to: 'a', latencyMs: 1, type: 'same-subnet' }, { from: 'a', to: 'b', latencyMs: 1, type: 'same-subnet' }],
      subnets: [subnet('mixed', ['__control-api__', 'a']), subnet('own', ['__dashboard__'])],
      scannedAt: '2026-11-05T10:00:00Z',
    });
    expect(map.nodes.map((item) => item.id)).toEqual(['a']);
    expect(map.edges).toHaveLength(1);
    expect(map.subnets).toEqual([subnet('mixed', ['a'])]);
  });
  it('keeps what the map needs and strips the rest', () => {
    const parsed = topologyResponseSchema.parse({ success: true, data: { nodes: [{ ...node('a'), lastHeartbeatAt: null }], edges: [], subnets: [], scannedAt: '2026-11-05T10:00:00Z' } });
    expect(parsed.data.nodes[0]).not.toHaveProperty('lastHeartbeatAt');
  });
});
