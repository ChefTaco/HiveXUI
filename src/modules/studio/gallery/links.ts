import { STUDIO_PREFIX } from '../paths';
import { projectHref } from '../routes';

export type GalleryKind = 'teams' | 'agents';

/** A Gallery address: inside a project it applies templates to that project's team. */
export function galleryHref({ projectId, kind, template, version }: { projectId?: string | undefined; kind?: GalleryKind | undefined; template?: string | undefined; version?: number | undefined }): string {
  const search = new URLSearchParams();
  if (kind === 'agents') search.set('kind', 'agents');
  if (template) search.set('template', version ? `${template}@${version}` : template);
  const text = search.toString();
  return (projectId ? projectHref(projectId, '/team/gallery') : `${STUDIO_PREFIX}/gallery`) + (text ? `?${text}` : '');
}

/** `?template=id` or `id@version`. */
export function parseTemplateParam(value: string | null): { id: string; version: number | null } | null {
  if (!value) return null;
  const match = /^([A-Za-z0-9_]{1,64})(?:@(\d{1,6}))?$/.exec(value);
  return match ? { id: match[1]!, version: match[2] ? Number(match[2]) : null } : null;
}
