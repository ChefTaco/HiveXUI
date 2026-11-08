import { useMemo, useState } from 'react';
import { cn } from '@lib/cn';
import { imageAnchor, svgViewBox } from '../anchors';
import TextRenderer from './text';
import { RegionLayer } from './regions';
import type { RendererProps } from './shared';

/**
 * PNG, JPEG, WebP, GIF and SVG through an <img> with a blob: URL. SVG is never inlined, so its
 * scripts and links cannot run. Drag on the image to comment on a region; SVG regions also carry
 * viewBox coordinates, and SVG source takes text comments.
 */
export default function ImageRenderer(props: RendererProps) {
  const { content, name, comments, focused, onAnchor, readOnly, revision } = props;
  const svg = revision.mime.startsWith('image/svg+xml');
  const [view, setView] = useState<'image' | 'source'>('image');
  const viewBox = useMemo(() => (svg && content.text ? svgViewBox(content.text) : null), [svg, content.text]);
  const regions = comments.flatMap((comment) => (comment.anchor.kind === 'image' && comment.state === 'open' ? [{ id: comment.id, region: comment.anchor }] : []));
  return (
    <div className="review-image-view">
      <div className="review-image-view__bar">
        {svg ? (
          <div className="review-segmented" role="group" aria-label="SVG view">
            {(['image', 'source'] as const).map((item) => (
              <button key={item} type="button" className={cn('btn btn--sm', view === item ? 'btn--primary' : 'btn--ghost')} aria-pressed={view === item} onClick={() => setView(item)}>
                {item === 'image' ? 'Image' : 'Source'}
              </button>
            ))}
          </div>
        ) : null}
        {!readOnly && view === 'image' ? <span className="text-xs text-text-muted">Drag across the image to comment on a region.</span> : null}
      </div>
      {view === 'source' ? (
        <TextRenderer {...props} />
      ) : (
        <div className={cn('review-image', svg && 'review-image--vector')}>
          <img src={content.url} alt={name} className="review-image__img" draggable={false} />
          <RegionLayer regions={regions} focused={focused} drawing={!readOnly} label={`Draw a region on ${name} to comment on it`} onRegion={(region) => onAnchor(imageAnchor(region, viewBox))} />
        </div>
      )}
    </div>
  );
}
