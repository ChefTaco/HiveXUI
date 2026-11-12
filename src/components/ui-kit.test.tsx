// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, stubBrowser, type, type Mounted } from '../modules/magnus/test-dom';
import { DataTable, FilterBar, LoadingRows, Menu, Pagination, ResourceError, TabPanel, Tabs, useCursorPagination, type DataTableColumn } from './ui';

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

const key = async (target: Element | null, name: string) => {
  if (!target) throw new Error(`Nothing to press ${name} on`);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
};

describe('LoadingRows and ResourceError', () => {
  it('show busy lines, then a failure with Retry', async () => {
    const onRetry = vi.fn();
    view = await mount(<><LoadingRows rows={3} /><ResourceError error={new Error('Gateway timed out')} title="Could not load nodes" onRetry={onRetry} /></>);
    expect(document.querySelectorAll('[aria-busy="true"] .skeleton')).toHaveLength(3);
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Could not load nodes');
    expect(alert.textContent).toContain('Gateway timed out');
    await click(button('Retry', alert));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fall back to a generic message for a non-Error failure', async () => {
    view = await mount(<ResourceError error="nope" title="Failed" />);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('The request failed');
  });
});

interface Fruit { id: string; name: string }
const columns: Array<DataTableColumn<Fruit>> = [
  { key: 'name', header: 'Name', cell: (row) => row.name, className: 'cell-strong' },
  { key: 'actions', header: 'Actions', cell: (row) => <button type="button" className="btn">Inspect {row.name}</button> },
];

describe('DataTable', () => {
  it('renders typed columns in a labelled frame', async () => {
    view = await mount(<DataTable label="Fruit" columns={columns} rows={[{ id: 'a', name: 'Apple' }, { id: 'b', name: 'Pear' }]} rowKey={(row) => row.id} />);
    expect(document.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('Fruit');
    expect([...document.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Name', 'Actions']);
    expect([...document.querySelectorAll('tbody td.cell-strong')].map((cell) => cell.textContent)).toEqual(['Apple', 'Pear']);
  });

  it('shows loading lines, then an empty state', async () => {
    view = await mount(<DataTable label="Fruit" columns={columns} rows={[]} rowKey={(row) => row.id} loading />);
    expect(document.querySelector('table')!.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('tbody [aria-busy="true"]')).not.toBeNull();
    await view.unmount();
    view = await mount(<DataTable label="Fruit" columns={columns} rows={[]} rowKey={(row) => row.id} empty="No fruit yet" />);
    expect(document.querySelector('tbody .empty-state')!.textContent).toBe('No fruit yet');
    expect(document.querySelector('tbody td')!.getAttribute('colspan')).toBe('2');
  });

  it('shows a failed read with Retry', async () => {
    const onRetry = vi.fn();
    view = await mount(<DataTable label="Fruit" columns={columns} rows={null} rowKey={(row) => row.id} error={new Error('Down')} onRetry={onRetry} />);
    await click(button('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('opens a row by click or keyboard, but not from a control inside it', async () => {
    const onRowClick = vi.fn();
    view = await mount(<DataTable label="Fruit" columns={columns} rows={[{ id: 'a', name: 'Apple' }]} rowKey={(row) => row.id} onRowClick={onRowClick} rowLabel={(row) => `Open ${row.name}`} />);
    const row = document.querySelector<HTMLElement>('tbody tr')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-label')).toBe('Open Apple');
    await click(row.querySelector('td'));
    expect(onRowClick).toHaveBeenCalledWith({ id: 'a', name: 'Apple' });
    await click(button('Inspect Apple'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await key(row, 'Enter');
    await key(row, ' ');
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });
});

function TabsProbe() {
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one');
  return (
    <>
      <Tabs label="Sections" idPrefix="probe" value={tab} onChange={setTab} tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two', count: 4 }, { id: 'three', label: 'Three' }]} />
      <TabPanel idPrefix="probe" id={tab}>Panel {tab}</TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('is a labelled tablist with one tab stop and linked panels', async () => {
    view = await mount(<TabsProbe />);
    const list = document.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe('Sections');
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[1]!.textContent).toBe('Two4');
    const panel = document.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(tabs[0]!.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('moves and selects with the arrow keys, Home and End', async () => {
    view = await mount(<TabsProbe />);
    const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.textContent?.startsWith(name))!;
    tab('One').focus();
    await key(tab('One'), 'ArrowRight');
    expect(tab('Two').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Two'));
    expect(document.querySelector('[role="tabpanel"]')!.textContent).toBe('Panel two');
    await key(tab('Two'), 'End');
    expect(document.activeElement).toBe(tab('Three'));
    await key(tab('Three'), 'ArrowRight');
    expect(document.activeElement).toBe(tab('One'));
    await key(tab('One'), 'ArrowLeft');
    expect(document.activeElement).toBe(tab('Three'));
    await key(tab('Three'), 'Home');
    expect(tab('One').getAttribute('aria-selected')).toBe('true');
    expect(tab('One').getAttribute('tabindex')).toBe('0');
  });
});

function PagesProbe({ pages }: { pages: Record<string, string | undefined> }) {
  const paging = useCursorPagination<string>();
  const nextCursor = pages[paging.cursor ?? 'start'];
  return (
    <Pagination
      summary={`Page ${paging.page}`}
      hasPrevious={paging.hasPrevious}
      hasNext={Boolean(nextCursor)}
      onPrevious={paging.previous}
      onNext={() => nextCursor && paging.next(nextCursor)}
    />
  );
}

describe('Pagination', () => {
  it('walks forward and back through cursors', async () => {
    view = await mount(<PagesProbe pages={{ start: 'c2', c2: 'c3', c3: undefined }} />);
    const nav = document.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Pagination');
    expect(button('Previous')!.disabled).toBe(true);
    await click(button('Next'));
    await click(button('Next'));
    expect(nav.textContent).toContain('Page 3');
    expect(button('Next')!.disabled).toBe(true);
    await click(button('Previous'));
    expect(nav.textContent).toContain('Page 2');
    expect(button('Next')!.disabled).toBe(false);
  });

  it('disables both directions while loading', async () => {
    view = await mount(<Pagination hasPrevious hasNext loading onPrevious={() => undefined} onNext={() => undefined} />);
    expect(button('Previous')!.disabled).toBe(true);
    expect(button('Next')!.disabled).toBe(true);
  });
});

function FilterProbe({ onQuery }: { onQuery: (value: string) => void }) {
  const [query, setQuery] = useState('');
  return (
    <FilterBar search={{ value: query, onChange: (value) => { setQuery(value); onQuery(value); }, label: 'Search nodes' }} actions={<span>3 nodes</span>}>
      <select aria-label="Status" className="w-auto"><option>All</option></select>
    </FilterBar>
  );
}

describe('FilterBar', () => {
  it('has a labelled search box, filter slots and a clear button', async () => {
    const onQuery = vi.fn();
    view = await mount(<FilterProbe onQuery={onQuery} />);
    expect(document.querySelector('[role="search"]')!.getAttribute('aria-label')).toBe('Filters');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search nodes"]')!;
    expect(button('Clear search')).toBeUndefined();
    await type(input, 'web');
    expect(onQuery).toHaveBeenLastCalledWith('web');
    expect(document.querySelector('.filter-bar__filters select')).not.toBeNull();
    expect(document.querySelector('.filter-bar__actions')!.textContent).toBe('3 nodes');
    await click(button('Clear search'));
    expect(onQuery).toHaveBeenLastCalledWith('');
    expect(input.value).toBe('');
  });
});

describe('Menu', () => {
  const setup = async () => {
    const edit = vi.fn(), remove = vi.fn();
    view = await mount(
      <Menu label="Row actions" items={[
        { id: 'edit', label: 'Edit', onSelect: edit },
        { id: 'archive', label: 'Archive', onSelect: () => undefined, disabled: true },
        { id: 'delete', label: 'Delete', onSelect: remove, tone: 'danger' },
      ]} />,
    );
    const trigger = button(/Row actions/)!;
    const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    return { edit, remove, trigger, items };
  };

  it('opens from its button and focuses the first item', async () => {
    const { trigger, items } = await setup();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="menu"]')!.id).toBe(trigger.getAttribute('aria-controls'));
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves with the arrow keys past disabled items, and wraps', async () => {
    const { trigger, items } = await setup();
    trigger.focus();
    await key(trigger, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('Delete');
    await key(document.activeElement, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Edit');
    await key(document.activeElement, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Delete');
    await key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    await key(document.activeElement, 'End');
    expect(document.activeElement?.textContent).toBe('Delete');
  });

  it('closes on Escape and returns focus to its button', async () => {
    const { trigger } = await setup();
    await click(trigger);
    await key(document.activeElement, 'Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('runs the chosen action, closes and returns focus', async () => {
    const { trigger, remove, items } = await setup();
    await click(trigger);
    await click(items()[2]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside', async () => {
    const { trigger } = await setup();
    await click(trigger);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
