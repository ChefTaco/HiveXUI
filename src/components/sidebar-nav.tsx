import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn';
import { navSectionId, type ActiveNav, type NavGroup, type NavItem, type NavProduct, type ViewKey } from '../lib/navigation';
import { isNavOpen, readNavChoices, revealActive, toggleNavChoice, writeNavChoices, type NavChoices } from '../lib/nav-state';
import { Icon } from './icons';

/** Product headings that open and close, the sections inside them, and the indicator that springs between pages. */
export function SidebarNav({ products, active, counts, onNavigate }: {
  products: readonly NavProduct[];
  active: ActiveNav;
  counts: Partial<Record<ViewKey, number>>;
  onNavigate: (view: ViewKey, path?: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [choices, setChoices] = useState<NavChoices>(readNavChoices);
  const activeIds = useMemo(() => {
    if (!active.product || !active.section) return [];
    return [active.product.id, navSectionId(active.product, active.section)];
  }, [active.product, active.section]);
  const activeKey = activeIds.join('|');
  const update = (next: NavChoices) => {
    setChoices(next);
    writeNavChoices(next);
  };
  useEffect(() => {
    const next = revealActive(choices, activeIds);
    if (next !== choices) update(next);
    // Only arriving somewhere reveals it: closing the current group must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  const toggle = (id: string) => update(toggleNavChoice(choices, id, activeIds));

  const current = active.item ? (active.item.path ?? active.item.key) : '';
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const row = nav.querySelector<HTMLElement>('[aria-current="page"]');
    const visible = !!row && row.offsetParent !== null;
    nav.style.setProperty('--indicator-opacity', visible ? '1' : '0');
    if (!visible || !row) return;
    // Added up by hand: a section still animating open is the row's offset parent for a moment.
    let top = 0;
    for (let element: HTMLElement | null = row; element && element !== nav; element = element.offsetParent as HTMLElement | null) top += element.offsetTop;
    nav.style.setProperty('--indicator-y', `${top + 4}px`);
    nav.style.setProperty('--indicator-height', `${row.offsetHeight - 8}px`);
  });
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function moveFocus(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('button')].filter((button) => button.offsetParent !== null);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  const row = (item: NavItem, extra?: string) => {
    const ItemIcon = Icon[item.icon];
    const count = counts[item.key];
    const isCurrent = (item.path ?? item.key) === current;
    return (
      <button
        key={item.path ?? item.key}
        type="button"
        className={cn('nav-item', isCurrent && 'nav-item--active', extra)}
        aria-current={isCurrent ? 'page' : undefined}
        onClick={() => onNavigate(item.key, item.path)}
      >
        <ItemIcon aria-hidden="true" />
        <span>{item.label}</span>
        {typeof count === 'number' && count > 0 ? <span className="nav-count">{count}</span> : null}
      </button>
    );
  };

  const section = (product: NavProduct, group: NavGroup) => {
    const id = navSectionId(product, group);
    const open = isNavOpen(choices, id, activeIds);
    const bodyId = `nav-${id.replace(/[^a-z0-9]+/g, '-')}`;
    return (
      <div key={id}>
        <button type="button" className="nav-section__head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(id)}>
          <span>{group.label}</span>
          <Icon.ChevronRight className="nav-chevron" aria-hidden="true" />
        </button>
        <div id={bodyId} className="nav-section__body" hidden={!open}>
          {group.items.map((item) => row(item))}
        </div>
      </div>
    );
  };

  return (
    <nav ref={navRef} className="nav" aria-label="Products" onKeyDown={moveFocus}>
      <span className="nav-indicator" aria-hidden="true" />
      {products.map((product) => {
        const isActive = active.product?.id === product.id;
        const only = product.sections.length === 1 && product.sections[0]!.items.length === 1 ? product.sections[0]!.items[0]! : null;
        // A one-page product has nothing to open: its heading is the page.
        if (only)
          return (
            <div key={product.id} className={cn('nav-group nav-product', isActive && 'nav-product--active')}>
              {row(only, 'nav-item--product')}
            </div>
          );
        const open = isNavOpen(choices, product.id, activeIds);
        const ProductIcon = Icon[product.icon];
        const bodyId = `nav-${product.id}`;
        return (
          <div key={product.id} className={cn('nav-group nav-product', isActive && 'nav-product--active')}>
            <button type="button" className="nav-product__head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(product.id)}>
              <ProductIcon aria-hidden="true" />
              <span className="nav-product__name">{product.label}</span>
              {isActive && !open ? <span className="nav-active-dot" aria-label="Current page is inside" role="img" /> : null}
              <Icon.ChevronRight className="nav-chevron" aria-hidden="true" />
            </button>
            <div id={bodyId} className="nav-product__body" hidden={!open}>
              {product.sections.length > 1 ? product.sections.map((group) => section(product, group)) : product.sections[0]!.items.map((item) => row(item))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
