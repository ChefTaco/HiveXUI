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

/** A finished message or decision text, rendered as Markdown. */
export function MessageBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('room-msg__text room-msg__md m-0 text-sm text-text', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
