import {
  AuthorizeConsentRequestSchema,
  BrowserAuthorizationResponseSchema,
  type AuthorizeConsentRequest,
} from '../../contracts/oathweave-browser.generated';

export type PortalAuthorizationRequest = Readonly<AuthorizeConsentRequest>;
const parameters = {
  client_id: 'clientId', redirect_uri: 'redirectUri', response_type: 'responseType',
  state: 'state', nonce: 'nonce', code_challenge: 'codeChallenge',
  code_challenge_method: 'codeChallengeMethod', scope: 'scope',
} as const;
const binding = /^[A-Za-z0-9_-]{32,256}$/;
const requestFields = new Set<string>(Object.values(parameters));

function redirectUri(value: string): void {
  const url = new URL(value);
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password ||
      value.includes('#') || /[\u0000-\u0020\\]/.test(value))
    throw new Error('The application callback must be an HTTPS URL without credentials or a fragment');
  decodeURIComponent(url.pathname);
  decodeURIComponent(url.search);
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized) || ['code', 'state', 'iss', 'error', 'error_description'].includes(normalized))
      throw new Error('The application callback has ambiguous authorization parameters');
    seen.add(normalized);
  }
}

/** Validate the protocol envelope in addition to the owning product request DTO. */
export function validatePortalAuthorization(value: unknown): PortalAuthorizationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !requestFields.has(key)))
    throw new Error('Unsupported authorization request');
  const request = AuthorizeConsentRequestSchema.parse(value);
  if (!/^hivexui-[a-z0-9-]{1,192}$/.test(request.clientId) || request.responseType !== 'code' ||
      !binding.test(request.state ?? '') || !binding.test(request.nonce ?? '') ||
      request.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge ?? '') ||
      !request.scope || request.scope.length > 1000 ||
      !/^[A-Za-z0-9:_-]+(?: [A-Za-z0-9:_-]+)*$/.test(request.scope) || !request.scope.split(' ').includes('openid'))
    throw new Error('Authorization requires a public client, Code with S256 PKCE, OpenID scope, state and nonce');
  redirectUri(request.redirectUri);
  return Object.freeze(request);
}

export function parsePortalAuthorization(search: string): PortalAuthorizationRequest {
  if (search.length > 8192) throw new Error('Authorization request is too large');
  decodeURIComponent(search); // URLSearchParams otherwise silently replaces malformed UTF-8.
  const query = new URLSearchParams(search);
  const body: Record<string, string> = {};
  for (const [key, value] of query) {
    if (!Object.hasOwn(parameters, key) || Object.hasOwn(body, parameters[key as keyof typeof parameters]))
      throw new Error('Unknown or repeated authorization parameter');
    body[parameters[key as keyof typeof parameters]] = value;
  }
  return validatePortalAuthorization(body);
}

/** Append only a validated response to the exact callback that the API accepted. */
export function authorizationRedirect(request: PortalAuthorizationRequest, value: unknown, issuer: string): string {
  const input = validatePortalAuthorization(request);
  const result = BrowserAuthorizationResponseSchema.parse(value);
  if (result.state !== input.state || result.iss !== issuer || !/^[A-Za-z0-9_-]{1,2048}$/.test(result.code))
    throw new Error('Invalid authorization response');
  const separator = input.redirectUri.includes('?')
    ? /[?&]$/.test(input.redirectUri) ? '' : '&' : '?';
  return input.redirectUri + separator + 'code=' + encodeURIComponent(result.code) +
    '&state=' + encodeURIComponent(result.state) + '&iss=' + encodeURIComponent(result.iss);
}
