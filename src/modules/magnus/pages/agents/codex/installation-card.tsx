import { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, ExternalLink, KeyRound, LogOut, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@ui';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, HaloDot } from '../../../effects';
import { ActionConfirm } from '../../../ui/action-confirm';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { Fact } from '../shared/fx';
import { authTone, canRequestUpdate, safeExternalUrl } from './logic';
import { codexDeviceSessionResponseSchema, codexInstallationResponseSchema, type CodexDeviceSession, type CodexInstallation } from './schemas';

const DEVICE_POLL_MS = 2000;
const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'not available');
const base = (nodeId: string) => `/codex/installations/${segment(nodeId)}`;

export function CodexInstallationCard({ installation, onChange }: { installation: CodexInstallation; onChange: (installation: CodexInstallation) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [session, setSession] = useState<CodexDeviceSession | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<'update' | 'logout' | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const pending = session?.status === 'pending' ? session.id : null;
  const verificationUrl = session ? safeExternalUrl(session.verificationUrl) : null;

  // Only while a device login the operator started is pending, and one request at a time.
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = (await magnus.get(`${base(installation.nodeId)}/device-auth/${segment(pending)}`, codexDeviceSessionResponseSchema, { signal: controller.signal })).data;
        setSession(next);
        if (next.status === 'completed') change.current((await magnus.get(base(installation.nodeId), codexInstallationResponseSchema, { signal: controller.signal })).data);
        if (next.status === 'pending') timer = setTimeout(() => void poll(), DEVICE_POLL_MS);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught, 'The device login status could not be read'));
        timer = setTimeout(() => void poll(), DEVICE_POLL_MS * 4);
      }
    };
    timer = setTimeout(() => void poll(), DEVICE_POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [installation.nodeId, pending]);

  async function run(action: 'update' | 'logout') {
    setConfirming(null);
    setBusy(action);
    setError('');
    try {
      change.current((await magnus.post(`${base(installation.nodeId)}/${action}`, codexInstallationResponseSchema)).data);
    } catch (caught) {
      setError(errorMessage(caught, action === 'update' ? 'Codex could not be updated' : 'Codex could not log out'));
    } finally {
      setBusy(null);
    }
  }
  async function startDeviceLogin() {
    setBusy('device');
    setError('');
    try {
      setSession((await magnus.post(`${base(installation.nodeId)}/device-auth`, codexDeviceSessionResponseSchema)).data);
    } catch (caught) {
      setError(errorMessage(caught, 'A Codex device code could not be created'));
    } finally {
      setBusy(null);
    }
  }
  async function cancelDeviceLogin() {
    if (!session) return;
    setBusy('cancel');
    try {
      setSession((await magnus.post(`${base(installation.nodeId)}/device-auth/${segment(session.id)}/cancel`, codexDeviceSessionResponseSchema)).data);
    } catch (caught) {
      setError(errorMessage(caught, 'The device login could not be cancelled'));
    } finally {
      setBusy(null);
    }
  }
  async function copyCode() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('The browser did not allow copying. Select the code instead.');
    }
  }
  const { auth } = installation;
  return (
    <FxPanel
      title={installation.nodeName}
      description={`${installation.hostname}${installation.user ? ` · ${installation.user}` : ''}`}
      actions={<Badge tone={installation.reachable ? authTone(auth.status) : 'danger'} dot>{installation.reachable ? auth.status.replaceAll('_', ' ') : 'unreachable'}</Badge>}
      fxTone={!installation.reachable ? 'danger' : auth.oauth ? 'success' : 'warning'}
      className="min-w-0"
    >
      <div className="grid gap-4">
        {!installation.reachable ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger">{installation.error ?? 'The Magnus agent is unreachable.'}</p> : null}
        {installation.reachable && !installation.installed ? <p className="m-0 rounded-control border border-warning bg-warning-soft p-3 text-sm text-warning">Codex CLI was not detected on this node.</p> : null}
        {installation.reachable && installation.installed ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Fact label="Installed"><span className="font-mono">{installation.version ?? 'unknown'}</span></Fact>
              <Fact label="Current release"><span className="font-mono">{installation.latestVersion ?? 'unavailable'}</span></Fact>
              <Fact label="Update"><Badge tone={installation.updateAvailable ? 'warning' : !installation.updateSupported ? 'neutral' : installation.latestVersion ? 'success' : 'neutral'}>{!installation.updateSupported ? 'read only' : installation.updateAvailable ? 'available' : installation.latestVersion ? 'current' : 'unknown'}</Badge></Fact>
              <Fact label="Install manager">{installation.provenance}</Fact>
              <Fact label="Auth mode">{auth.mode === 'chatgpt' ? 'ChatGPT OAuth' : (auth.mode ?? 'none')}</Fact>
              <Fact label="Access token"><Badge tone={auth.tokenExpired === false ? 'success' : auth.tokenExpired ? 'danger' : 'neutral'}>{auth.tokenExpired === false ? 'current' : auth.tokenExpired ? 'expired' : 'not present'}</Badge></Fact>
              <Fact label="Expires">{when(auth.tokenExpiresAt)}</Fact>
              <Fact label="Refresh credential"><Badge tone={auth.refreshTokenPresent ? 'success' : 'warning'}>{auth.refreshTokenPresent ? 'present' : 'missing'}</Badge></Fact>
              <Fact label="Plan">{auth.planType ?? 'not reported'}</Fact>
            </div>
            <div className={auth.oauth ? 'rounded-control border border-success bg-success-soft p-3 text-sm text-success' : 'rounded-control border border-warning bg-warning-soft p-3 text-sm text-warning'}>
              {auth.message}
              <span className="mt-1 block text-xs">API-key credentials are not used by this Magnus flow.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {canRequestUpdate(installation) ? <Button size="sm" disabled={busy !== null} loading={busy === 'update'} icon={<RefreshCw className="size-4" />} onClick={() => setConfirming('update')}>{installation.latestVersion ? 'Update Codex' : 'Check and update Codex'}</Button> : null}
              {!auth.oauth ? <Button size="sm" variant="primary" disabled={busy !== null || session?.status === 'pending'} loading={busy === 'device'} icon={<KeyRound className="size-4" />} onClick={() => void startDeviceLogin()}>Generate device code</Button> : null}
              {auth.oauth ? <Button size="sm" variant="danger" disabled={busy !== null} loading={busy === 'logout'} icon={<LogOut className="size-4" />} onClick={() => setConfirming('logout')}>Log out</Button> : null}
            </div>
          </>
        ) : null}
        {session ? (
          <div className="rounded-control border border-accent bg-accent-soft p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 flex items-center gap-2 text-sm font-semibold text-accent">{session.status === 'pending' ? <HaloDot tone="accent" /> : null}Device login</p>
              <Badge tone={session.status === 'completed' ? 'success' : session.status === 'pending' ? 'warning' : 'danger'}>{session.status}</Badge>
            </div>
            {session.status === 'pending' ? (
              <>
                <p className="m-0 mt-3 text-sm text-text-muted">Open the authorization page, sign in to ChatGPT, and enter this one-time code:</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <code className="glow-text-accent rounded-control border border-accent bg-surface-sunken px-4 py-2 font-mono text-lg font-bold text-accent">{session.userCode}<span className="fx-cursor" aria-hidden="true" /></code>
                  <Button size="sm" icon={copied ? <Check className="size-4" /> : <Clipboard className="size-4" />} onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy code'}</Button>
                  {verificationUrl ? <a className="btn btn--sm no-underline" href={verificationUrl} target="_blank" rel="noreferrer">Open OpenAI <ExternalLink className="size-4" /></a> : <span className="text-sm text-warning">The node gave no usable authorization page.</span>}
                </div>
                <p className="m-0 mt-2 text-xs text-text-muted">Expires {when(session.expiresAt)}. Continue only if you started this request here.</p>
                <Button className="mt-3" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancelDeviceLogin()}>Cancel</Button>
              </>
            ) : <p className="m-0 mt-3 text-sm text-text-muted">{session.error ?? (session.status === 'completed' ? 'ChatGPT OAuth authorization completed.' : 'Device authorization ended.')}</p>}
          </div>
        ) : null}
        <ActionConfirm
          open={!!confirming}
          title={confirming === 'logout' ? 'Log Codex out?' : 'Update Codex?'}
          message={confirming === 'logout' ? `Log Codex out on ${installation.nodeName}? What uses this login stops until someone signs in again.` : `Update Codex on ${installation.nodeName}? Work it is doing now may be interrupted.`}
          confirmLabel={confirming === 'logout' ? 'Log out' : 'Update'}
          onConfirm={() => { if (confirming) void run(confirming); }}
          onCancel={() => setConfirming(null)}
        />
        {error ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      </div>
    </FxPanel>
  );
}

/** The node's Codex login, shown on an Ardent profile whose backend is Codex. */
export function CodexNodePanel({ nodeId }: { nodeId: string }) {
  const resource = useMagnusResource((signal) => magnus.get(base(nodeId), codexInstallationResponseSchema, { signal }).then((response) => response.data), [nodeId]);
  if (!resource.data) return <div className="mt-3">{resource.loading ? <LoadingRows rows={2} /> : <ResourceError error={resource.error} title="The node's Codex status could not be read" onRetry={() => void resource.refresh()} />}</div>;
  return (
    <div className="mt-3 grid gap-2">
      <CodexInstallationCard installation={resource.data} onChange={resource.setData} />
      <p className="m-0 text-xs text-text-muted">The device flow uses node-local Codex. When browser OAuth is available on the node, its profile owner can use <code>codex login</code>; refresh this card to read the resulting account state. OAuth credentials stay with Codex.</p>
    </div>
  );
}
