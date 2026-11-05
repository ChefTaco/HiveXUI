import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link2Off } from 'lucide-react';
import { readThemeColors, type ThemeColors } from '@lib/theme-colors';
import { subscribeTheme } from '@lib/theme';
import { cn } from '@lib/cn';
import { HaloDot, useReducedMotion } from '../../../effects';
import Link from '../../../navigation';
import { frac, hitTest, layoutNodes, makeStressColor, parseColor, TAU, type Cluster, type LaidOutNode } from './layout';
import type { TopologyMap, TopologyNode } from './schemas';

const GLOW_BUCKETS = 8;
const LABEL_FONT_PX = 12;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A radial glow per stress level. drawImage is far cheaper than shadowBlur per node. */
function buildGlowSprites(stressColor: (stress: number, alpha?: number) => string, dpr: number): HTMLCanvasElement[] {
  const size = Math.ceil(64 * dpr);
  return Array.from({ length: GLOW_BUCKETS }, (_, index) => {
    const sprite = makeCanvas(size, size);
    const context = sprite.getContext('2d');
    if (!context) return sprite;
    const stress = index / (GLOW_BUCKETS - 1);
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, stressColor(stress, 0.55));
    gradient.addColorStop(0.35, stressColor(stress, 0.18));
    gradient.addColorStop(1, stressColor(stress, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return sprite;
  });
}

/** The polar grid and subnet halos, drawn once per layout. */
function buildBackground(width: number, height: number, dpr: number, colors: ThemeColors, clusters: readonly Cluster[], font: string): HTMLCanvasElement {
  const background = makeCanvas(Math.floor(width * dpr), Math.floor(height * dpr));
  const g = background.getContext('2d');
  if (!g) return background;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = colors['surface-page'];
  g.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  const [pr, pg, pb] = parseColor(colors.accent);
  g.lineWidth = 1;
  for (let r = 60; r < maxR; r += 60) {
    g.strokeStyle = `rgba(${pr},${pg},${pb},${r % 180 === 0 ? 0.16 : 0.08})`;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = `rgba(${pr},${pg},${pb},0.07)`;
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    g.stroke();
  }
  const [ar, ag, ab] = parseColor(colors.info);
  g.font = `${LABEL_FONT_PX}px ${font}`;
  // A one-node subnet, such as a per-host tailnet /24, gets no halo or label: the node's name says enough.
  for (const cluster of clusters.filter((item) => item.size > 1)) {
    const [r, gg, b] = cluster.isGateway ? [ar, ag, ab] : [pr, pg, pb];
    const halo = g.createRadialGradient(cluster.x, cluster.y, cluster.r * 0.2, cluster.x, cluster.y, cluster.r);
    halo.addColorStop(0, `rgba(${r},${gg},${b},0.08)`);
    halo.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = halo;
    g.beginPath();
    g.arc(cluster.x, cluster.y, cluster.r, 0, TAU);
    g.fill();
    g.setLineDash([3, 5]);
    g.strokeStyle = `rgba(${r},${gg},${b},0.35)`;
    g.beginPath();
    g.arc(cluster.x, cluster.y, cluster.r, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `rgba(${r},${gg},${b},0.8)`;
    g.fillText(cluster.isGateway ? `${cluster.cidr} · gateway` : cluster.cidr, cluster.x - cluster.r * 0.7, cluster.y - cluster.r - 6);
  }
  return background;
}

/** The live topology map: radar sweep, heartbeat rings, glow by stress and packets along edges in flight. */
export function FleetMapCanvas({ topology, inFlight, selectedNodeId, onSelectNode, scanning }: {
  topology: TopologyMap;
  /** Keep this stable between changes: a new array restarts the frame loop. */
  inFlight: readonly string[];
  selectedNodeId: string | null;
  onSelectNode: (node: TopologyNode | null) => void;
  scanning: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const laidOut = useRef<LaidOutNode[]>([]);
  const hover = useRef<string | null>(null);
  const selected = useRef<string | null>(selectedNodeId);
  const redraw = useRef<(() => void) | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [fps, setFps] = useState(60);
  const reduced = useReducedMotion();
  const [colors, setColors] = useState<ThemeColors | null>(null);

  useEffect(() => {
    setColors(readThemeColors());
    return subscribeTheme(() => setColors(readThemeColors()));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ w: Math.max(240, Math.floor(box.width)), h: Math.max(320, Math.floor(box.height)) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A selection repaints without restarting the loop.
  useEffect(() => {
    selected.current = selectedNodeId;
    redraw.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !colors) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ctx = context;
    const palette = colors;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const font = getComputedStyle(document.body).fontFamily || 'monospace';
    const layout = layoutNodes(topology, size.w, size.h);
    laidOut.current = layout.nodes;
    const byId = new Map(layout.nodes.map((item) => [item.node.id, item] as const));
    const flying = new Set(inFlight);
    const stressColor = makeStressColor(palette);
    const sprites = buildGlowSprites(stressColor, dpr);
    const background = buildBackground(size.w, size.h, dpr, palette, layout.clusters, font);
    const [pr, pg, pb] = parseColor(palette.accent);
    const [ar, ag, ab] = parseColor(palette.info);
    const cx = size.w / 2;
    const cy = size.h / 2;
    const sweepR = Math.hypot(cx, cy);
    const labelAll = layout.nodes.length <= 32;
    // A dense mesh, with every node in its own subnet, would otherwise drown the nodes.
    const edgeFade = Math.min(1, 24 / Math.max(1, topology.edges.length));
    const animate = !reduced;

    const draw = (t: number): void => {
      ctx.drawImage(background, 0, 0, size.w, size.h);

      if (animate && typeof ctx.createConicGradient === 'function') {
        const angle = (t * 0.6) % TAU;
        const sweep = ctx.createConicGradient(angle - 0.9, cx, cy);
        sweep.addColorStop(0, `rgba(${pr},${pg},${pb},0)`);
        sweep.addColorStop(0.14, `rgba(${pr},${pg},${pb},0.14)`);
        sweep.addColorStop(0.1433, `rgba(${pr},${pg},${pb},0)`);
        sweep.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(cx, cy, sweepR, 0, TAU);
        ctx.fill();
      }

      ctx.lineWidth = 1;
      for (const edge of topology.edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        ctx.strokeStyle = edge.type === 'same-subnet' ? `rgba(${pr},${pg},${pb},${0.3 * edgeFade + 0.05})` : `rgba(${ar},${ag},${ab},${0.24 * edgeFade + 0.04})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      if (flying.size > 0) {
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = animate ? -(t * 60) % 20 : 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${pr},${pg},${pb},0.85)`;
        for (const edge of topology.edges) {
          if (!flying.has(edge.from) && !flying.has(edge.to)) continue;
          const a = byId.get(edge.from);
          const b = byId.get(edge.to);
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          if (animate) {
            const k = frac(t * 0.5 + a.phase / TAU);
            ctx.fillStyle = `rgba(${pr},${pg},${pb},0.95)`;
            ctx.beginPath();
            ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 2.5, 0, TAU);
            ctx.fill();
          }
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      ctx.font = `${LABEL_FONT_PX}px ${font}`;
      for (const { x, y, phase, stress, node } of layout.nodes) {
        const isSelected = selected.current === node.id;
        const isHover = hover.current === node.id;
        const sprite = sprites[Math.round(stress * (GLOW_BUCKETS - 1))];
        if (sprite) ctx.drawImage(sprite, x - 32, y - 32, 64, 64);

        // The heartbeat ring of a node that answers.
        if (node.reachable && animate) {
          const pulse = frac(t * 0.6 + phase / TAU);
          ctx.strokeStyle = stressColor(stress, 0.45 * (1 - pulse));
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0, 8 + pulse * 16), 0, TAU);
          ctx.stroke();
        }

        ctx.fillStyle = palette['surface-page'];
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = stressColor(stress);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = stressColor(stress, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, TAU);
        ctx.stroke();

        if (isSelected || isHover) {
          ctx.strokeStyle = palette.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, TAU);
          ctx.stroke();
          for (let corner = 0; corner < 4; corner += 1) {
            const angle = corner * (Math.PI / 2) + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(angle) * 15, y + Math.sin(angle) * 15);
            ctx.lineTo(x + Math.cos(angle) * 19, y + Math.sin(angle) * 19);
            ctx.stroke();
          }
        }

        if (isHover || isSelected || labelAll) {
          ctx.fillStyle = isHover || isSelected ? palette.text : `rgba(${pr},${pg},${pb},0.85)`;
          // On a phone the name of a node near the edge goes above it, clear of its neighbors' names.
          const width = ctx.measureText(node.name).width;
          if (x + 14 + width > size.w) ctx.fillText(node.name, Math.max(2, Math.min(size.w - width - 2, x - width / 2)), y - 16);
          else ctx.fillText(node.name, x + 14, y + 4);
        }
      }
    };

    let frame: number | null = null;
    let visible = true;
    let lastFrame = performance.now();
    let samples = 0;
    let elapsed = 0;
    const tick = (now: number): void => {
      elapsed += now - lastFrame;
      lastFrame = now;
      samples += 1;
      if (samples >= 30) {
        setFps(Math.min(120, Math.round(1000 / Math.max(1, elapsed / samples))));
        samples = 0;
        elapsed = 0;
      }
      draw(now / 1000);
      frame = visible ? requestAnimationFrame(tick) : null;
    };
    const start = (): void => {
      if (frame === null && animate && visible) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    // The loop rests while the map is scrolled out of view.
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) start();
    });
    observer.observe(canvas);
    if (animate) {
      redraw.current = null; // The loop repaints every frame.
      start();
    } else {
      redraw.current = () => draw(0);
      draw(0);
    }
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      redraw.current = null;
    };
  }, [topology, size.w, size.h, inFlight, colors, reduced]);

  const pointer = (event: MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return hitTest(laidOut.current, event.clientX - box.left, event.clientY - box.top);
  };
  const overlay = 'absolute rounded-chip border border-border bg-surface/80 px-2 py-1 text-xs text-text-muted backdrop-blur-sm';
  const dot = 'inline-block size-2 rounded-pill';
  return (
    <div ref={containerRef} className="panel-corners relative h-[440px] w-full overflow-hidden rounded-panel border border-border-strong bg-bg glow-accent [--panel-corner-color:var(--accent)] sm:h-[600px]">
      <canvas
        ref={canvasRef}
        onClick={(event) => onSelectNode(pointer(event))}
        onMouseMove={(event) => {
          const id = pointer(event)?.id ?? null;
          if (id === hover.current) return;
          hover.current = id;
          event.currentTarget.style.cursor = id ? 'pointer' : 'default';
          redraw.current?.();
        }}
        onMouseLeave={() => {
          hover.current = null;
          redraw.current?.();
        }}
        data-testid="fleet-map-canvas"
        data-node-count={topology.nodes.length}
        role="img"
        aria-label={`Fleet topology: ${topology.nodes.length} nodes across ${topology.subnets.length} subnets. The grid view lists them.`}
      />
      {scanning && !reduced ? <span className="fx-scanline" aria-hidden="true" /> : null}
      {topology.nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="rounded-panel border border-border bg-surface/80 p-4 text-center text-sm backdrop-blur-sm">
            <Link2Off aria-hidden="true" className="mx-auto mb-2 size-5 text-text-muted" />
            <p className="m-0 font-medium">No nodes to map yet</p>
            <p className="m-0 mt-1 text-text-muted">Registered nodes appear here. <Link href="/nodes">Go to nodes</Link></p>
          </div>
        </div>
      ) : null}
      <div className={cn(overlay, 'left-3 top-3 flex items-center gap-2')}>
        {reduced ? <span className="text-accent">static</span> : <span className={cn('num', fps >= 55 ? 'text-success' : fps >= 30 ? 'text-warning' : 'text-danger')}>{fps} fps</span>}
        <span aria-hidden="true">·</span>
        <span className="num">{topology.nodes.length} {topology.nodes.length === 1 ? 'node' : 'nodes'}</span>
      </div>
      <div className={cn(overlay, 'bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-3 gap-y-1 sm:right-auto')}>
        <span className="flex items-center gap-1"><span className={cn(dot, 'bg-success shadow-[0_0_6px_var(--success)]')} />healthy</span>
        <span className="flex items-center gap-1"><span className={cn(dot, 'bg-warning shadow-[0_0_6px_var(--warning)]')} />stressed</span>
        <span className="flex items-center gap-1"><span className={cn(dot, 'bg-danger shadow-[0_0_6px_var(--danger)]')} />critical</span>
        <span className="flex items-center gap-1"><span className="inline-block h-px w-3 bg-accent" />subnet</span>
        <span className="flex items-center gap-1"><span className="inline-block h-px w-3 bg-info" />cross-subnet</span>
        {inFlight.length > 0 ? <span className="flex items-center gap-1 text-accent"><HaloDot tone="accent" />{inFlight.length} in-flight</span> : null}
      </div>
    </div>
  );
}
