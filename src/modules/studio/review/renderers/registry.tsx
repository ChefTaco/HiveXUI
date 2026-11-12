// The MIME PreviewRenderer registry. Each renderer is its own chunk, so react-markdown, pdf.js and
// the Word view load only when a file of their type is opened.
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { File } from 'lucide-react';
import { EmptyState, LoadingRows } from '@ui';
import { formatBytes } from '../../projects/logic';
import { rendererKind, type RendererKind } from '../logic';
import { DownloadButton, type RendererProps } from './shared';

/** Metadata and download, for any type without a preview. */
function FallbackRenderer({ revision, content, name }: RendererProps) {
  return (
    <EmptyState
      icon={<File className="size-6" />}
      title="No preview for this file type"
      message={`${name} · ${revision.mime} · ${formatBytes(revision.size)}. Download it to open it; comments on the whole file still work.`}
      action={<DownloadButton content={content} name={name} />}
    />
  );
}

export const RENDERERS: Record<RendererKind, LazyExoticComponent<ComponentType<RendererProps>> | ComponentType<RendererProps>> = {
  markdown: lazy(() => import('./markdown')),
  text: lazy(() => import('./text')),
  image: lazy(() => import('./image')),
  pdf: lazy(() => import('./pdf')),
  docx: lazy(() => import('./docx')),
  fallback: FallbackRenderer,
};

export function PreviewRenderer(props: RendererProps) {
  const Renderer = RENDERERS[rendererKind(props.revision.mime)];
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <Renderer {...props} />
    </Suspense>
  );
}
