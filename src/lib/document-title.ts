import { useEffect } from 'react';

/** The tab and history title for a page (WCAG 2.4.2); without a page, the console's own name. */
export const documentTitle = (page?: string): string => (page ? `${page} · HiveXUI` : 'HiveXUI · Hive:Magnus');

/** Sets the tab title while the calling screen is shown. */
export function useDocumentTitle(page: string | undefined): void {
  useEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
}
