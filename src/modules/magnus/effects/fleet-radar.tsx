import { cn } from '@lib/cn';

export interface FleetRadarCounts {
  online: number;
  degraded: number;
  offline: number;
  provisioning: number;
}
const BLIP: Record<keyof FleetRadarCounts, string> = {
  online: 'fx-blip--success',
  degraded: 'fx-blip--warning',
  offline: 'fx-blip--danger',
  provisioning: 'fx-blip--info',
};
const BANDS: Record<keyof FleetRadarCounts, readonly [number, number]> = {
  online: [0.45, 0.92],
  provisioning: [0.3, 0.7],
  degraded: [0.15, 0.55],
  offline: [0.15, 0.55],
};
/** Deterministic, so blips do not jump between renders. */
function rand(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}
const MAX_BLIPS = 64;

/** One blip per real node, colored by status, under a rotating sweep. Problem nodes sit nearer the center. */
export function FleetRadar({ counts, size = 176, className }: { counts: FleetRadarCounts; size?: number; className?: string }) {
  const blips: Array<{ key: string; status: keyof FleetRadarCounts; x: number; y: number }> = [];
  let seed = 1;
  for (const status of ['offline', 'degraded', 'provisioning', 'online'] as const)
    for (let index = 0; index < counts[status] && blips.length < MAX_BLIPS; index += 1, seed += 1) {
      const [low, high] = BANDS[status];
      const radius = low + rand(seed) * (high - low);
      const angle = rand(seed + 101) * Math.PI * 2;
      blips.push({ key: `${status}-${index}`, status, x: 50 + Math.cos(angle) * radius * 50, y: 50 + Math.sin(angle) * radius * 50 });
    }
  const total = counts.online + counts.degraded + counts.offline + counts.provisioning;
  return (
    <div role="img" aria-label={`Fleet radar: ${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline, ${counts.provisioning} provisioning`} className={cn('fx-radar', className)} style={{ width: size, height: size }}>
      <div className="fx-radar__ring inset-[16%]" />
      <div className="fx-radar__ring inset-[33%]" />
      <div className="fx-radar__axis inset-y-0 left-1/2 w-px" />
      <div className="fx-radar__axis inset-x-0 top-1/2 h-px" />
      <div aria-hidden="true" className="fx-radar__sweep animate-sweep" />
      {blips.map((blip) => <span key={blip.key} aria-hidden="true" className={cn('fx-blip', BLIP[blip.status])} style={{ left: `${blip.x}%`, top: `${blip.y}%` }} />)}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num glow-text-accent text-2xl font-bold text-accent">{total}</span>
        <span className="text-xs text-text-muted">nodes</span>
      </div>
    </div>
  );
}
