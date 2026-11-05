import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { searchScreens, type PaletteScreen, type ViewKey } from '../lib/navigation';
import { toggleFxLevel } from '../lib/motion';
import { Icon } from './icons';

interface Entry {
  id: string;
  label: string;
  where: string;
  icon: PaletteScreen['icon'] | 'Zap';
  run: () => void;
}

/** Jump to any screen this person can see, in any product. Loaded the first time it is opened. */
export default function CommandPalette({ screens, onNavigate, onClose }: { screens: readonly PaletteScreen[]; onNavigate: (view: ViewKey, path?: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const id = useId();
  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...screens.map((screen): Entry => ({ ...screen, run: () => onNavigate(screen.view, screen.path) })),
      { id: 'action/fx', label: 'Toggle visual effects', where: 'Action', icon: 'Zap', run: () => void toggleFxLevel() },
    ];
    return searchScreens(query, all);
  }, [screens, query, onNavigate]);
  const index = Math.min(selected, Math.max(0, entries.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
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
      if (entries.length > 0) setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(entries[index]);
    } else if (event.key === 'Tab') {
      // The list is driven from the search field, so focus stays in the dialog.
      event.preventDefault();
    }
  }
  return (
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette panel-corners" role="dialog" aria-modal="true" aria-label="Go to a screen" onKeyDown={onKeyDown}>
        <div className="palette__search">
          <Icon.Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={entries[index] ? `${id}-${index}` : undefined}
            aria-autocomplete="list"
            aria-label="Search screens"
            placeholder="Search every screen"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {entries.length === 0 ? <p className="palette__empty" role="status">No screen matches that search.</p> : null}
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Screens" className="palette__list" hidden={entries.length === 0}>
          {entries.map((entry, position) => {
            const EntryIcon = Icon[entry.icon];
            return (
              <li
                key={entry.id}
                id={`${id}-${position}`}
                role="option"
                aria-selected={position === index}
                className="palette__item"
                onMouseMove={() => setSelected(position)}
                onClick={() => choose(entry)}
              >
                <EntryIcon aria-hidden="true" />
                <span>{entry.label}</span>
                <span className="palette__where">{entry.where}</span>
              </li>
            );
          })}
        </ul>
        <div className="palette__foot" aria-hidden="true">
          <span><kbd className="key">↑↓</kbd> move</span>
          <span><kbd className="key">Enter</kbd> open</span>
          <span><kbd className="key">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
