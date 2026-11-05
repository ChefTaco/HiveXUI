import { Fragment } from 'react';
import type { Crumb, ViewKey } from '../lib/navigation';
import { Icon } from './icons';

/** `>_ MAGNUS > FLEET > FLEET OVERVIEW ▮`. The page's <h1> is its last crumb; the page itself shows the display title. */
export function Breadcrumb({ crumbs, onNavigate }: { crumbs: readonly Crumb[]; onNavigate: (view: ViewKey, path?: string) => void }) {
  return (
    <div className="crumbs">
      <span className="crumbs__prompt" aria-hidden="true">{'>_'}</span>
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const { to } = crumb;
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 ? <Icon.ChevronRight className="crumbs__sep" aria-hidden="true" /> : null}
                <li {...(last ? { 'aria-current': 'page' as const } : {})}>
                  {last ? (
                    <h1 className="title" tabIndex={-1}>{crumb.label}</h1>
                  ) : to ? (
                    <button type="button" className="crumb-link" onClick={() => onNavigate(to.view, to.path)}>{crumb.label}</button>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
      <span className="crumbs__cursor" aria-hidden="true" />
    </div>
  );
}
