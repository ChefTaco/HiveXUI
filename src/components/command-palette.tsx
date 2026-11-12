import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { searchScreens, type PaletteScreen, type ViewKey } from '../lib/navigation';
import { toggleFxLevel } from '../lib/motion';
import {
  eligibleSources,
  groupRecords,
  recordQuery,
  runRecordSearch,
  RECORD_DEBOUNCE_MS,
  type RecordGroup,
  type RecordSource,
  type SourceState,
} from '../lib/record-search';
import { productInstalled } from '../lib/runtime';
import { productPrefix, type Product } from '../lib/transport';
import type { AdminUser } from '../lib/types';
import { Icon } from './icons';

interface Entry {
  id: string;
  label: string;
  detail?: string;
  where: string;
  icon: PaletteScreen['icon'] | 'Zap' | 'ChevronRight';
  run: () => void;
}
interface Group {
  key: string;
  label: string;
  entries: Entry[];
  /** "searching…" or "couldn't search", beside the product's name. */
  note?: string | undefined;
  /** A product that could not be searched and has nothing to show: the note is the whole line. */
  unavailable?: boolean;
}

/** Where record sources come from: the live ones, loaded with the first search, unless a test gives its own. */
export type RecordSourceLoader = () => Promise<readonly RecordSource[]>;
const liveLoader = (user: AdminUser | null): RecordSourceLoader => () => import('../lib/record-sources').then((module) => module.liveRecordSources(user));
/** Installed and configured for this browser: a product with no API prefix has nowhere to be asked. */
const searchable = (product: Product): boolean => productInstalled(product) && productPrefix(product) !== undefined;

/**
 * Records from every installed product the person may read, for a query. Waits for a pause in
 * typing, asks each source once, and keeps each answer as it arrives.
 */
function useRecordSearch(query: string, load: RecordSourceLoader, installed: (product: Product) => boolean) {
  const [sources, setSources] = useState<readonly RecordSource[] | null>(null);
  const [states, setStates] = useState<ReadonlyMap<string, SourceState>>(new Map());
  const [asked, setAsked] = useState<readonly RecordSource[]>([]);
  const loading = useRef<Promise<readonly RecordSource[]> | null>(null);
  const text = recordQuery(query);
  useEffect(() => {
    if (text === null) {
      setStates(new Map());
      setAsked([]);
      return;
    }
    let cancel: (() => void) | undefined;
    let active = true;
    const timer = setTimeout(() => {
      loading.current ??= load().catch(() => {
        loading.current = null;
        return [];
      });
      void loading.current.then((loaded) => {
        if (!active) return;
        setSources(loaded);
        const chosen = eligibleSources(loaded, text, installed);
        setAsked(chosen);
        setStates(new Map());
        cancel = runRecordSearch(text, chosen, (id, state) => {
          if (active) setStates((current) => new Map(current).set(id, state));
        });
      });
    }, RECORD_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      cancel?.();
    };
  }, [text, load, installed]);
  return { groups: text === null || !sources ? [] : groupRecords(asked, states) };
}

const noteFor = (group: RecordGroup): string | undefined =>
  group.pending ? 'searching…' : group.failed && group.entries.length > 0 ? `couldn't search all of ${group.name}` : undefined;

/**
 * Jump to any screen this person can see, in any product, or to a record found in one. Loaded the
 * first time it is opened.
 */
export default function CommandPalette({
  screens,
  user = null,
  onNavigate,
  onOpen,
  onClose,
  recordSources,
  installed = searchable,
}: {
  screens: readonly PaletteScreen[];
  user?: AdminUser | null;
  onNavigate: (view: ViewKey, path?: string) => void;
  /** Opens an address from the route table: where a record result leads. */
  onOpen: (href: string) => void;
  onClose: () => void;
  recordSources?: RecordSourceLoader;
  installed?: (product: Product) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const id = useId();
  const [load] = useState<RecordSourceLoader>(() => recordSources ?? liveLoader(user));
  const records = useRecordSearch(query, load, installed);

  const screenEntries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...screens.map((screen): Entry => ({ ...screen, run: () => onNavigate(screen.view, screen.path) })),
      { id: 'action/fx', label: 'Toggle visual effects', where: 'Action', icon: 'Zap', run: () => void toggleFxLevel() },
    ];
    return searchScreens(query, all);
  }, [screens, query, onNavigate]);
  const groups = useMemo<Group[]>(() => {
    const recordGroups = records.groups.map((group): Group => ({
      key: `product/${group.product}`,
      ...(group.failed && !group.pending && group.entries.length === 0
        ? { label: `Couldn't search ${group.name}`, unavailable: true }
        : { label: group.name, note: noteFor(group) }),
      entries: group.entries.map((entry): Entry =>
        'hit' in entry
          ? { id: `record/${entry.source.id}/${entry.hit.id}`, label: entry.hit.label, ...(entry.hit.detail ? { detail: entry.hit.detail } : {}), where: entry.source.kind, icon: entry.hit.icon, run: () => onOpen(entry.hit.href) }
          : { id: `all/${entry.source.id}`, label: `See all in ${group.name}`, where: 'Search', icon: 'ChevronRight', run: () => onOpen(entry.seeAll) },
      ),
    }));
    return [...(screenEntries.length > 0 || recordGroups.length > 0 ? [{ key: 'screens', label: 'Screens', entries: screenEntries }] : []), ...recordGroups].filter(
      (group) => group.entries.length > 0 || group.note || group.unavailable,
    );
  }, [screenEntries, records.groups, onOpen]);
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  // Selection follows the entry, not the position, so results arriving above it do not move it.
  const found = entries.findIndex((entry) => entry.id === selectedId);
  const index = found >= 0 ? found : 0;
  const pending = records.groups.filter((group) => group.pending).length;
  const grouped = records.groups.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, entries]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (entries.length > 0) setSelectedId(entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]!.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(entries[index]);
    } else if (event.key === 'Tab') {
      // The list is driven from the search field, so focus stays in the dialog.
      event.preventDefault();
    }
  }
  const announcement = !query.trim()
    ? ''
    : pending > 0
      ? `${entries.length} ${entries.length === 1 ? 'result' : 'results'} so far, still searching`
      : `${entries.length} ${entries.length === 1 ? 'result' : 'results'}`;
  const option = (entry: Entry) => {
    const position = entries.indexOf(entry);
    const EntryIcon = Icon[entry.icon];
    return (
      <li
        key={entry.id}
        id={`${id}-${position}`}
        role="option"
        aria-selected={position === index}
        className="palette__item"
        onMouseMove={() => setSelectedId(entry.id)}
        onClick={() => choose(entry)}
      >
        <EntryIcon aria-hidden="true" />
        <span className="palette__label">
          {entry.label}
          {entry.detail ? <span className="palette__detail"> {entry.detail}</span> : null}
        </span>
        <span className="palette__where">{entry.where}</span>
      </li>
    );
  };
  return (
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette panel-corners" role="dialog" aria-modal="true" aria-label="Search screens and records" onKeyDown={onKeyDown}>
        <div className="palette__search">
          <Icon.Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={entries[index] ? `${id}-${index}` : undefined}
            aria-autocomplete="list"
            aria-label="Search screens and records"
            placeholder="Search screens and records"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {entries.length === 0 && pending === 0 ? <p className="palette__empty">Nothing matches that search.</p> : null}
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Results" className="palette__list" hidden={groups.length === 0}>
          {grouped
            ? groups.map((group) => (
                <li key={group.key} role="presentation" className="palette__group">
                  <ul role="group" aria-labelledby={`${id}-${group.key}`}>
                    <li role="presentation" id={`${id}-${group.key}`} className={group.unavailable ? 'palette__group-label palette__group-label--note' : 'palette__group-label'}>
                      {group.label}
                      {group.note ? <span className="palette__note"> {group.note}</span> : null}
                    </li>
                    {group.entries.map(option)}
                  </ul>
                </li>
              ))
            : entries.map(option)}
        </ul>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        <div className="palette__foot" aria-hidden="true">
          <span><kbd className="key">↑↓</kbd> move</span>
          <span><kbd className="key">Enter</kbd> open</span>
          <span><kbd className="key">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
