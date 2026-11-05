export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: string;
  permissions: string;
  modified: string;
}

/**
 * The listing command. The agent spawns command and args with a shell and without quoting, so all of
 * it goes in `command`, with args empty. The directory is JSON-quoted exactly as the old console did.
 */
export const listCommand = (dir: string): string => `cd ${JSON.stringify(dir)} 2>/dev/null || cd ~ ; echo "CWD:$(pwd)" ; ls -laF --time-style=long-iso 2>/dev/null || ls -laF 2>/dev/null`;

export function parseListing(stdout: string, requested: string): { cwd: string; entries: FileEntry[] } {
  const lines = stdout.split('\n').filter(Boolean);
  const cwdLine = lines.find((line) => line.startsWith('CWD:'));
  const cwd = cwdLine ? cwdLine.replace('CWD:', '').trim() : requested;
  const entries: FileEntry[] = [];
  for (const line of lines) {
    if (line.startsWith('CWD:') || line.startsWith('total ')) continue;
    // drwxr-xr-x  5 user group 4096 2026-02-13 10:30 dirname
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const permissions = parts[0] ?? '';
    const size = parts[4] ?? '0';
    const modified = `${parts[5] ?? ''} ${parts[6] ?? ''}`;
    const name = parts.slice(7).join(' ');
    if (!name || name === './' || name === '../' || name === '.' || name === '..') continue;
    const isLink = permissions.startsWith('l');
    const displayName = isLink ? (name.split(' -> ')[0] ?? name) : name;
    // -F marks the type: / for a directory, @ for a link, * for an executable. A link to a directory
    // shows as name@ -> target/.
    const cleanName = displayName.replace(/[/@*|]$/, '');
    const isDirectory = permissions.startsWith('d') || displayName.endsWith('/') || (isLink && name.endsWith('/'));
    entries.push({ name: cleanName, isDirectory, size, permissions, modified });
  }
  entries.sort((left, right) => (left.isDirectory !== right.isDirectory ? (left.isDirectory ? -1 : 1) : left.name.localeCompare(right.name)));
  return { cwd, entries };
}

export const parentDirectory = (cwd: string): string => cwd.replace(/\/[^/]+\/?$/, '') || '/';
export const childPath = (cwd: string, name: string): string => (cwd === '/' ? `/${name}` : `${cwd}/${name}`);

export function formatListedSize(size: string): string {
  const bytes = parseInt(size, 10);
  if (Number.isNaN(bytes)) return size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * What the tasks of a push mean. They can hold failed entries with a 201, all failed with a 502, or
 * nothing at all when the node is no longer online: nothing was written then, so it is not a success.
 */
export function pushProblem(tasks: ReadonlyArray<{ status: string; error: string | null }>): string | null {
  if (tasks.length === 0) return 'Push failed: no online node took the update, so nothing was written.';
  const failed = tasks.filter((task) => task.status === 'failed');
  return failed.length > 0 ? `Push failed: ${failed.map((task) => task.error || 'Unknown error').join('; ')}` : null;
}

/** What the confirmation says before a push overwrites a file on a node. */
export function pushMessage({ filePath, nodeName, content, backup }: { filePath: string; nodeName: string; content: string; backup: boolean }): string {
  const emptied = content === '' ? ' The file will be empty.' : '';
  return `Write ${new TextEncoder().encode(content).byteLength} bytes to ${filePath} on ${nodeName || 'the selected node'}?${emptied} ${backup ? 'A remote backup is made first.' : 'No backup is made, so the current file is lost.'}`;
}

export const libraryFileName = (filePath: string): string => filePath.split('/').pop() || filePath || 'untitled.md';
export const libraryDisplayName = (fileName: string): string => fileName.replace(/\.[^/.]+$/, '');
export const libraryMimeType = (fileName: string): string => (fileName.endsWith('.json') ? 'application/json' : 'text/markdown');

export function mimeLabel(mimeType: string): string {
  const known: Record<string, string> = { 'text/markdown': 'Markdown', 'text/plain': 'Text', 'application/json': 'JSON', 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/svg+xml': 'SVG' };
  return known[mimeType] ?? mimeType.split('/')[1]?.toUpperCase() ?? 'File';
}
