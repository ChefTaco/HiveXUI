// Self-service password change and the caller's own sessions, on Account security. Both read and
// write the signed-in person's own record through Oathweave's /auth routes with their own token.
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../lib/transport';
import { describeApiError, HiveApiError, responseRequestId } from '../../lib/api-error';
import { formatTime, relativeTime } from '../../lib/format';
import { Badge, Button, ConfirmDialog, EmptyState, Field, LoadingRows, Panel, TextInput } from '../../components/ui';
import { IamSuccessResponseSchema } from '../../../contracts/oathweave-browser.generated';

// The vendored Oathweave contract (2.3.0) does not export these two shapes; they follow
// Oathweave's own `ChangePasswordSchema` and its `GET /auth/sessions` answer.
const ChangePasswordRequestSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256) });
const OwnSessionSchema = z.object({
  id: z.string().min(1).max(200),
  createdAt: z.string(),
  expiresAt: z.string(),
  ipAddress: z.string().max(200).nullable().optional(),
  userAgent: z.string().max(1000).nullable().optional(),
  stepUpVerifiedAt: z.string().nullable().optional(),
  current: z.boolean(),
});
const OwnSessionsResponseSchema = z.object({ sessions: z.array(OwnSessionSchema).max(500) });
type OwnSession = z.infer<typeof OwnSessionSchema>;

async function identity(path: string, method = 'GET', body?: object): Promise<unknown> {
  const response = await apiFetch('/api/iam' + path, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : 'Identity could not complete this request';
    const code = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : undefined;
    throw new HiveApiError(response.status, message, { code, requestId: responseRequestId(response) });
  }
  return value;
}

/** Change your own password. Oathweave checks the current one and its password policy, and ends your other sessions. */
export function PasswordChange({ onChanged }: { onChanged?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setResult(null);
    if (next !== again) {
      setResult({ ok: false, text: 'The new passwords do not match.' });
      return;
    }
    if (next === current) {
      setResult({ ok: false, text: 'Choose a password different from the current one.' });
      return;
    }
    setBusy(true);
    try {
      const body = ChangePasswordRequestSchema.parse({ currentPassword: current, newPassword: next });
      IamSuccessResponseSchema.parse(await identity('/auth/password', 'POST', body));
      setResult({ ok: true, text: 'Password changed. Your other sign-ins were ended; this one continues.' });
      onChanged?.();
    } catch (error) {
      setResult({ ok: false, text: error instanceof z.ZodError ? 'The new password needs at least 8 characters.' : describeApiError(error, 'The password could not be changed') });
    } finally {
      setBusy(false);
      setCurrent('');
      setNext('');
      setAgain('');
    }
  }
  return (
    <Panel title="Password">
      <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
        <p className="m-0">Change the password you sign in with. Your installation's password policy applies, and your other signed-in sessions end.</p>
        <Field label="Current password">
          <TextInput type="password" autoComplete="current-password" required value={current} onChange={setCurrent} />
        </Field>
        <Field label="New password">
          <TextInput type="password" autoComplete="new-password" required minLength={8} value={next} onChange={setNext} />
        </Field>
        <Field label="Repeat the new password">
          <TextInput type="password" autoComplete="new-password" required minLength={8} value={again} onChange={setAgain} />
        </Field>
        {result ? <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'm-0' : 'm-0 text-danger'}>{result.text}</p> : null}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={!current || !next || !again}>
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Your own signed-in sessions, from Oathweave's self-service sessions (the Oathweave release after
 * 2.4.0). Any session but this one can be ended; against an older Oathweave the panel says so.
 */
export function OwnSessions({ reload = 0 }: { reload?: number }) {
  const [sessions, setSessions] = useState<OwnSession[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [error, setError] = useState('');
  const [ending, setEnding] = useState<OwnSession | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSessions(OwnSessionsResponseSchema.parse(await identity('/auth/sessions')).sessions);
      setState('ready');
      setError('');
    } catch (caught) {
      if (caught instanceof HiveApiError && caught.status === 404) setState('unsupported');
      else {
        setState('error');
        setError(describeApiError(caught, 'Your sessions could not be loaded'));
      }
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reload]);
  async function end() {
    const session = ending;
    if (!session) return;
    setBusy(true);
    try {
      await identity('/auth/sessions/' + encodeURIComponent(session.id), 'DELETE');
      await load();
    } catch (caught) {
      setError(describeApiError(caught, 'The session could not be ended'));
    } finally {
      setBusy(false);
      setEnding(null);
    }
  }
  return (
    <Panel title="Your sessions">
      {state === 'loading' ? (
        <LoadingRows rows={2} />
      ) : state === 'unsupported' ? (
        <p className="m-0 text-text-muted">This Oathweave does not list your own sessions yet. Upgrade Oathweave to see and end them here; an identity administrator can end them under IAM Sessions.</p>
      ) : (
        <>
          {error ? <p role="alert" className="m-0 text-danger">{error}</p> : null}
          {sessions && sessions.length ? (
            <ul className="check-list m-0 p-0" aria-label="Your sessions">
              {sessions.map((session) => (
                <li key={session.id} className="check-row">
                  <div>
                    <strong>
                      {session.userAgent || 'Unknown browser'} {session.current ? <Badge tone="success">This session</Badge> : null}
                    </strong>
                    <span>
                      Signed in <span title={formatTime(session.createdAt)}>{relativeTime(session.createdAt)}</span>
                      {session.ipAddress ? ` from ${session.ipAddress}` : ''} · ends {formatTime(session.expiresAt)}
                    </span>
                  </div>
                  {session.current ? null : (
                    <Button size="sm" variant="danger" onClick={() => setEnding(session)}>
                      End session
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : state === 'ready' ? (
            <EmptyState compact title="No active sessions" message="Oathweave lists no signed-in session for you." />
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={ending !== null}
        title="End this session?"
        message={`The browser or device signed in ${ending ? relativeTime(ending.createdAt) : ''}${ending?.ipAddress ? ` from ${ending.ipAddress}` : ''} is signed out and must sign in again.`}
        confirmLabel="End session"
        loading={busy}
        onCancel={() => setEnding(null)}
        onConfirm={() => void end()}
      />
    </Panel>
  );
}
