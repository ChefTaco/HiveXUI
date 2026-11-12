/** A decoded path parameter that names one record: no separators, dot segments or NUL. */
export function checkRouteSegment(decoded: string): string {
  if (!decoded || decoded === '.' || decoded === '..' || /[\/\\\0]/.test(decoded)) throw new Error('Invalid route segment');
  return decoded;
}
