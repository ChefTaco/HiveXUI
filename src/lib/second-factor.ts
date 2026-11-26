/**
 * The password was right and the account has a second factor: the same request is sent again with
 * the code. Emberpath 2.7.0 and later take an authenticator or recovery code (`mfaCode`);
 * Cindertrace's local sign-in takes a six-digit authenticator code (`totp`).
 */
export class SecondFactorRequired extends Error {
  override name = 'SecondFactorRequired';
  constructor(readonly kind: 'mfa' | 'totp' = 'mfa') {
    super(kind === 'totp' ? 'Enter the 6-digit code from your authenticator app' : 'Enter the code from your authenticator app, or a recovery code');
  }
}
