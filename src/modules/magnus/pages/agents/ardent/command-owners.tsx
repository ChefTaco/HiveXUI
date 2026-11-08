// The command owners that hold an Ardent node, and the ADMIN action that reconciles one whose outcome
// is unknown. Magnus runs one managed command per node at a time; while an owner is held no other
// Ardent action runs there, so a failed New Agent cannot resume either. A Magnus without command
// reconciliation reports no `commandOwners`, and nothing here renders.
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Badge, Button, Field, TextArea, type Tone } from '@ui';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { ADMIN_ONLY, RequireRole } from '../../../session';
import { ActionConfirm } from '../../../ui/action-confirm';
import { ardentAction, readInstallation } from './api';
import { ardentCommandReconcileResultSchema, type ArdentCommandOwner, type ArdentInstallation } from './schemas';

type Disposition = 'effects_verified' | 'no_effect_verified';
const DISPOSITIONS: Array<{ value: Disposition; label: string }> = [
  { value: 'effects_verified', label: 'It took effect, fully or partly' },
  { value: 'no_effect_verified', label: 'It changed nothing' },
];
const STATE: Record<ArdentCommandOwner['state'], { label: string; tone: Tone }> = {
  unknown: { label: 'Outcome unknown', tone: 'danger' },
  running: { label: 'Running', tone: 'info' },
  reserved: { label: 'Starting', tone: 'neutral' },
};
const when = (iso: string) => new Date(iso).toLocaleString();

/** What an owner was doing, as a person reads it. */
export function ownerTitle(owner: ArdentCommandOwner): string {
  if (owner.action) return `${owner.action} on ${owner.profile}`;
  return owner.ardent ? 'An Ardent action' : 'A node command';
}

/** The confirmation text: what reconciling does, and what it never does. */
export function reconcileMessage(owner: ArdentCommandOwner, nodeName: string, disposition: Disposition, configured: boolean): string {
  const choice = DISPOSITIONS.find((item) => item.value === disposition)!.label.toLowerCase();
  return [
    `Magnus asks the node agent on ${nodeName} what it recorded for ${ownerTitle(owner)} (command ${owner.commandId}).`,
    'A result it recorded, or a ledger that proves the request never ran, settles the command as that evidence. Only when the agent itself records the outcome as unknown does Magnus sign your decision ("' + choice + '", with your reason), and the node records it.',
    'The command is never run again, and the decision is audited under your name. Afterwards other Ardent actions on this node run again, and a stopped New Agent can be resumed.',
    ...(configured ? [] : ['This Magnus has no reconciliation key (COMMAND_RECONCILIATION_SECRET), so it can settle the command only from the node\'s own evidence.']),
  ].join('\n\n');
}

function Reconcile({ owner, installation, onSettled }: { owner: ArdentCommandOwner; installation: ArdentInstallation; onSettled: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const ready = Date.now() >= Date.parse(owner.reconcilableAfter);
  const complete = disposition !== '' && reason.trim().length >= 10 && reason.trim().length <= 500;
  async function reconcile() {
    if (disposition === '') return;
    setConfirming(false);
    setBusy(true);
    setProblem('');
    try {
      // The action is node-wide; the profile segment only satisfies the route.
      const routeProfile = owner.profile ?? installation.profiles[0]?.id ?? 'default';
      const result = await ardentAction(installation.nodeId, routeProfile, 'command-reconcile', ardentCommandReconcileResultSchema, {
        target: owner.commandId,
        body: { disposition, reason: reason.trim() },
      });
      setDone(result.outcome === 'already-settled' ? 'It was already settled.' : `Settled (${result.settlement ?? 'reconciled'}).`);
      await onSettled();
    } catch (caught) {
      setProblem(errorMessage(caught, 'The command could not be reconciled'));
    } finally {
      setBusy(false);
    }
  }
  if (done) return <p role="status" className="m-0 text-success">{done}</p>;
  return (
    <div className="grid gap-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={!ready} onClick={() => setOpen(true)}>Reconcile</Button>
          {!ready ? <span className="text-xs text-text-muted">Possible from {when(owner.reconcilableAfter)}: the command may still be running until then.</span> : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="m-0 text-text-muted">First check on the node what it did: the profile's service state and journal, its files, Ardent's own status. Then record what you found.</p>
          <fieldset className="grid gap-1 border-0 p-0">
            <legend className="mb-1 text-xs font-semibold">What did it do?</legend>
            {DISPOSITIONS.map((item) => (
              <label key={item.value} className="inline-flex items-center gap-2">
                <input type="radio" name={`disposition-${owner.commandId}`} value={item.value} checked={disposition === item.value} onChange={() => setDisposition(item.value)} />
                {item.label}
              </label>
            ))}
          </fieldset>
          <Field label="What you checked" hint="10 to 500 characters, kept in the audit.">
            <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} aria-label="What you checked" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!complete} onClick={() => setConfirming(true)}>Reconcile…</Button>
          </div>
        </div>
      )}
      {problem ? <p role="alert" className="m-0 break-words text-danger">{problem}</p> : null}
      <ActionConfirm
        open={confirming}
        tone="warning"
        title="Reconcile this command?"
        message={disposition === '' ? '' : reconcileMessage(owner, installation.nodeName, disposition, installation.commandReconciliation?.configured !== false)}
        confirmLabel="Reconcile"
        onConfirm={() => void reconcile()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function OwnerRow({ owner, installation, onSettled }: { owner: ArdentCommandOwner; installation: ArdentInstallation; onSettled: () => void | Promise<void> }) {
  const state = STATE[owner.state];
  return (
    <li className="grid gap-2 rounded-control border border-border bg-surface p-3" data-command={owner.commandId} data-state={owner.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{ownerTitle(owner)}</span>
        <Badge tone={state.tone} dot>{state.label}</Badge>
        <span className="break-all font-mono text-xs text-text-muted">{owner.commandId}</span>
      </div>
      <p className="m-0 text-xs text-text-muted">Started {when(owner.acquiredAt)} · deadline {when(owner.deadline)}</p>
      {owner.state !== 'unknown' ? (
        <p className="m-0 text-text-muted">Still running; Ardent actions on this node wait until it finishes.</p>
      ) : owner.ardent ? (
        <RequireRole roles={ADMIN_ONLY} fallback={<p className="m-0 text-text-muted">An ADMIN must reconcile it.</p>}>
          <Reconcile owner={owner} installation={installation} onSettled={onSettled} />
        </RequireRole>
      ) : (
        <p className="m-0 text-text-muted">This is not an Ardent action. Reconcile it from the command's receipt in Magnus (POST /commands/{owner.commandId}/reconcile-resource).</p>
      )}
    </li>
  );
}

/** The node's held command owners, each with what can be done about it. Nothing when none are held. */
export function CommandOwners({ installation, onSettled }: { installation: ArdentInstallation; onSettled: () => void | Promise<void> }) {
  const owners = installation.commandOwners;
  if (!owners?.length) return null;
  const unknown = owners.some((owner) => owner.state === 'unknown');
  return (
    <section className="grid gap-2 rounded-control border border-warning/50 bg-warning-soft p-3 text-sm" aria-label={`Unsettled commands on ${installation.nodeName}`}>
      <p className="m-0 flex items-center gap-2 font-semibold"><ShieldAlert className="size-4 text-warning" aria-hidden="true" />{unknown ? 'An Ardent command has an unknown outcome' : 'An Ardent command is running'}</p>
      <p className="m-0 text-text-muted">
        {unknown
          ? `Magnus could not confirm what this command did, so no other Ardent action runs on ${installation.nodeName} until an ADMIN reconciles it. Nothing is run again by reconciling.`
          : `Ardent actions on ${installation.nodeName} run one at a time.`}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {owners.map((owner) => <OwnerRow key={owner.commandId} owner={owner} installation={installation} onSettled={onSettled} />)}
      </ul>
    </section>
  );
}

/** The same, read for one node: for a stopped New Agent or Enable HiveMem operation. */
export function NodeCommandOwners({ nodeId }: { nodeId: string }) {
  const installation = useMagnusResource((signal) => readInstallation(nodeId, signal), [nodeId]);
  if (!installation.data) return null;
  return <CommandOwners installation={installation.data} onSettled={installation.refresh} />;
}
