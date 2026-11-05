import type { Tone } from '@ui';

interface Snapshot {
  cpuUsagePercent: number;
  memoryPercent: number;
}
interface PersonalityNode {
  id: string;
  hostname: string;
  status: string;
  lastHeartbeatAt: string | null;
}
interface Archetype {
  name: string;
  emoji: string;
  description: string;
  tone: Tone;
}
interface Stats {
  cpuAvg: number;
  cpuStdDev: number;
  memAvg: number;
  samples: number;
  spikes: number;
}
export interface NodePersonality {
  archetype: Archetype;
  archetypeKey: ArchetypeKey;
  bio: string;
  stats: Stats;
}

const ARCHETYPES = {
  workhorse: { name: 'Workhorse', emoji: '🐴', description: 'Steady, reliable, never complains.', tone: 'success' },
  'drama-queen': { name: 'Drama Queen', emoji: '🎭', description: 'High variance, loves spiking CPU for attention.', tone: 'warning' },
  'zen-master': { name: 'Zen Master', emoji: '🧘', description: 'Low usage, mind always clear, never stressed.', tone: 'info' },
  sprinter: { name: 'Sprinter', emoji: '⚡', description: 'Bursts of intense activity followed by calm recovery.', tone: 'info' },
  groundhog: { name: 'Groundhog', emoji: '🌀', description: 'Keeps rebooting — might see its own shadow again.', tone: 'warning' },
  ghost: { name: 'Ghost', emoji: '👻', description: 'Often unreachable. Is it even there?', tone: 'danger' },
  marathoner: { name: 'Marathoner', emoji: '🏃', description: 'Long uptime, steady pace, built to last.', tone: 'success' },
  rookie: { name: 'Rookie', emoji: '🌱', description: 'Not enough history yet — still finding its rhythm.', tone: 'neutral' },
} as const satisfies Record<string, Archetype>;
type ArchetypeKey = keyof typeof ARCHETYPES;

const GHOST_AFTER_MS = 10 * 60_000;
const WEEK_MS = 1000 * 60 * 60 * 24 * 7;
const mean = (values: readonly number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function archetypeFor(node: PersonalityNode, samples: number, cpuAvg: number, cpuSD: number, spikeShare: number, now: number): ArchetypeKey {
  if (node.status === 'OFFLINE' || (node.lastHeartbeatAt && now - new Date(node.lastHeartbeatAt).getTime() > GHOST_AFTER_MS)) return 'ghost';
  if (samples < 3) return 'rookie';
  if (cpuSD > 25 || spikeShare > 0.25) return spikeShare > 0.4 ? 'drama-queen' : 'sprinter';
  if (cpuAvg < 15 && cpuSD < 10) return 'zen-master';
  if (cpuAvg > 40 && cpuAvg < 75 && cpuSD < 15) return 'workhorse';
  if (cpuAvg < 40 && cpuSD < 15 && samples > 20) return 'marathoner';
  return 'workhorse';
}

/** The same line all week for one node, a new one next week. */
function pickBio(node: PersonalityNode, key: ArchetypeKey, stats: Stats, now: number): string {
  const { hostname } = node;
  const cpu = stats.cpuAvg.toFixed(0);
  const templates: Record<ArchetypeKey, string[]> = {
    workhorse: [`Steady as they come — averaging ${cpu}% CPU without a single complaint this week.`, `The dependable one. ${hostname} just keeps grinding through the workload.`, `Quietly productive at ~${cpu}% CPU. Gets the job done and asks for nothing.`],
    'drama-queen': [`Lives for the spotlight — ${stats.spikes} CPU spikes this week and counting.`, `${hostname} likes to keep things interesting with a ±${stats.cpuStdDev.toFixed(0)}% swing.`, 'A connoisseur of chaos. Never a dull moment with this one.'],
    'zen-master': [`Practices minimalism. Barely breaks a sweat at ${cpu}% CPU.`, `${hostname} is in its happy place — calm, cool, collected.`, 'Achieving enlightenment one idle cycle at a time.'],
    sprinter: [`Bursts of energy, then recovery. ${stats.spikes} sprints logged this week.`, `${hostname} runs hot, then cools down. Classic sprinter cadence.`, 'Lives in intervals — full throttle, then full zen.'],
    groundhog: ['Déjà vu all over again. Might want to check the uptime.', `${hostname} keeps hitting the reset button.`],
    ghost: ["Hasn't been seen in a while. Anyone home?", `${hostname} is currently out of contact. Check the heartbeat.`],
    marathoner: [`In it for the long haul — ${stats.samples} data points of pure consistency.`, `${hostname} doesn't sprint. It endures.`],
    rookie: ['Still new around here — gathering experience.', `${hostname} is just getting started. Check back soon.`],
  };
  let hash = Math.floor(now / WEEK_MS);
  for (let index = 0; index < node.id.length; index += 1) hash = (hash * 31 + node.id.charCodeAt(index)) | 0;
  const lines = templates[key];
  return lines[Math.abs(hash) % lines.length]!;
}

export function computePersonality(node: PersonalityNode, snapshots: readonly Snapshot[], now = Date.now()): NodePersonality {
  const cpus = snapshots.map((snapshot) => snapshot.cpuUsagePercent).filter(Number.isFinite);
  const mems = snapshots.map((snapshot) => snapshot.memoryPercent).filter(Number.isFinite);
  const spikes = cpus.filter((value) => value > 80).length;
  const stats: Stats = { cpuAvg: mean(cpus), cpuStdDev: stdDev(cpus), memAvg: mean(mems), samples: cpus.length, spikes };
  const key = archetypeFor(node, snapshots.length, stats.cpuAvg, stats.cpuStdDev, spikes / Math.max(1, cpus.length), now);
  return { archetype: ARCHETYPES[key], archetypeKey: key, bio: pickBio(node, key, stats, now), stats };
}
