import { describe, expect, it } from 'vitest';
import { childPath, formatListedSize, libraryDisplayName, libraryFileName, libraryMimeType, listCommand, mimeLabel, parentDirectory, parseListing, pushProblem } from './files-model';

const OUTPUT = `CWD:/opt/app
total 16
drwxr-xr-x  4 root root 4096 2026-02-13 10:30 ./
drwxr-xr-x 20 root root 4096 2026-02-13 10:30 ../
-rw-r--r--  1 root root 2048 2026-02-13 10:31 config file.yaml
-rwxr-xr-x  1 root root  100 2026-02-13 10:32 run.sh*
drwxr-xr-x  2 root root 4096 2026-02-13 10:33 logs/
lrwxrwxrwx  1 root root    9 2026-02-13 10:34 current@ -> releases/
lrwxrwxrwx  1 root root    9 2026-02-13 10:35 link.txt@ -> notes.txt
`;

describe('parseListing', () => {
  const { cwd, entries } = parseListing(OUTPUT, '~');
  it('takes the resolved directory from the marker', () => {
    expect(cwd).toBe('/opt/app');
    expect(parseListing('', '/fallback').cwd).toBe('/fallback');
  });
  it('drops the dot entries and sorts directories first', () => {
    expect(entries.map((entry) => entry.name)).toEqual(['current', 'logs', 'config file.yaml', 'link.txt', 'run.sh']);
  });
  it('keeps spaces in a name, and reads a link to a directory as one', () => {
    expect(entries.find((entry) => entry.name === 'config file.yaml')).toMatchObject({ size: '2048', modified: '2026-02-13 10:31', isDirectory: false });
    expect(entries.find((entry) => entry.name === 'current')?.isDirectory).toBe(true);
    expect(entries.find((entry) => entry.name === 'link.txt')?.isDirectory).toBe(false);
  });
});

describe('paths', () => {
  it('moves up and into directories', () => {
    expect(parentDirectory('/opt/app')).toBe('/opt');
    expect(parentDirectory('/opt')).toBe('/');
    expect(childPath('/', 'etc')).toBe('/etc');
    expect(childPath('/opt', 'app')).toBe('/opt/app');
  });
  it('quotes the directory in the listing command', () => {
    expect(listCommand('/a b')).toContain('cd "/a b" 2>/dev/null || cd ~ ;');
  });
  it('formats listed sizes', () => {
    expect(formatListedSize('12')).toBe('12 B');
    expect(formatListedSize('2048')).toBe('2.0 KB');
    expect(formatListedSize('?')).toBe('?');
  });
});

describe('pushProblem', () => {
  it('passes only when every task completed', () => {
    expect(pushProblem([{ status: 'completed', error: null }])).toBeNull();
  });
  it('names each failure', () => {
    expect(pushProblem([{ status: 'completed', error: null }, { status: 'failed', error: 'denied' }, { status: 'failed', error: null }])).toBe('Push failed: denied; Unknown error');
  });
  it('does not call an empty result a success', () => {
    expect(pushProblem([])).toContain('nothing was written');
  });
});

describe('library naming', () => {
  it('derives names from the path', () => {
    expect(libraryFileName('/opt/app/SOUL.md')).toBe('SOUL.md');
    expect(libraryFileName('')).toBe('untitled.md');
    expect(libraryDisplayName('SOUL.md')).toBe('SOUL');
    expect(libraryMimeType('a.json')).toBe('application/json');
    expect(libraryMimeType('a.md')).toBe('text/markdown');
    expect(mimeLabel('text/markdown')).toBe('Markdown');
    expect(mimeLabel('application/x-magnus-cronjob')).toBe('X-MAGNUS-CRONJOB');
  });
});
