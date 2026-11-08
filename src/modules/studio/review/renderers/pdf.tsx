import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button, EmptyState, IconButton } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../../magnus/api/errors';
import { LoadingRows } from '../../../magnus/ui/resource-state';
import { pdfAnchor } from '../anchors';
import { RegionLayer } from './regions';
import { DownloadButton, useSelection, type RendererProps } from './shared';

// The worker is a file of this console's own origin, so script-src 'self' covers it.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Zoom steps. Each is a class that sets pdf.js's scale variable, so nothing is styled inline. */
export const PDF_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PdfScale = (typeof PDF_SCALES)[number];
const scaleClass = (scale: PdfScale) => `review-pdf-scale-${Math.round(scale * 100)}`;

/** The document, opened from bytes already downloaded and checked. */
export function usePdf(blob: Blob | null): { doc: PDFDocumentProxy | null; error: unknown } {
  const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: unknown }>({ doc: null, error: undefined });
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | null = null;
    setState({ doc: null, error: undefined });
    void blob.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      task = getDocument({ data: new Uint8Array(buffer) });
      task.promise.then(
        (doc) => {
          if (!cancelled) setState({ doc, error: undefined });
        },
        (error: unknown) => {
          if (!cancelled) setState({ doc: null, error });
        },
      );
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob]);
  return state;
}

/** The largest zoom step at which a page of this width fits the space. */
export function fitScale(pageWidth: number, available: number): PdfScale {
  const fits = PDF_SCALES.filter((scale) => pageWidth * scale <= available);
  return fits.at(-1) ?? PDF_SCALES[0];
}

/** One page: its canvas, a selectable text layer and whatever overlay the caller adds. */
export function PdfPage({ doc, page, scale, overlay, label }: { doc: PDFDocumentProxy; page: number; scale: PdfScale; overlay?: ReactNode; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let cancelled = false;
    let render: { cancel: () => void } | null = null;
    let layer: TextLayer | null = null;
    void (async () => {
      try {
        const proxy = await doc.getPage(page);
        if (cancelled || !canvas.current || !text.current) return;
        const viewport = proxy.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        canvas.current.width = Math.floor(viewport.width * ratio);
        canvas.current.height = Math.floor(viewport.height * ratio);
        const task = proxy.render({ canvas: canvas.current, viewport, ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}) });
        render = task;
        text.current.replaceChildren();
        layer = new TextLayer({ textContentSource: proxy.streamTextContent(), container: text.current, viewport });
        await Promise.all([task.promise, layer.render()]);
      } catch (caught) {
        if (!cancelled && !(caught instanceof Error && caught.name === 'RenderingCancelledException')) setError(caught);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, page, scale]);
  if (error) return <p className="m-0 text-sm text-danger">Page {page} could not be drawn: {errorMessage(error)}</p>;
  return (
    <div className={cn('review-pdf-page', scaleClass(scale))} role="img" aria-label={label}>
      <canvas ref={canvas} className="review-pdf-page__canvas" aria-hidden="true" />
      <div ref={text} className="review-pdf-text" />
      {overlay}
    </div>
  );
}

/** PDF through pdf.js: one page at a time, selectable text, and region comments in Mark mode. */
export default function PdfRenderer({ content, name, comments, focused, onAnchor, readOnly }: RendererProps) {
  const { doc, error } = usePdf(content.blob);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState<PdfScale | null>(null);
  const [mode, setMode] = useState<'text' | 'region'>('text');
  const frame = useRef<HTMLDivElement>(null);

  // Open at the page a focused comment points to.
  const focusedAnchor = comments.find((comment) => comment.id === focused)?.anchor;
  useEffect(() => {
    if (focusedAnchor?.kind === 'pdf') setPage(focusedAnchor.page);
  }, [focusedAnchor]);
  // Fit the first page to the space it has.
  useEffect(() => {
    if (!doc || scale !== null) return;
    void doc.getPage(1).then((first) => setScale(fitScale(first.getViewport({ scale: 1 }).width, (frame.current?.clientWidth ?? 800) - 16)));
  }, [doc, scale]);
  const select = useCallback((_range: Range, quote: string) => onAnchor(pdfAnchor(page, { quote })), [onAnchor, page]);
  useSelection(frame, select, !readOnly && mode === 'text');

  if (error)
    return <EmptyState compact tone="warning" title="This PDF could not be opened" message={errorMessage(error)} action={<DownloadButton content={content} name={name} />} />;
  if (!doc || scale === null) return <LoadingRows rows={6} />;
  const pages = doc.numPages;
  const regions = comments.flatMap((comment) => (comment.anchor.kind === 'pdf' && comment.anchor.page === page && comment.anchor.rect && comment.state === 'open' ? [{ id: comment.id, region: comment.anchor.rect }] : []));
  const step = (delta: number) => setScale(PDF_SCALES[Math.min(PDF_SCALES.length - 1, Math.max(0, PDF_SCALES.indexOf(scale) + delta))]!);
  return (
    <div className="review-pdf">
      <div className="review-pdf__bar">
        <div className="review-pdf__pager">
          <IconButton label="Previous page" icon={<ChevronLeft className="size-4" />} disabled={page <= 1} onClick={() => setPage(page - 1)} />
          <span className="num text-sm" aria-live="polite">
            Page {page} of {pages}
          </span>
          <IconButton label="Next page" icon={<ChevronRight className="size-4" />} disabled={page >= pages} onClick={() => setPage(page + 1)} />
        </div>
        <div className="review-pdf__pager">
          <IconButton label="Zoom out" icon={<ZoomOut className="size-4" />} disabled={scale === PDF_SCALES[0]} onClick={() => step(-1)} />
          <span className="num text-xs text-text-muted">{Math.round(scale * 100)}%</span>
          <IconButton label="Zoom in" icon={<ZoomIn className="size-4" />} disabled={scale === PDF_SCALES.at(-1)} onClick={() => step(1)} />
        </div>
        {!readOnly ? (
          <div className="review-segmented" role="group" aria-label="Comment on">
            <Button size="sm" variant={mode === 'text' ? 'primary' : 'ghost'} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
              Select text
            </Button>
            <Button size="sm" variant={mode === 'region' ? 'primary' : 'ghost'} aria-pressed={mode === 'region'} onClick={() => setMode('region')}>
              Mark a region
            </Button>
          </div>
        ) : null}
      </div>
      <div ref={frame} className="review-pdf__frame">
        <PdfPage
          doc={doc}
          page={page}
          scale={scale}
          label={`${name}, page ${page} of ${pages}`}
          overlay={<RegionLayer regions={regions} focused={focused} drawing={!readOnly && mode === 'region'} label={`Draw a region on page ${page} to comment on it`} onRegion={(rect) => onAnchor(pdfAnchor(page, { rect }))} />}
        />
      </div>
    </div>
  );
}
