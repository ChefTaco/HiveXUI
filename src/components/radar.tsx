import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type RadarBlipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export interface RadarBlip {
  key: string;
  tone: RadarBlipTone;
  /** Distance from the center, 0 to 1. */
  distance: number;
  /** Degrees. */
  angle: number;
}
/** Deterministic, so blips do not jump between renders. */
export function radarRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Real things as blips under a rotating sweep, with a readout at the center. */
export function Radar({ blips, label, value, unit, size = 176, className }: { blips: readonly RadarBlip[]; label: string; value: ReactNode; unit: string; size?: number; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn('fx-radar', className)} style={{ width: size, height: size }}>
      <div className="fx-radar__ring inset-[16%]" />
      <div className="fx-radar__ring inset-[33%]" />
      <div className="fx-radar__axis inset-y-0 left-1/2 w-px" />
      <div className="fx-radar__axis inset-x-0 top-1/2 h-px" />
      <div aria-hidden="true" className="fx-radar__sweep animate-sweep" />
      {blips.map((blip) => (
        <span
          key={blip.key}
          aria-hidden="true"
          className={cn('fx-blip', blip.tone !== 'neutral' && `fx-blip--${blip.tone}`)}
          style={{ left: `${50 + Math.cos((blip.angle * Math.PI) / 180) * blip.distance * 50}%`, top: `${50 + Math.sin((blip.angle * Math.PI) / 180) * blip.distance * 50}%` }}
        />
      ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num data-figure glow-text-accent text-2xl font-bold text-accent">{value}</span>
        <span className="stat-label">{unit}</span>
      </div>
    </div>
  );
}
