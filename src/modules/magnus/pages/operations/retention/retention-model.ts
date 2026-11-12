import type { z } from 'zod';
import type { retentionSummaryResponseSchema, retentionTableSchema } from '@contracts/magnus/browser';

export type RetentionSummary = z.output<typeof retentionSummaryResponseSchema>['data'];
export type RetentionTable = z.output<typeof retentionTableSchema>;

export const totalRecords = (tables: readonly RetentionTable[]): number => tables.reduce((sum, table) => sum + table.count, 0);

/** A table's share of every tracked row, in percent. Nothing tracked is 0, not a division by zero. */
export const shareOf = (count: number, total: number): number => (total > 0 ? (count / total) * 100 : 0);

/**
 * What the oldest column says. The server reports no oldest row for tables kept for manual review, so a
 * table with rows but no date is "Not tracked", and an empty one has nothing to age.
 */
export const oldestState = (table: RetentionTable): 'dated' | 'untracked' | 'empty' => (table.oldestAt ? 'dated' : table.count > 0 ? 'untracked' : 'empty');

/** The server names cutoffs in camel case: fullFidelityAfter reads "Full fidelity after". */
export function cutoffLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Tables kept by hand, for the policy summary. */
export const manualTables = (tables: readonly RetentionTable[]): RetentionTable[] => tables.filter((table) => /manual/i.test(table.policy));
