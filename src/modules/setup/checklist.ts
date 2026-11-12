// The setup checklist as the Hive Registry records it, and what HiveXUI says about each item. Pure
// data and no React. The browser never writes the checklist: `./hive.sh post-upgrade` and
// `./hive.sh setup done|skip ID` do, so everything here only reads and explains.
import type { RegistrySetupItem } from '../../lib/registry';
import type { Tone } from '@ui';

/** A readiness probe's answer: whether what the item asks for is already in place. */
export type ProbeResult =
  | { state: 'done'; detail: string }
  | { state: 'not-done'; detail: string }
  /** It could not tell: the product is absent, refused the read, or did not answer. */
  | { state: 'unknown'; detail: string };
export type ProbeState = { state: 'checking' } | ProbeResult;

/** The command that records an item the probe found done. */
export const POST_UPGRADE = './hive.sh post-upgrade';
/**
 * `post-upgrade` records what it completes itself; an item settled by hand (the first
 * administrator, the Ardent packages) is recorded by its own `setup done` command.
 */
export const recordCommand = (item: RegistrySetupItem): string => (/\bsetup\s+done\b/.test(item.command) ? item.command : POST_UPGRADE);

/** Pending first, then settled items, each in the Registry's order. */
export const orderItems = (items: readonly RegistrySetupItem[]): RegistrySetupItem[] => [
  ...items.filter((item) => item.status === 'pending'),
  ...items.filter((item) => item.status !== 'pending'),
];

/** Products named on items, for the item's label. An id this table does not know shows as it is. */
const PRODUCT_NAME: Readonly<Record<string, string>> = {
  magnus: 'Magnus',
  oathweave: 'Oathweave',
  ingress: 'Ingress',
  emberpath: 'Emberpath',
  hivemem: 'HiveMem',
  hiveskills: 'HiveSkills',
  cindertrace: 'Cindertrace',
  chattermost: 'ChatterMost',
  embermend: 'Embermend',
  ardentstudio: 'Ardent Project Studio',
};
export const productName = (id: string): string => PRODUCT_NAME[id] ?? id;

export interface ItemVerdict {
  label: string;
  tone: Tone;
  /** The item is pending in the Registry, but its probe found it done. */
  looksDone: boolean;
}

/** The badge an item shows: the Registry's status, unless a probe says a pending item is in place. */
export function verdict(item: RegistrySetupItem, probe: ProbeState | undefined): ItemVerdict {
  if (item.status === 'done') return { label: 'Done', tone: 'success', looksDone: false };
  if (item.status === 'skipped') return { label: 'Skipped', tone: 'neutral', looksDone: false };
  if (probe?.state === 'done') return { label: 'Looks done', tone: 'info', looksDone: true };
  return { label: 'Pending', tone: 'warning', looksDone: false };
}

/** How many items wait for a person, for the nudge and the page header. */
export const pendingLabel = (count: number): string => (count === 1 ? '1 step pending' : `${count} steps pending`);
