// Enable HiveMem: the backfill for a profile created before New Agent. Magnus enrolls the profile's
// HiveMem identity, stores its credential on the node, configures memory and restarts the profile.
import { useEffect, useRef, useState } from 'react';
import { Brain, RotateCcw } from 'lucide-react';
import { Button } from '@ui';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel } from '../../../../effects';
import { ActionConfirm } from '../../../../ui/action-confirm';
import { enableHiveMem, readResource, resumeAgentOperation } from '../api';
import { memoryStatusSchema } from '../schemas';
import { NodeCommandOwners } from '../command-owners';
import { agentOperationError, OperationChecklist, useAgentOperation } from '../profiles/agent-operation';
import { stoppedAt } from '../profiles/new-agent-logic';
import type { ProfileRef } from './editors';

/**
 * Shown only while the profile has no HiveMem identity (memory.provider is none), or while an
 * enablement runs. A read that fails shows nothing: the Skills tab reports memory problems.
 */
export function HiveMemEnable({ nodeId, profileId, nodeName, running, onEnabled }: ProfileRef & { nodeName?: string | undefined; running: boolean; onEnabled?: () => void }) {
  const memory = useMagnusResource((signal) => readResource(nodeId, profileId, 'memory/status', memoryStatusSchema, signal), [nodeId, profileId]);
  const { operation, note, follow } = useAgentOperation();
  const [operationId, setOperationId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const enabled = useRef(onEnabled);
  enabled.current = onEnabled;
  useEffect(() => {
    if (operation?.status === 'succeeded') enabled.current?.();
  }, [operation?.status]);
  const missing = memory.data !== undefined && memory.data.agent_id === '';
  if (!missing && !operationId) return null;

  async function start(run: () => Promise<string>) {
    setConfirming(false);
    setBusy(true);
    setProblem('');
    try {
      const id = await run();
      setOperationId(id);
      follow(id);
    } catch (caught) {
      setProblem(agentOperationError(caught, nodeName, 'HiveMem could not be enabled'));
    } finally {
      setBusy(false);
    }
  }
  const status = operation?.status;
  return (
    <FxPanel
      tone={status === 'succeeded' ? undefined : 'warning'}
      fxTone={status === 'succeeded' ? 'success' : 'warning'}
      title={status === 'succeeded' ? 'HiveMem enabled' : 'HiveMem is not enabled'}
      description={status === 'succeeded' ? 'This profile now keeps private memory in HiveMem.' : 'This profile keeps no long-term memory. Ardent Studio and every new agent rely on HiveMem.'}
      actions={!operationId ? (
        <Button variant="primary" size="sm" icon={<Brain className="size-4" />} loading={busy} disabled={!running} onClick={() => setConfirming(true)}>Enable HiveMem</Button>
      ) : status === 'failed' ? (
        <Button variant="primary" size="sm" icon={<RotateCcw className="size-4" />} loading={busy} onClick={() => void start(() => resumeAgentOperation(operationId))}>Resume</Button>
      ) : undefined}
      interactive={false}
    >
      {!running && !operationId ? <p className="m-0 text-sm text-text-muted">Start the profile first: enrollment checks the running agent.</p> : null}
      {operationId ? <OperationChecklist operation={operation} kind="hivemem" /> : null}
      {note ? <p role="status" className="m-0 mt-3 text-sm text-warning">{note}</p> : null}
      {status === 'failed' ? <p role="alert" className="m-0 mt-3 break-words text-sm text-danger">{stoppedAt(operation)} Finished steps are kept; Resume continues from the step that failed.</p> : null}
      {status === 'failed' && operation ? <div className="mt-3"><NodeCommandOwners key={operation.attempts} nodeId={operation.nodeId} /></div> : null}
      {status === 'succeeded' ? <p role="status" className="m-0 mt-3 text-sm text-success">HiveMem is enabled and the profile answered with memory ready.</p> : null}
      {problem ? <p role="alert" className="m-0 mt-3 break-words text-sm text-danger">{problem}</p> : null}
      <ActionConfirm
        open={confirming}
        title="Enable HiveMem?"
        message={`Magnus enrolls a HiveMem identity for ${profileId}, stores its credential on the node, sets memory in the profile's configuration and restarts the profile. A task running now is interrupted by the restart.`}
        confirmLabel="Enable HiveMem"
        onConfirm={() => void start(() => enableHiveMem(nodeId, profileId))}
        onCancel={() => setConfirming(false)}
      />
    </FxPanel>
  );
}
