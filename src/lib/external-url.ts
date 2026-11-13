/**
 * An address that came from a product's API, as the `href` of a link that leaves HiveXUI, or null
 * when it is not a plain web address. Only http(s) may become a link the operator clicks: any other
 * scheme (`javascript:`, `data:`, an application handler) is shown as text or not at all.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
