import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp, File, FileArchive, FileCode, FileImage, FileText, Folder, Home, RefreshCw } from 'lucide-react';
import { quickCommandResponseSchema } from '@contracts/magnus/browser';
import { Drawer, IconButton, TableFrame } from '@ui';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { LoadingRows } from '../../../ui/resource-state';
import { FormError } from '../shared/parts';
import { childPath, formatListedSize, listCommand, parentDirectory, parseListing, type FileEntry } from './files-model';

function fileIcon(name: string, isDirectory: boolean): ReactNode {
  if (isDirectory) return <Folder aria-hidden="true" className="size-4 shrink-0 text-warning" />;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'json', 'yaml', 'yml', 'toml'].includes(extension)) return <FileCode aria-hidden="true" className="size-4 shrink-0 text-accent" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(extension)) return <FileImage aria-hidden="true" className="size-4 shrink-0 text-text-muted" />;
  if (['tar', 'gz', 'zip', 'bz2', 'xz', 'deb', 'rpm'].includes(extension)) return <FileArchive aria-hidden="true" className="size-4 shrink-0 text-text-muted" />;
  if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env'].includes(extension)) return <FileText aria-hidden="true" className="size-4 shrink-0 text-text-muted" />;
  return <File aria-hidden="true" className="size-4 shrink-0 text-text-muted" />;
}

/** Lists a node's files with `ls` through the quick-command endpoint. Every listing is one operator action. */
export function FileBrowser({ open, nodeId, onClose, onSelect }: { open: boolean; nodeId: string; onClose: () => void; onSelect: (path: string) => void }) {
  const [cwd, setCwd] = useState('~');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function list(dir: string) {
    if (!nodeId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await magnus.post(`/quick-command/${segment(nodeId)}/exec`, quickCommandResponseSchema, { body: { command: listCommand(dir), args: [], timeoutSeconds: 10 } });
      if (data.exitCode !== 0 && !data.stdout) {
        setError(data.stderr || `The directory could not be listed (exit ${data.exitCode})`);
        return;
      }
      const listing = parseListing(data.stdout, dir);
      setCwd(listing.cwd);
      setEntries(listing.entries);
    } catch (caught) {
      setError(errorMessage(caught, 'Files could not be browsed'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!open || !nodeId) return;
    setEntries([]);
    setCwd('~');
    void list('~');
    // The listing starts over when the drawer opens or the node changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId]);
  const choose = (entry: FileEntry) => {
    if (entry.isDirectory) {
      void list(childPath(cwd, entry.name));
      return;
    }
    onSelect(childPath(cwd, entry.name));
    onClose();
  };
  return (
    <Drawer open={open} title="Browse files" eyebrow={cwd} onClose={onClose}>
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          <IconButton label="Go up" icon={<ArrowUp className="size-4" />} disabled={loading || cwd === '/' || cwd === '~'} onClick={() => void list(parentDirectory(cwd))} />
          <IconButton label="Home directory" icon={<Home className="size-4" />} disabled={loading} onClick={() => void list('~')} />
          <IconButton label="Refresh" icon={<RefreshCw className={cn('size-4', loading && 'animate-spin')} />} disabled={loading} onClick={() => void list(cwd)} />
          <span className="min-w-0 flex-1 truncate rounded-control border border-border bg-surface-sunken px-3 py-1.5 font-mono text-sm text-text-muted">{cwd}</span>
        </div>
        <FormError message={error} />
        {loading ? (
          <LoadingRows rows={8} />
        ) : entries.length === 0 ? (
          <p className="m-0 py-8 text-center text-sm text-text-muted">{error ? 'Nothing to show' : 'Empty directory'}</p>
        ) : (
          <TableFrame label="Files" className="max-h-[60vh]">
            <table>
              <thead>
                <tr><th>Name</th><th className="text-right">Size</th><th className="hidden text-right sm:table-cell">Modified</th></tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.name} className="fx-rail cursor-pointer" onClick={() => choose(entry)}>
                    <td>
                      <button type="button" className={cn('flex cursor-pointer items-center gap-2 text-left', entry.isDirectory && 'font-semibold text-warning')} onClick={(click) => { click.stopPropagation(); choose(entry); }}>
                        {fileIcon(entry.name, entry.isDirectory)}
                        <span className="break-all">{entry.name}{entry.isDirectory ? '/' : ''}</span>
                      </button>
                    </td>
                    <td className="num whitespace-nowrap text-right text-text-muted">{entry.isDirectory ? '—' : formatListedSize(entry.size)}</td>
                    <td className="num hidden whitespace-nowrap text-right text-text-muted sm:table-cell">{entry.modified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
        <p className="m-0 text-sm text-text-muted">Click a folder to open it. Click a file to select it.</p>
      </div>
    </Drawer>
  );
}
