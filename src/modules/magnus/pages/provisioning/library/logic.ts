// Colors a category may be stored with. They are the operator's data, written to the API, not theme
// colors: a category's dot shows what was chosen, in both themes.
export const CATEGORY_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#06b6d4'] as const;
export const DEFAULT_CATEGORY_COLOR = CATEGORY_COLORS[0];
export const isCategoryColor = (value: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

export const SKILL_MIME = 'application/x-magnus-skill';
export const CRONJOB_MIME = 'application/x-magnus-cronjob';
export const isDeployable = (mimeType: string): boolean => mimeType === SKILL_MIME || mimeType === CRONJOB_MIME;

const LABELS: Record<string, string> = {
  'text/markdown': 'Markdown',
  'text/plain': 'Text',
  'application/json': 'JSON',
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/svg+xml': 'SVG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  [SKILL_MIME]: 'Skill',
  [CRONJOB_MIME]: 'Cron job',
};
export const mimeLabel = (mimeType: string): string => LABELS[mimeType] ?? mimeType.split('/')[1]?.toUpperCase() ?? 'File';

export const MIME_OPTIONS = [
  { value: 'text/markdown', label: 'Markdown (.md)' },
  { value: 'text/plain', label: 'Plain text (.txt)' },
  { value: 'application/json', label: 'JSON (.json)' },
  { value: 'application/pdf', label: 'PDF (.pdf)' },
  { value: 'image/png', label: 'PNG image' },
  { value: 'image/jpeg', label: 'JPEG image' },
  { value: 'image/svg+xml', label: 'SVG image' },
];
/** The form's choices. A file of another type keeps its type: saving must not change it silently. */
export const mimeOptionsFor = (current: string) => (MIME_OPTIONS.some((option) => option.value === current) ? MIME_OPTIONS : [...MIME_OPTIONS, { value: current, label: mimeLabel(current) }]);

export const isEditableText = (mimeType: string): boolean => mimeType.startsWith('text/') || mimeType === 'application/json';
/** Stored as text. Everything else is stored base64 encoded. */
export const isStoredAsText = (mimeType: string): boolean => isEditableText(mimeType) || isDeployable(mimeType);

const TEXT_EXTENSIONS: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/plain', yml: 'text/plain' };
const extensionOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
export const readsAsText = (name: string, type: string): boolean => type.startsWith('text/') || extensionOf(name) in TEXT_EXTENSIONS;
/** Browsers report .md and .yaml with no type or application/yaml, which would hide the content everywhere. */
export function uploadMimeType(name: string, type: string): string {
  const known = TEXT_EXTENSIONS[extensionOf(name)];
  return known && !type.startsWith('text/') ? known : type || 'application/octet-stream';
}
export const displayNameOf = (name: string): string => name.replace(/\.[^/.]+$/, '');

export const splitTags = (value: string): string[] => value.split(',').map((tag) => tag.trim()).filter(Boolean);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The bytes to download. Content that is not valid base64 was stored as text and is saved as it is. */
export function fileBlob(content: string, mimeType: string): Blob {
  if (!isStoredAsText(mimeType)) {
    try {
      return new Blob([Uint8Array.from(atob(content), (char) => char.charCodeAt(0))], { type: mimeType });
    } catch {
      // Uploaded with an unknown type but read as text.
    }
  }
  return new Blob([content], { type: mimeType });
}

/** An image's source. Only an image data URL or base64 content can reach the element. */
export const imageSource = (content: string, mimeType: string): string => (content.startsWith('data:image/') ? content : `data:${mimeType};base64,${content}`);

export function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
