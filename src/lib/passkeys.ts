// Native WebAuthn only. Binary fields are serialized for Oathweave's public API.

/** The browser closed, refused or timed out the passkey prompt: nothing was sent. */
export class PasskeyCancelled extends Error {
  override name = 'PasskeyCancelled';
  constructor() {
    super('The passkey request was cancelled or timed out. Try again when you are ready.');
  }
}

/** Whether this browser offers WebAuthn (a secure context with PublicKeyCredential). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' && typeof navigator.credentials?.get === 'function';
}
const bytes = (value: string): ArrayBuffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid passkey challenge');
  return Uint8Array.from(
    atob(value.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  ).buffer;
};
const encoded = (value: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
function descriptors(value: unknown): PublicKeyCredentialDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.type !== 'public-key'
    )
      throw new Error('Invalid passkey descriptor');
    return {
      type: 'public-key',
      id: bytes(item.id),
      ...(Array.isArray(item.transports)
        ? { transports: item.transports as AuthenticatorTransport[] }
        : {}),
    };
  });
}
function requireCredential(credential: Credential | null): PublicKeyCredential {
  if (!credential || credential.type !== 'public-key')
    throw new Error('Passkey verification was cancelled');
  return credential as PublicKeyCredential;
}
export async function authenticatePasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof options.challenge !== 'string')
    throw new Error('Invalid passkey challenge');
  // No allowCredentials (passwordless sign-in) lets the authenticator offer its discoverable
  // passkeys for this site. User verification (device PIN or biometric) is always required.
  const credential = requireCredential(
    await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: bytes(options.challenge),
        allowCredentials: descriptors(options.allowCredentials),
        userVerification: 'required',
      } as PublicKeyCredentialRequestOptions,
    }).catch((error: unknown) => {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError'))
        throw new PasskeyCancelled();
      throw error;
    }),
  );
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encoded(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encoded(response.clientDataJSON),
      authenticatorData: encoded(response.authenticatorData),
      signature: encoded(response.signature),
      userHandle: response.userHandle ? encoded(response.userHandle) : null,
    },
  };
}
export async function registerPasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const user = options.user;
  if (
    typeof options.challenge !== 'string' ||
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    typeof user.id !== 'string'
  )
    throw new Error('Invalid passkey registration');
  const credential = requireCredential(
    await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: bytes(options.challenge),
        user: { ...user, id: bytes(user.id) },
        excludeCredentials: descriptors(options.excludeCredentials),
      } as PublicKeyCredentialCreationOptions,
    }),
  );
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encoded(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encoded(response.clientDataJSON),
      attestationObject: encoded(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}
