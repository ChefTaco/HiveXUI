import { useEffect, useId, useRef, useState } from 'react';
import {
  subscribeIdentityPrompts,
  type IdentityPrompt,
} from '../lib/identity-prompts';
import { Button, Field, TextInput } from './ui';
import { useToast } from './toast';

export function IdentityPrompts() {
  const [prompt, setPrompt] = useState<IdentityPrompt | null>(null);
  const [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const passkeyHint = useId();
  useEffect(() => subscribeIdentityPrompts(setPrompt), []);
  useEffect(() => {
    setPassword('');
    setCode('');
    if (prompt && !dialog.current?.open) dialog.current?.showModal();
    if (!prompt) dialog.current?.close();
    else
      queueMicrotask(() =>
        dialog.current?.querySelector<HTMLElement>('input,button')?.focus(),
      );
  }, [prompt]);
  const toast = useToast();
  const cancel = () => {
    if (prompt?.kind === 'consent') prompt.resolve(false);
    else if (prompt) {
      prompt.resolve(null);
      toast.info('Identity verification cancelled', 'Nothing was changed. Start the action again when you are ready.');
    }
  };
  /** A passkey alone: the device verifies the person, so no password is typed or sent. */
  const passkeyOnly = () => {
    if (prompt?.kind !== 'step-up' || !prompt.passkeyOnly) return;
    setPassword('');
    setCode('');
    prompt.resolve({ passkey: true });
  };
  const verify = (passkey: boolean) => {
    if (prompt?.kind !== 'step-up' || !password) return;
    const value = {
      password,
      ...(code ? { totpCode: code } : {}),
      ...(passkey ? { passkey: true } : {}),
    };
    setPassword('');
    setCode('');
    prompt.resolve(value);
  };
  return (
    <dialog
      ref={dialog}
      className="identity-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id={title}>
        {prompt?.kind === 'consent' ? 'Review access' : 'Verify your identity'}
      </h2>
      {prompt?.kind === 'consent' ? (
        <>
          <p>
            <strong>{prompt.details.clientName}</strong> requests access to{' '}
            {prompt.details.audience}.
          </p>
          {prompt.details.clientDescription && (
            <p>{prompt.details.clientDescription}</p>
          )}
          <p>Scopes: {prompt.details.scope || 'None'}</p>
          <ul>
            {prompt.details.permissions.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <div className="confirm-actions">
            <Button onClick={cancel}>Decline</Button>
            <Button variant="primary" onClick={() => prompt.resolve(true)}>
              Allow access
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            verify(false);
          }}
        >
          <p>
            This action needs a fresh sign-in. Verify your identity with
            Oathweave to continue; your password goes only to Oathweave.
          </p>
          {prompt?.kind === 'step-up' && prompt.passkeyOnly && (
            <div className="identity-passkey">
              <Button
                type="button"
                aria-describedby={passkeyHint}
                onClick={passkeyOnly}
              >
                Verify with a passkey
              </Button>
              <p id={passkeyHint} className="field-hint">
                Your passkey alone, confirmed with your device PIN or
                biometric. Or use your password below.
              </p>
            </div>
          )}
          <Field label="Current password">
            <TextInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
          </Field>
          <Field label="Authenticator code (if enabled)">
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onChange={setCode}
            />
          </Field>
          <div className="confirm-actions">
            <Button type="button" onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!password}
              onClick={() => verify(true)}
            >
              Password and passkey
            </Button>
            <Button variant="primary" type="submit">
              Verify
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
