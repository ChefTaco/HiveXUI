// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type, type Mounted } from '../modules/magnus/test-dom';
import type { PaletteScreen } from '../lib/navigation';
import { RECORD_DEBOUNCE_MS, RECORD_TIMEOUT_MS, type RecordHit, type RecordSource } from '../lib/record-search';
import type { Product } from '../lib/transport';
import CommandPalette from './command-palette';

const SCREENS: PaletteScreen[] = [
  { id: 'magnus/nodes', label: 'Nodes', where: 'Magnus · Fleet', icon: 'Server', view: 'magnus', path: '/nodes' },
  { id: 'skills', label: 'HiveSkills', where: 'HiveSkills', icon: 'Puzzle', view: 'skills' },
];
const hit = (id: string, label: string, href: string): RecordHit => ({ id, label, href, icon: 'Server' });
function source(id: string, product: Product, name: string, search: RecordSource['search'], extra: Partial<RecordSource> = {}): RecordSource {
  return { id, product, name, kind: 'Record', allowed: async () => true, search, ...extra };
}
const never = () => new Promise<RecordHit[]>(() => {});

let view: Mounted | undefined;
let onNavigate: ReturnType<typeof vi.fn<(view: string, path?: string) => void>>;
let onOpen: ReturnType<typeof vi.fn<(href: string) => void>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers();
  onNavigate = vi.fn<(view: string, path?: string) => void>();
  onOpen = vi.fn<(href: string) => void>();
  onClose = vi.fn<() => void>();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function open(sources: RecordSource[], installed: (product: Product) => boolean = () => true) {
  const loader = vi.fn(async () => sources);
  view = await mount(<CommandPalette screens={SCREENS} onNavigate={onNavigate} onOpen={onOpen} onClose={onClose} recordSources={loader} installed={installed} />);
  return loader;
}
const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const options = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent?.trim());
const groups = () => [...document.querySelectorAll('[role="group"]')].map((group) => document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent?.trim());
const selected = () => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim();
const announced = () => document.querySelector('[role="status"]')?.textContent ?? '';
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
async function search(text: string) {
  await type(input(), text);
  await advance(RECORD_DEBOUNCE_MS);
}
const key = (name: string) => act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });

describe('record search in the command palette', () => {
  it('waits for a pause in typing, and asks nothing under two characters', async () => {
    const searchFn = vi.fn(async () => [hit('n1', 'atlas', '/fleet/nodes/n1')]);
    const loader = await open([source('nodes', 'magnus', 'Magnus', searchFn)]);
    await type(input(), 'a');
    await advance(RECORD_DEBOUNCE_MS * 2);
    expect(loader).not.toHaveBeenCalled();
    await type(input(), 'at');
    await type(input(), 'atl');
    await advance(RECORD_DEBOUNCE_MS - 1);
    expect(searchFn).not.toHaveBeenCalled();
    await advance(1);
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn).toHaveBeenCalledWith('atl', 6, expect.any(AbortSignal));
  });

  it('asks only installed products', async () => {
    const magnus = vi.fn(async () => []);
    const studio = vi.fn(async () => []);
    await open([source('nodes', 'magnus', 'Magnus', magnus), source('projects', 'ardentstudio', 'Studio', studio)], (product) => product === 'magnus');
    await search('atlas');
    expect(magnus).toHaveBeenCalled();
    expect(studio).not.toHaveBeenCalled();
  });

  it('merges records with screen results, grouped by product, and says which products are still searching', async () => {
    await open([
      source('nodes', 'magnus', 'Magnus', async () => [hit('n1', 'node-one', '/fleet/nodes/n1')]),
      source('cases', 'cindertrace', 'Cindertrace', never),
    ]);
    await search('node');
    expect(groups()).toEqual(['Screens', 'Magnus', 'Cindertrace searching…']);
    expect(options()).toEqual(['NodesMagnus · Fleet', 'node-oneRecord']);
    expect(announced()).toBe('2 results so far, still searching');
  });

  it('turns a slow product into a quiet note at the deadline, keeping the rest', async () => {
    await open([
      source('nodes', 'magnus', 'Magnus', async () => [hit('n1', 'node-one', '/fleet/nodes/n1')]),
      source('cases', 'cindertrace', 'Cindertrace', never),
    ]);
    await search('node');
    await advance(RECORD_TIMEOUT_MS);
    expect(groups()).toEqual(['Screens', 'Magnus', "Couldn't search Cindertrace"]);
    expect(options()).toEqual(['NodesMagnus · Fleet', 'node-oneRecord']);
    expect(announced()).toBe('2 results');
  });

  it('keeps the records of a product when another of its lists fails, and says the results are partial', async () => {
    await open([
      source('nodes', 'magnus', 'Magnus', async () => [hit('n1', 'node-one', '/fleet/nodes/n1')]),
      source('agents', 'magnus', 'Magnus', async () => { throw new Error('offline'); }),
    ]);
    await search('node');
    expect(groups()).toEqual(['Screens', "Magnus couldn't search all of Magnus"]);
    expect(options()).toContain('node-oneRecord');
  });

  it('hides a product that refuses, without a note', async () => {
    const { HiveApiError } = await import('../lib/api-error');
    await open([source('users', 'oathweave', 'Oathweave', async () => { throw new HiveApiError(403, 'No'); })]);
    await search('alice');
    expect(document.body.textContent).not.toContain('Oathweave');
    expect(document.body.textContent).toContain('Nothing matches that search.');
  });

  it('says so when nothing matches anywhere', async () => {
    await open([source('nodes', 'magnus', 'Magnus', async () => [])]);
    await search('zzzz');
    expect(options()).toEqual([]);
    expect(document.body.textContent).toContain('Nothing matches that search.');
    expect(announced()).toBe('0 results');
  });

  it('shows "searching" rather than "nothing matches" while products are still answering', async () => {
    await open([source('nodes', 'magnus', 'Magnus', never)]);
    await search('zzzz');
    expect(document.body.textContent).not.toContain('Nothing matches');
    expect(groups()).toEqual(['Magnus searching…']);
  });

  it('caps each source and offers the product page for the rest', async () => {
    const many = Array.from({ length: 8 }, (_, i) => hit(`p${i}`, `Project ${i}`, `/studio/p/p${i}`));
    await open([source('projects', 'ardentstudio', 'Studio', async () => many, { seeAll: (query) => `/studio?q=${query}` })]);
    await search('project');
    expect(options()).toEqual(['Project 0Record', 'Project 1Record', 'Project 2Record', 'Project 3Record', 'Project 4Record', 'See all in StudioSearch']);
  });

  it('moves across groups with the arrow keys and opens a record with Enter', async () => {
    await open([source('nodes', 'magnus', 'Magnus', async () => [hit('n1', 'node-one', '/fleet/nodes/n1')])]);
    await search('node');
    expect(selected()).toBe('NodesMagnus · Fleet');
    await key('ArrowDown');
    expect(selected()).toBe('node-oneRecord');
    expect(input().getAttribute('aria-activedescendant')).toBe(document.querySelector('[aria-selected="true"]')!.id);
    await key('ArrowDown');
    expect(selected()).toBe('NodesMagnus · Fleet');
    await key('ArrowUp');
    await key('Enter');
    expect(onClose).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith('/fleet/nodes/n1');
  });

  it('keeps the selection on its entry when results arrive around it', async () => {
    let answer: (hits: RecordHit[]) => void = () => {};
    await open([source('skills', 'hiveskills', 'HiveSkills', () => new Promise((resolve) => (answer = resolve)))]);
    await search('hive');
    expect(selected()).toBe('HiveSkillsHiveSkills');
    await act(async () => answer([hit('s1', 'hive-notes', '/?page=skills')]));
    expect(selected()).toBe('HiveSkillsHiveSkills');
  });

  it('opens a screen through the route table, and closes with Escape', async () => {
    await open([]);
    await type(input(), 'nodes');
    await key('Enter');
    expect(onNavigate).toHaveBeenCalledWith('magnus', '/nodes');
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('drops record results when the query becomes too short again', async () => {
    await open([source('nodes', 'magnus', 'Magnus', async () => [hit('n1', 'node-one', '/fleet/nodes/n1')])]);
    await search('node');
    expect(options()).toContain('node-oneRecord');
    await type(input(), 'n');
    expect(options()).not.toContain('node-oneRecord');
    expect(groups()).toEqual([]);
  });
});
