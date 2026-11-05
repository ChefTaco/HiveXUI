import { useEffect, useId, useRef, useState } from 'react';
import {
  subscribeIdentityPrompts,
  type IdentityPrompt,
} from '../lib/identity-prompts';
import { Button, Field, TextInput } from './ui';

export function IdentityPrompts() {
  const [prompt, setPrompt] = useState<IdentityPrompt | null>(null);
  const [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
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
  const cancel = () => {
    if (prompt?.kind === 'consent') prompt.resolve(false);
    else prompt?.resolve(null);
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
            Verify your identity to continue. Review and submit any requested
            changes again.
          </p>
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
              Use passkey
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
