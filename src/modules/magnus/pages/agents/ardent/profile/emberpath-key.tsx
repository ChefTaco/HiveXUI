// Set Emberpath key: set or rotate the Emberpath client key of an existing agent whose model is an
// Emberpath alias, for an agent created before New Agent delivered keys or one whose key was rotated in
// Emberpath. Magnus checks the key, writes it to the profile and restarts it. The key is held in this
// drawer's field only until it is sent, and never shown again.
import { useEffect, useRef, useState } from 'react';
import { KeyRound, RotateCcw } from 'lucide-react';
import { Button, Drawer } from '@ui';
import { MagnusApiError } from '../../../../api/errors';
import { resumeAgentOperation, setEmberpathKey } from '../api';
import { NodeCommandOwners } from '../command-owners';
import { agentOperationError, OperationChecklist, useAgentOperation } from '../profiles/agent-operation';
import { EmberpathKeyField } from '../profiles/emberpath-key-field';
import { emberpathKeyError, emberpathRefusal, stoppedAt } from '../profiles/new-agent-logic';
import type { ProfileRef } from './editors';

export function EmberpathKeyAction({ nodeId, profileId, nodeName, running, onSet }: ProfileRef & { nodeName?: string | undefined; running: boolean; onSet?: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState<string | undefined>();
  const [operationId, setOperationId] = useState<string | null>(null);
  // Resume answered EMBERPATH_KEY_REQUIRED: the key never reached the profile and the server no longer holds it.
  const [resumeNeedsKey, setResumeNeedsKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const { operation, note, follow } = useAgentOperation();
  const done = useRef(onSet);
  done.current = onSet;
  useEffect(() => {
    if (operation?.status === 'succeeded') done.current?.();
  }, [operation?.status]);
  const status = operation?.status;

  function close() {
    setOpen(false);
    setKey('');
    setKeyError(undefined);
    setProblem('');
    // A finished operation is not shown again; a running or failed one is, with its Resume.
    if (status === 'succeeded') { setOperationId(null); setResumeNeedsKey(false); }
  }

  /** Send the key (or, to resume without one, nothing): the field is cleared as soon as the request leaves. */
  async function send(run: (value: string | undefined) => Promise<string>, withKey: boolean) {
    const value = withKey ? key : undefined;
    if (withKey) {
      const error = emberpathKeyError(key);
      if (error) { setKeyError(error); return; }
    }
    setKey('');
    setKeyError(undefined);
    setBusy(true);
    setProblem('');
    try {
      const id = await run(value);
      setOperationId(id);
      setResumeNeedsKey(false);
      follow(id);
    } catch (caught) {
      const code = caught instanceof MagnusApiError ? caught.code : undefined;
      const refusal = emberpathRefusal(code);
      if (code === 'EMBERPATH_KEY_REQUIRED' && operationId) { setResumeNeedsKey(true); if (withKey) setKeyError(refusal?.message); }
      else if (refusal?.field) setKeyError(refusal.message);
      else setProblem(agentOperationError(caught, nodeName, 'The Emberpath key could not be set'));
    } finally {
      setBusy(false);
    }
  }

  const asking = !operationId || resumeNeedsKey;
  const footer = !operationId ? (
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button variant="primary" icon={<KeyRound className="size-4" />} loading={busy} disabled={!running} onClick={() => void send((value) => setEmberpathKey(nodeId, profileId, value!), true)}>Set key</Button>
    </>
  ) : status === 'failed' ? (
    <>
      <Button variant="ghost" onClick={close}>Close</Button>
      <Button variant="primary" icon={<RotateCcw className="size-4" />} loading={busy}
        onClick={() => void send((value) => resumeAgentOperation(operationId, value ? { emberpath_client_key: value } : undefined), resumeNeedsKey)}>
        {resumeNeedsKey ? 'Resume with key' : 'Resume'}
      </Button>
    </>
  ) : <Button variant={status === 'succeeded' ? 'primary' : 'ghost'} onClick={close}>{status === 'succeeded' ? 'Done' : 'Close'}</Button>;

  return (
    <>
      <Button size="sm" icon={<KeyRound className="size-4" />} onClick={() => setOpen(true)}>Set Emberpath key</Button>
      <Drawer open={open} onClose={close} eyebrow={`Ardent / ${profileId}`} title="Set Emberpath key" footer={footer}>
        <div className="grid gap-3">
          <p className="m-0 text-sm text-text-muted">
            Sets or replaces the client key this agent sends to Emberpath for its model alias. Magnus checks the key with Emberpath, writes it to the
            profile&apos;s environment on {nodeName ?? nodeId} and restarts the profile, so a task running now is interrupted.
          </p>
          {!running && !operationId ? <p className="m-0 text-sm text-warning">Start the profile first: Magnus checks the running agent before it sets the key.</p> : null}
          {asking ? (
            <>
              {resumeNeedsKey ? <p className="m-0 text-sm">The key has not reached the agent yet, and Magnus no longer holds the one you entered. Enter it again to resume.</p> : null}
              <EmberpathKeyField value={key} onChange={(value) => { setKey(value); setKeyError(undefined); }} error={keyError} profileId={profileId} />
            </>
          ) : null}
          {operationId ? <OperationChecklist operation={operation} kind="model-credential" /> : null}
          {note ? <p role="status" className="m-0 text-sm text-warning">{note}</p> : null}
          {status === 'failed' ? <p role="alert" className="m-0 break-words text-sm text-danger">{stoppedAt(operation)} Finished steps are kept; Resume continues from the step that failed.</p> : null}
          {status === 'failed' && operation ? <NodeCommandOwners key={operation.attempts} nodeId={operation.nodeId} /> : null}
          {status === 'succeeded' ? <p role="status" className="m-0 text-sm text-success">The agent restarted with its new Emberpath key.</p> : null}
          {problem ? <p role="alert" className="m-0 break-words text-sm text-danger">{problem}</p> : null}
        </div>
      </Drawer>
    </>
  );
}
