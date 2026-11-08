import { useCallback, useEffect, useRef } from 'react';
import { EmptyState } from '@ui';
import { textAnchor, textOffset } from '../anchors';
import { DownloadButton, paint, rangeAt, useSelection, type RendererProps } from './shared';

/**
 * Plain text, CSV, JSON and SVG source, exactly as stored: the rendered characters are the source
 * characters, so a selection's offsets are the anchor's offsets.
 */
export default function TextRenderer({ revision, content, name, comments, focused, onAnchor, readOnly }: RendererProps) {
  const pre = useRef<HTMLPreElement>(null);
  const text = content.text;
  const select = useCallback(
    (range: Range) => {
      if (!pre.current || text === null) return;
      const start = textOffset(pre.current, range.startContainer, range.startOffset);
      const end = textOffset(pre.current, range.endContainer, range.endOffset);
      const anchor = textAnchor(text, start, end, revision.blob_sha256);
      if (anchor) onAnchor(anchor);
    },
    [text, revision.blob_sha256, onAnchor],
  );
  useSelection(pre, select, !readOnly);
  useEffect(() => {
    const root = pre.current;
    if (!root) return;
    const anchored = comments.filter((comment) => comment.anchor.kind === 'text' && comment.state === 'open');
    const ranges = (ids: (id: string) => boolean) =>
      anchored.filter((comment) => ids(comment.id)).flatMap((comment) => {
        const anchor = comment.anchor as Extract<typeof comment.anchor, { kind: 'text' }>;
        const range = rangeAt(root, anchor.start, anchor.end);
        return range ? [range] : [];
      });
    const clearAll = paint('review-comment', ranges((id) => id !== focused));
    const clearFocus = paint('review-focus', ranges((id) => id === focused));
    return () => {
      clearAll();
      clearFocus();
    };
  }, [comments, focused, text]);

  if (text === null)
    return (
      <EmptyState
        compact
        title="This file is too large to show here"
        message="Download it to read it. Whole-file comments still work."
        action={<DownloadButton content={content} name={name} />}
      />
    );
  return (
    <pre ref={pre} className="review-text code-block m-0" tabIndex={0} aria-label={`${name} text. Select text to comment on it.`}>
      {text}
    </pre>
  );
}
