import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@lib/cn';
import { findRendered, locateQuote, renderedQuote, textAnchor, textOffset } from '../anchors';
import TextRenderer from './text';
import { paint, rangeAt, useSelection, type RendererProps } from './shared';

/** Block elements that carry their Markdown source offsets, so a selection maps back to the source. */
const BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'td', 'th'] as const;
type Positioned = { node?: { position?: { start: { offset?: number }; end: { offset?: number } } }; children?: ReactNode };

const components: Components = {
  ...Object.fromEntries(
    BLOCKS.map((tag) => [
      tag,
      ({ node, ...props }: Positioned & Record<string, unknown>) =>
        createElement(tag, { ...props, 'data-src-start': node?.position?.start.offset, 'data-src-end': node?.position?.end.offset }),
    ]),
  ),
  // Remote images are not fetched from a deliverable: they would leave the console. Show what they were.
  img: ({ alt, src }) => <span className="review-md__image text-text-muted">[image: {alt || (typeof src === 'string' ? src : 'untitled')}]</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

const blockOf = (node: Node | null): HTMLElement | null => (node instanceof Element ? node : node?.parentElement ?? null)?.closest<HTMLElement>('[data-src-start]') ?? null;
const offsetsOf = (block: HTMLElement) => ({ start: Number(block.dataset.srcStart), end: Number(block.dataset.srcEnd) });

/** Markdown rendered with react-markdown and GitHub tables and lists, or its source for exact selections. */
export default function MarkdownRenderer(props: RendererProps) {
  const { revision, content, comments, focused, onAnchor, readOnly } = props;
  const [view, setView] = useState<'rendered' | 'source'>('rendered');
  const article = useRef<HTMLElement>(null);
  const source = content.text ?? '';

  const select = useCallback(
    (range: Range, text: string) => {
      const first = blockOf(range.startContainer);
      const last = blockOf(range.endContainer);
      if (!first || !last) return;
      const from = offsetsOf(first);
      const to = offsetsOf(last);
      const hint = first.textContent ? textOffset(first, range.startContainer, range.startOffset) / first.textContent.length : 0;
      const located = locateQuote(source, from.start, Math.max(from.end, to.end), text, hint);
      const anchor = located ? textAnchor(source, located.start, located.end, revision.blob_sha256) : null;
      if (anchor) onAnchor(anchor);
    },
    [source, revision.blob_sha256, onAnchor],
  );
  useSelection(article, select, view === 'rendered' && !readOnly);

  const textComments = useMemo(() => comments.filter((comment) => comment.anchor.kind === 'text' && comment.state === 'open'), [comments]);
  useEffect(() => {
    const root = article.current;
    if (!root || view !== 'rendered') return;
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-src-start]')];
    const rangeFor = (anchor: { start: number; quote: string }): Range | null => {
      // The innermost block holding the anchor's start, then the quote as it renders there.
      const block = blocks.filter((item) => offsetsOf(item).start <= anchor.start && anchor.start < offsetsOf(item).end).at(-1);
      const found = block?.textContent ? findRendered(block.textContent, renderedQuote(anchor.quote)) : null;
      return block && found ? rangeAt(block, found.start, found.end) : null;
    };
    const ranges = (match: (id: string) => boolean) =>
      textComments.filter((comment) => match(comment.id)).flatMap((comment) => {
        const range = rangeFor(comment.anchor as { start: number; quote: string });
        return range ? [range] : [];
      });
    const clearAll = paint('review-comment', ranges((id) => id !== focused));
    const clearFocus = paint('review-focus', ranges((id) => id === focused));
    return () => {
      clearAll();
      clearFocus();
    };
  }, [textComments, focused, view, source]);

  return (
    <div className="review-md">
      <div className="review-segmented" role="group" aria-label="Markdown view">
        {(['rendered', 'source'] as const).map((item) => (
          <button key={item} type="button" className={cn('btn btn--sm', view === item ? 'btn--primary' : 'btn--ghost')} aria-pressed={view === item} onClick={() => setView(item)}>
            {item === 'rendered' ? 'Rendered' : 'Source'}
          </button>
        ))}
      </div>
      {view === 'source' || content.text === null ? (
        <TextRenderer {...props} />
      ) : (
        <article ref={article} className="review-md__body" tabIndex={0} aria-label={`${props.name}. Select text to comment on it.`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {source}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}
