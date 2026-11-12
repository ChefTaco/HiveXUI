import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { EmptyState, LoadingRows } from '@ui';
import { errorMessage } from '../../../magnus/api/errors';
import { StudioApiError } from '../../api/client';
import { textOffset } from '../anchors';
import { getRevisionDocx, type DocxDocument } from '../api';
import { DownloadButton, paint, rangeAt, useSelection, type RendererProps } from './shared';

type Loaded = { status: 'loading' } | { status: 'unavailable'; message: string } | { status: 'error'; error: unknown } | { status: 'ready'; document: DocxDocument };

/** The stored conversion of a DOCX revision, or why there is none. */
export function useDocx(revisionId: string): Loaded {
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    getRevisionDocx(revisionId, controller.signal).then(
      (document) => setState({ status: 'ready', document }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof StudioApiError && (error.status === 501 || error.code === 'DOCX_CONVERTER_UNAVAILABLE')) setState({ status: 'unavailable', message: error.message });
        else setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [revisionId]);
  return state;
}

export function DocxUnavailable({ content, name }: Pick<RendererProps, 'content' | 'name'>) {
  return (
    <EmptyState
      icon={<FileText className="size-6" />}
      title="Word preview isn't available yet"
      message="The Studio service cannot convert Word documents until its Word codec is installed. Download the file to read it; comments on the whole file still work."
      action={<DownloadButton content={content} name={name} />}
    />
  );
}

/**
 * A Word document's paragraphs from the service's stored conversion, each keeping the paragraph
 * id that its comments anchor to. The canvas page view drops in here once its engine package is
 * published; the anchors stay the same.
 */
export default function DocxRenderer({ revision, content, name, comments, focused, onAnchor, readOnly }: RendererProps) {
  const state = useDocx(revision.id);
  const root = useRef<HTMLDivElement>(null);
  const select = useCallback(
    (range: Range) => {
      const paragraph = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('[data-paragraph-id]');
      const end = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest<HTMLElement>('[data-paragraph-id]');
      if (!paragraph || paragraph !== end) return;
      const start = textOffset(paragraph, range.startContainer, range.startOffset);
      const stop = textOffset(paragraph, range.endContainer, range.endOffset);
      const quote = (paragraph.textContent ?? '').slice(start, stop);
      if (quote.trim()) onAnchor({ kind: 'docx', paragraph_id: paragraph.dataset.paragraphId!, start, end: stop, quote });
    },
    [onAnchor],
  );
  useSelection(root, select, !readOnly && state.status === 'ready');
  useEffect(() => {
    const element = root.current;
    if (!element || state.status !== 'ready') return;
    const ranges = (match: (id: string) => boolean) =>
      comments.flatMap((comment) => {
        if (comment.anchor.kind !== 'docx' || comment.state !== 'open' || !match(comment.id)) return [];
        const anchor = comment.anchor;
        const paragraph = [...element.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find((item) => item.dataset.paragraphId === anchor.paragraph_id);
        const range = paragraph ? rangeAt(paragraph, anchor.start, anchor.end) : null;
        return range ? [range] : [];
      });
    const clearAll = paint('review-comment', ranges((id) => id !== focused));
    const clearFocus = paint('review-focus', ranges((id) => id === focused));
    return () => {
      clearAll();
      clearFocus();
    };
  }, [comments, focused, state]);

  if (state.status === 'loading') return <LoadingRows rows={6} />;
  if (state.status === 'unavailable') return <DocxUnavailable content={content} name={name} />;
  if (state.status === 'error') return <EmptyState compact tone="warning" title="The Word document could not be read" message={errorMessage(state.error)} action={<DownloadButton content={content} name={name} />} />;
  return (
    <div ref={root} className="review-docx" tabIndex={0} aria-label={`${name}. Select text in a paragraph to comment on it.`}>
      {state.document.paragraphs.map((paragraph) => (
        <p key={paragraph.id} data-paragraph-id={paragraph.id} className="review-docx__paragraph">
          {paragraph.text}
        </p>
      ))}
    </div>
  );
}
