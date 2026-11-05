import { z } from 'zod';
import { diskInfoSchema, nodeHealthResponseSchema, nodeListResponseSchema } from '@contracts/magnus/browser';
import { magnus, segment } from '../../../api/client';
import { MagnusApiError } from '../../../api/errors';

export type NodeRow = z.output<typeof nodeListResponseSchema>['data'][number];
export type NodeHealth = z.output<typeof nodeHealthResponseSchema>['data'];
type Disk = z.output<typeof diskInfoSchema>;

const PAGE_SIZE = 100;
/** A fleet larger than this needs paging on screen. It is reported rather than silently cut off. */
const MAX_PAGES = 20;
const HEALTH_CONCURRENCY = 6;

/** Every node. The old console read only the first page, which hid nodes in a large fleet. */
export async function listAllNodes(signal: AbortSignal): Promise<{ nodes: NodeRow[]; total: number }> {
  const nodes: NodeRow[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await magnus.get('/nodes', nodeListResponseSchema, { query: { page, pageSize: PAGE_SIZE }, signal });
    nodes.push(...result.data);
    total = result.meta.total;
    if (!result.meta.hasMore) break;
  }
  return { nodes, total };
}

export function nodeError(metadata: string): { label: string; message: string } | null {
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (typeof parsed.deployError === 'string') return { label: 'Deploy failed', message: parsed.deployError };
    if (typeof parsed.upgradeError === 'string') return { label: 'Upgrade failed', message: parsed.upgradeError };
  } catch {
    // An unreadable column is not an error to show on the row.
  }
  return null;
}

export function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export const USER_DISK_WARNING_PERCENT = 80;
export const USER_DISK_CRITICAL_PERCENT = 95;
const SYSTEM_MOUNT_PREFIXES = ['/boot', '/snap', '/var/lib/docker/', '/var/lib/containers/'];
const READ_ONLY_FILESYSTEMS = new Set(['iso9660', 'squashfs']);

export function parseDisks(disks: string | null | undefined): Disk[] {
  if (!disks) return [];
  try {
    const parsed = z.array(diskInfoSchema).safeParse(JSON.parse(disks));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** The fullest filesystem that holds workload data. */
export function worstPersistentDisk(disks: string | null | undefined): Disk | null {
  return parseDisks(disks)
    .filter((disk) => disk.mountPoint === '/' || disk.mountPoint === '/home' || disk.mountPoint.startsWith('/home/') || disk.mountPoint.startsWith('/mnt/') || disk.mountPoint.startsWith('/srv/'))
    .filter((disk) => !SYSTEM_MOUNT_PREFIXES.some((prefix) => disk.mountPoint === prefix || disk.mountPoint.startsWith(prefix)))
    .filter((disk) => !READ_ONLY_FILESYSTEMS.has((disk.filesystemType ?? '').toLowerCase()))
    .sort((left, right) => right.usagePercent - left.usagePercent)[0] ?? null;
}

export const diskSeverity = (percent: number): 'normal' | 'warning' | 'critical' => (percent >= USER_DISK_CRITICAL_PERCENT ? 'critical' : percent >= USER_DISK_WARNING_PERCENT ? 'warning' : 'normal');
