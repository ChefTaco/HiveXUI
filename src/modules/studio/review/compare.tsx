// Compare two revisions of one deliverable. Its own chunk: jsdiff and pdf.js load only here.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { LoadingRows } from '../../magnus/ui/resource-state';
import type { Revision } from './api';
import { useRevisionContent, type Content } from './content';
import { diffStats, diffText, sides, type DiffPart, type Granularity } from './diff';
import { rendererKind } from './logic';
import { useDocx } from './renderers/docx';
import { fitScale, PdfPage, usePdf, type PdfScale } from './renderers/pdf';

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div className="review-segmented" role="group" aria-label={label}>
      {options.map(([item, text]) => (
        <button key={item} type="button" className={cn('btn btn--sm', value === item ? 'btn--primary' : 'btn--ghost')} aria-pressed={value === item} onClick={() => onChange(item)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Parts({ parts }: { parts: readonly DiffPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'same' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'add' ? (
          <ins key={index} className="review-diff__add">
            {part.text}
          </ins>
        ) : (
          <del key={index} className="review-diff__del">
            {part.text}
          </del>
        ),
      )}
    </>
  );
}

/** Text, Markdown, SVG source and Word paragraphs: word or line diff, side by side or inline. */
export function TextCompare({ before, after, labels }: { before: string; after: string; labels: [string, string] }) {
  const [layout, setLayout] = useState<'side' | 'inline'>('side');
  const [granularity, setGranularity] = useState<Granularity>('words');
  const parts = useMemo(() => diffText(before, after, granularity), [before, after, granularity]);
  const stats = diffStats(parts);
  const split = sides(parts);
  return (
    <div className="review-compare">
      <div className="review-compare__bar">
        <Segmented label="Layout" value={layout} options={[['side', 'Side-by-side'], ['inline', 'Inline']]} onChange={setLayout} />
        <Segmented label="Compare by" value={granularity} options={[['words', 'Words'], ['lines', 'Lines']]} onChange={setGranularity} />
        <span className="text-xs text-text-muted" role="status">
          {stats.added || stats.removed ? `${stats.added} words added, ${stats.removed} removed` : 'No differences'}
        </span>
      </div>
      {layout === 'inline' ? (
        <pre className="review-diff code-block m-0" aria-label={`Changes from ${labels[0]} to ${labels[1]}`}>
          <Parts parts={parts} />
        </pre>
      ) : (
        <div className="review-compare__pair">
          <figure className="review-compare__side m-0">
            <figcaption className="stat-label">{labels[0]}</figcaption>
            <pre className="review-diff code-block m-0">
              <Parts parts={split.before} />
            </pre>
          </figure>
          <figure className="review-compare__side m-0">
            <figcaption className="stat-label">{labels[1]}</figcaption>
            <pre className="review-diff code-block m-0">
              <Parts parts={split.after} />
            </pre>
          </figure>
        </div>
      )}
    </div>
  );
}

function useImageSize(url: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    const image = new Image();
    image.onload = () => setSize({ w: image.naturalWidth || 1000, h: image.naturalHeight || 750 });
    image.onerror = () => setSize({ w: 1000, h: 750 });
    image.src = url;
  }, [url]);
  return size;
}

/** Images: side by side, a swipe between them, or one over the other. */
export function ImageCompare({ before, after, labels }: { before: Content; after: Content; labels: [string, string] }) {
  const [layout, setLayout] = useState<'side' | 'swipe' | 'overlay'>('side');
  const [position, setPosition] = useState(50);
  const size = useImageSize(after.url);
  const clip = useId().replace(/:/g, '');
  return (
    <div className="review-compare">
      <div className="review-compare__bar">
        <Segmented label="Layout" value={layout} options={[['side', 'Side-by-side'], ['swipe', 'Swipe'], ['overlay', 'Overlay']]} onChange={setLayout} />
        {layout !== 'side' ? (
          <label className="review-compare__slider text-xs text-text-muted">
            {layout === 'swipe' ? `${labels[0]} | ${labels[1]}` : `Opacity of ${labels[1]}`}
            <input type="range" min={0} max={100} value={position} onChange={(event) => setPosition(Number(event.target.value))} />
          </label>
        ) : null}
      </div>
      {layout === 'side' ? (
        <div className="review-compare__pair">
          {([before, after] as const).map((content, index) => (
            <figure key={index} className="review-compare__side m-0">
              <figcaption className="stat-label">{labels[index]}</figcaption>
              <img src={content.url} alt={labels[index]} className="review-image__img" />
            </figure>
          ))}
        </div>
      ) : size ? (
        <svg className="review-compare__stage" viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={`${labels[0]} and ${labels[1]}, ${layout}`}>
          <image href={before.url} width={size.w} height={size.h} preserveAspectRatio="xMidYMid meet" />
          {layout === 'swipe' ? (
            <>
              <clipPath id={clip}>
                <rect x={(size.w * position) / 100} y={0} width={size.w - (size.w * position) / 100} height={size.h} />
              </clipPath>
              <image href={after.url} width={size.w} height={size.h} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${clip})`} />
              <line className="review-compare__divider" x1={(size.w * position) / 100} x2={(size.w * position) / 100} y1={0} y2={size.h} vectorEffect="non-scaling-stroke" />
            </>
          ) : (
            <image href={after.url} width={size.w} height={size.h} preserveAspectRatio="xMidYMid meet" opacity={position / 100} />
          )}
        </svg>
      ) : (
        <LoadingRows rows={4} />
      )}
    </div>
  );
}

/** PDFs: the same page of each revision, side by side. */
export function PdfCompare({ before, after, labels }: { before: Content; after: Content; labels: [string, string] }) {
  const left = usePdf(before.blob);
  const right = usePdf(after.blob);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState<PdfScale | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!right.doc || scale !== null) return;
    void right.doc.getPage(1).then((first) => setScale(fitScale(first.getViewport({ scale: 1 }).width, ((frame.current?.clientWidth ?? 800) - 32) / 2)));
  }, [right.doc, scale]);
  if (left.error || right.error) return <EmptyState compact tone="warning" title="A PDF could not be opened" message={errorMessage(left.error ?? right.error)} />;
  if (!left.doc || !right.doc || scale === null)
    return (
      <div ref={frame}>
        <LoadingRows rows={6} />
      </div>
    );
  const pages = Math.max(left.doc.numPages, right.doc.numPages);
  return (
    <div className="review-compare" ref={frame}>
      <div className="review-compare__bar">
        <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous page
        </button>
        <span className="num text-sm" aria-live="polite">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn btn--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next page
        </button>
      </div>
      <div className="review-compare__pair">
        {([left.doc, right.doc] as const).map((doc, index) => (
          <figure key={index} className="review-compare__side m-0">
            <figcaption className="stat-label">{labels[index]}</figcaption>
            {page <= doc.numPages ? <PdfPage doc={doc} page={page} scale={scale} label={`${labels[index]}, page ${page}`} /> : <p className="m-0 text-sm text-text-muted">No page {page} in this revision.</p>}
          </figure>
        ))}
      </div>
    </div>
  );
}

function DocxCompare({ before, after, labels }: { before: Revision; after: Revision; labels: [string, string] }) {
  const left = useDocx(before.id);
  const right = useDocx(after.id);
  if (left.status === 'loading' || right.status === 'loading') return <LoadingRows rows={6} />;
  if (left.status !== 'ready' || right.status !== 'ready')
    return <EmptyState compact title="Word revisions can't be compared yet" message="Comparing Word documents needs the Studio service's Word codec, which isn't installed. Download both revisions to compare them." />;
  const text = (document: typeof left.document) => document.paragraphs.map((paragraph) => paragraph.text).join('\n\n');
  return <TextCompare before={text(left.document)} after={text(right.document)} labels={labels} />;
}

export default function CompareView({ before, after }: { before: Revision; after: Revision }) {
  const labels: [string, string] = [`Revision ${before.revision}`, `Revision ${after.revision}`];
  const kind = rendererKind(after.mime);
  const left = useRevisionContent(before);
  const right = useRevisionContent(after);
  if (rendererKind(before.mime) !== kind) return <EmptyState compact title="These revisions are different file types" message={`${labels[0]} is ${before.mime}; ${labels[1]} is ${after.mime}.`} />;
  if (kind === 'docx') return <DocxCompare before={before} after={after} labels={labels} />;
  if (left.status === 'error' || right.status === 'error') return <EmptyState compact tone="warning" title="A revision could not be downloaded" message={errorMessage(left.status === 'error' ? left.error : (right as { error: unknown }).error)} />;
  if (left.status !== 'ready' || right.status !== 'ready') return <LoadingRows rows={6} />;
  if (kind === 'image') return <ImageCompare before={left.content} after={right.content} labels={labels} />;
  if (kind === 'pdf') return <PdfCompare before={left.content} after={right.content} labels={labels} />;
  if (left.content.text !== null && right.content.text !== null) return <TextCompare before={left.content.text} after={right.content.text} labels={labels} />;
  return <EmptyState compact title="No comparison for this file type" message="Download both revisions to compare them." />;
}
