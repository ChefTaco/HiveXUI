// Saves the registry's HiveAuditRecord v1 export as JSON Lines, read page by page, oldest first.
import type { z } from 'zod';
import type { HiveAuditPage } from '../../../contracts/hiveskills.generated';

type Page = z.infer<typeof HiveAuditPage>;
/** 100 pages of 200: enough for a look in the browser; a full collection belongs to Cindertrace. */
export const MAX_EXPORT_PAGES = 100;

export async function exportAuditRecords(
  read: (after?: string) => Promise<Page>,
  save: (lines: string, name: string) => void = saveText,
  maxPages = MAX_EXPORT_PAGES,
): Promise<{ count: number; truncated: boolean }> {
  const lines: string[] = [];
  let after: string | undefined;
  let truncated = false;
  for (let page = 0; ; page += 1) {
    if (page === maxPages) {
      truncated = true;
      break;
    }
    const { data, nextCursor } = await read(after);
    for (const record of data) lines.push(JSON.stringify(record));
    // The last page still carries a cursor; an empty page, or no cursor, ends the export.
    if (data.length === 0 || !nextCursor || nextCursor === after) break;
    after = nextCursor;
  }
  save(lines.length ? lines.join('\n') + '\n' : '', `hiveskills-audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
  return { count: lines.length, truncated };
}

function saveText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
