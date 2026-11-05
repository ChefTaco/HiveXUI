import { Radar, radarRandom, type RadarBlip, type RadarBlipTone } from '../../../components/radar';

export interface FleetRadarCounts {
  online: number;
  degraded: number;
  offline: number;
  provisioning: number;
}
const TONE: Record<keyof FleetRadarCounts, RadarBlipTone> = { online: 'success', degraded: 'warning', offline: 'danger', provisioning: 'info' };
const BANDS: Record<keyof FleetRadarCounts, readonly [number, number]> = {
  online: [0.45, 0.92],
  provisioning: [0.3, 0.7],
  degraded: [0.15, 0.55],
  offline: [0.15, 0.55],
};
const MAX_BLIPS = 64;

/** One blip per real node, colored by status, under a rotating sweep. Problem nodes sit nearer the center. */
export function FleetRadar({ counts, size = 176, className }: { counts: FleetRadarCounts; size?: number; className?: string }) {
  const blips: RadarBlip[] = [];
  let seed = 1;
  for (const status of ['offline', 'degraded', 'provisioning', 'online'] as const)
    for (let index = 0; index < counts[status] && blips.length < MAX_BLIPS; index += 1, seed += 1) {
      const [low, high] = BANDS[status];
      blips.push({ key: `${status}-${index}`, tone: TONE[status], distance: low + radarRandom(seed) * (high - low), angle: radarRandom(seed + 101) * 360 });
    }
  const total = counts.online + counts.degraded + counts.offline + counts.provisioning;
  return <Radar blips={blips} value={total} unit="nodes" size={size} {...(className ? { className } : {})} label={`Fleet radar: ${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline, ${counts.provisioning} provisioning`} />;
}
