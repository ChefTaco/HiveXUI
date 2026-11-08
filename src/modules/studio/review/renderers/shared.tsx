import { useEffect, type RefObject } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@ui';
import { saveBlob } from '../../../magnus/pages/agents/ardent/api';
import type { CommentAnchor, ReviewComment, Revision } from '../api';
import type { Content } from '../content';

/** What every PreviewRenderer is given. */
export interface RendererProps {
  revision: Revision;
  content: Content;
  /** The download name. */
  name: string;
  comments: readonly ReviewComment[];
  /** The comment to show, from its card or the address. */
  focused: string | null;
  /** A selection or a drawn region became an anchor for the next comment. */
  onAnchor: (anchor: CommentAnchor) => void;
  readOnly: boolean;
}

export function DownloadButton({ content, name, label = 'Download' }: { content: Content; name: string; label?: string }) {
  return (
    <Button size="sm" icon={<Download className="size-4" />} onClick={() => saveBlob(content.blob, name)}>
      {label}
    </Button>
  );
}

/**
 * Paints ranges with the CSS Custom Highlight API, so comment marks never change the rendered
 * text (and so never move a selection's offsets). Browsers without it simply show no marks.
 */
export function paint(name: string, ranges: readonly Range[]): () => void {
  const registry = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
  const HighlightType = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightType) return () => undefined;
  registry.set(name, new HighlightType(...ranges));
  return () => registry.delete(name);
}

/** Calls back with the selection when the person finishes selecting inside `root`. */
export function useSelection(root: RefObject<HTMLElement | null>, onSelect: (range: Range, text: string) => void, enabled = true): void {
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    const finish = () => {
      const selection = element.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
      const text = selection.toString();
      if (text.trim()) onSelect(range, text);
    };
    const key = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') finish();
    };
    element.addEventListener('mouseup', finish);
    element.addEventListener('touchend', finish);
    element.addEventListener('keyup', key);
    return () => {
      element.removeEventListener('mouseup', finish);
      element.removeEventListener('touchend', finish);
      element.removeEventListener('keyup', key);
    };
  }, [root, onSelect, enabled]);
}

/** The text node and offset at a character position in an element's text. */
export function pointAt(root: Node, offset: number): { node: Node; offset: number } | null {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset <= seen + length) return { node, offset: offset - seen };
    seen += length;
  }
  return null;
}

/** A Range over characters [start, end) of an element's text. */
export function rangeAt(root: Node, start: number, end: number): Range | null {
  const from = pointAt(root, start);
  const to = pointAt(root, end);
  if (!from || !to) return null;
  const range = (root.ownerDocument ?? document).createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
