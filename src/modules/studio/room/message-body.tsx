import { memo, useDeferredValue } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@lib/cn';

// Agents and people write Markdown (body_md). Raw HTML is never rendered, remote images are not
// fetched (they would leave the console) and links open outside the Studio page.
const components: Components = {
  img: ({ alt, src }) => <span className="text-text-muted">[image: {alt || (typeof src === 'string' ? src : 'untitled')}]</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

const PLUGINS = [remarkGfm];

/** A finished message or decision text, rendered as Markdown. Re-parsed only when its text changes. */
export const MessageBody = memo(function MessageBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('room-msg__text room-msg__md m-0 text-sm text-text', className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});

/**
 * A reply's text: the live text while it streams, then the stored message. Both render through the
 * same Markdown renderer and element, so the bubble keeps its layout when the final text replaces
 * the live one. Any prefix of Markdown parses: an unclosed fence shows as code up to the end, an
 * unclosed emphasis as its plain marker until it closes, and raw HTML is still dropped. While live,
 * parsing waits behind more urgent updates (useDeferredValue), so a fast stream coalesces into fewer
 * renders instead of re-parsing on every delta.
 */
export function ReplyBody({ text, live = false }: { text: string; live?: boolean }) {
  const deferred = useDeferredValue(text);
  return <MessageBody text={live ? deferred : text} {...(live ? { className: 'room-msg__text--live' } : {})} />;
}
