// Text comparison for Compare, on jsdiff. Pure, so tests read it directly.
import { diffLines, diffWordsWithSpace } from 'diff';

export type DiffPart = { kind: 'same' | 'add' | 'del'; text: string };
export type Granularity = 'words' | 'lines';

export function diffText(before: string, after: string, granularity: Granularity): DiffPart[] {
  const changes = granularity === 'lines' ? diffLines(before, after) : diffWordsWithSpace(before, after);
  return changes.map((change) => ({ kind: change.added ? 'add' : change.removed ? 'del' : 'same', text: change.value }));
}

/** The two sides of a side-by-side view: the earlier text with removals, the later with additions. */
export function sides(parts: readonly DiffPart[]): { before: DiffPart[]; after: DiffPart[] } {
  return { before: parts.filter((part) => part.kind !== 'add'), after: parts.filter((part) => part.kind !== 'del') };
}

export function diffStats(parts: readonly DiffPart[]): { added: number; removed: number } {
  const count = (kind: DiffPart['kind']) => parts.filter((part) => part.kind === kind).reduce((sum, part) => sum + part.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return { added: count('add'), removed: count('del') };
}
