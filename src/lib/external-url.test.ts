import { expect, it } from 'vitest';
import { safeExternalUrl } from './external-url';

it('lets only http and https addresses become links', () => {
  expect(safeExternalUrl('https://auth.example.com/device?code=1')).toBe('https://auth.example.com/device?code=1');
  expect(safeExternalUrl('http://localhost:8080/notes')).toBe('http://localhost:8080/notes');
  for (const value of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/hosts', 'ms-settings:x', '/relative', '//host/path', 'not a url', '', null, undefined])
    expect(safeExternalUrl(value)).toBeNull();
});
