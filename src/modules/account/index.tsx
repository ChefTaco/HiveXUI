import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../lib/transport';
import { productEnabled } from '../../lib/runtime';
import { registerPasskey } from '../../lib/passkeys';
import {
  Button,
  ConfirmDialog,
  Field,
  Panel,
  TextInput,
} from '../../components/ui';

import {
  MfaStatusSchema as statusSchema,
  PasskeyCredentialSchema as credentialSchema,
  PasskeyOptionsResponseSchema,
  RecoveryCodesSchema, PasskeyCredentialsResponseSchema, PasskeyRegisterRequestSchema, MfaDisableRequestSchema, MfaVerifyRequestSchema, MfaSetupResponseSchema, IamSuccessResponseSchema, type MfaSetupResponse,
} from '../../../contracts/oathweave-browser.generated';
async function api(
  path: string,
  method = 'GET',
  body?: object,
): Promise<unknown> {
  const response = await apiFetch('/api/iam' + path, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof value.message === 'string'
        ? value.message
        : 'Identity could not complete this request',
    );
  return value;
}
export default function AccountModule() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(
      null,
    ),
    [credentials, setCredentials] = useState<
      z.infer<typeof credentialSchema>[]
    >([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null),
    [codes, setCodes] = useState<string[]>([]);
  const [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState<
    { kind: 'remove-passkey'; id: string } | { kind: 'replace-codes' } | null
  >(null);
  async function refresh() {
    const [status, list] = await Promise.all([
      api('/auth/mfa/status'),
      api('/mfa/webauthn/credentials'),
    ]);
    setStatus(statusSchema.parse(status));
    setCredentials(
      PasskeyCredentialsResponseSchema.parse(list).data,
    );
  }
  useEffect(() => {
    if (productEnabled('oathweave'))
      void refresh().catch((error) =>
        setError(
          error instanceof Error ? error.message : 'Identity unavailable',
        ),
      );
  }, []);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Operation failed');
    } finally {
      setBusy(false);
      setPassword('');
      setCode('');
    }
  }
  if (!productEnabled('oathweave'))
    return (
      <Panel title="Account security">
        <p>Oathweave is not configured for this console.</p>
      </Panel>
    );
  return (
    <div className="page-stack">
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Panel title="Your authentication methods">
        <p>
          {status?.enabled
            ? 'Multi-factor authentication is enabled.'
            : 'Multi-factor authentication is not enabled.'}{' '}
          Recovery codes remaining:{' '}
          {status?.recoveryCodesRemaining ?? 'Unavailable'}.
        </p>
      </Panel>
      <Panel title="Passkeys">
        <p>
          Use a device passkey or security key as your second sign-in factor.
        </p>
        <Field label="Passkey name">
          <TextInput value={name} onChange={setName} autoComplete="off" />
        </Field>
        <Button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const options = PasskeyOptionsResponseSchema.parse(
                await api('/mfa/webauthn/options'),
              );
              const response = await registerPasskey(options.data);
              IamSuccessResponseSchema.parse(await api('/mfa/webauthn/register', 'POST', PasskeyRegisterRequestSchema.parse({
                response,
                friendlyName: name,
              })));
              setName('');
              setNotice('Passkey registered.');
            })
          }
        >
          Register passkey
        </Button>
        <ul>
          {credentials.map((credential) => (
            <li key={credential.id}>
              {credential.friendlyName || 'Passkey'} · {credential.deviceType}{' '}
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  setConfirm({ kind: 'remove-passkey', id: credential.id })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Authenticator app">
        {status?.totpConfigured ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                IamSuccessResponseSchema.parse(await api('/auth/mfa/disable', 'POST', MfaDisableRequestSchema.parse({ password, code })));
                setNotice(
                  'Authenticator app removed. Registered passkeys remain available.',
                );
              });
            }}
          >
            <Field label="Current password">
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                required
              />
            </Field>
            <Field label="Authenticator code">
              <TextInput
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
                required
              />
            </Field>
            <Button variant="danger" disabled={busy} type="submit">
              Remove authenticator app
            </Button>
          </form>
        ) : setup ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const value = RecoveryCodesSchema.parse(
                  await api('/auth/mfa/verify', 'POST', MfaVerifyRequestSchema.parse({ code })),
                );
                setCodes(value.backupCodes);
                setSetup(null);
                setNotice(
                  value.backupCodes.length
                    ? 'Authenticator enabled. Save your new recovery codes.'
                    : 'Authenticator enabled. Your existing recovery codes remain valid.',
                );
              });
            }}
          >
            <p>
              Scan this code in your authenticator app, then enter its current
              code.
            </p>
            <img
              src={setup.qrDataUrl}
              alt="Authenticator setup QR code"
              width={220}
              height={220}
            />
            <details>
              <summary>Enter setup key manually</summary>
              <code>{setup.secret}</code>
            </details>
            <Field label="Authenticator code">
              <TextInput
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
                required
              />
            </Field>
            <Button variant="primary" disabled={busy} type="submit">
              Enable authenticator
            </Button>
            <Button type="button" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const value = MfaSetupResponseSchema.parse(await api('/auth/mfa/setup', 'POST', {}));
                setSetup(value);
              })
            }
          >
            Set up authenticator app
          </Button>
        )}
      </Panel>
      <Panel title="Recovery codes">
        <p>
          Save these privately. Replacing codes immediately invalidates the
          previous set.
        </p>
        <Button
          disabled={busy || !status?.enabled}
          onClick={() => setConfirm({ kind: 'replace-codes' })}
        >
          Replace recovery codes
        </Button>
        {!!codes.length && (
          <div>
            <p>
              These codes are shown once. They stay in memory until dismissed.
            </p>
            <ul>
              {codes.map((value) => (
                <li key={value}>
                  <code>{value}</code>
                </li>
              ))}
            </ul>
            <Button onClick={() => setCodes([])}>I saved my codes</Button>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === 'replace-codes'
            ? 'Replace recovery codes?'
            : 'Remove passkey?'
        }
        message={
          confirm?.kind === 'replace-codes'
            ? 'Your old recovery codes will stop working. Save the replacement set before leaving this page.'
            : 'This passkey will no longer sign in to your account.'
        }
        confirmLabel={
          confirm?.kind === 'replace-codes' ? 'Replace codes' : 'Remove passkey'
        }
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          void action(async () => {
            if (confirm?.kind === 'replace-codes') {
              const value = RecoveryCodesSchema.parse(
                await api('/auth/mfa/recovery-codes', 'POST', {}),
              );
              setCodes(value.backupCodes);
            } else if (confirm) {
              IamSuccessResponseSchema.parse(await api(
                '/mfa/webauthn/credentials/' + encodeURIComponent(confirm.id),
                'DELETE',
              ));
            }
            setConfirm(null);
          })
        }
      />
    </div>
  );
}
