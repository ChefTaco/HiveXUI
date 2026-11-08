// Follows a Magnus Ardent agent operation (New Agent or Enable HiveMem) over its event stream, and
// shows its steps as a checklist with each step's receipt.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, MinusCircle, XCircle } from 'lucide-react';
import { ardentAgentOperationSchema } from '@contracts/magnus/browser';
import { Badge, type Tone } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage, MagnusApiError } from '../../../../api/errors';
import { openStream, type StreamHandle } from '../../../../api/stream';
import { agentOperationStreamPath, readAgentOperation } from '../api';
import { checklistSteps, DEPLOY_STEPS, HIVEMEM_STEPS, receiptSummary, stepLabel, stepState, type AgentOperation, type StepState } from './new-agent-logic';

/** What the operator reads when Magnus refuses to start or resume an operation. */
export function agentOperationError(caught: unknown, nodeName: string | undefined, fallback: string): string {
  if (caught instanceof MagnusApiError && caught.code === 'AGENT_UPGRADE_REQUIRED')
    return `Upgrade the Magnus agent on ${nodeName ?? 'this node'} first: it predates the Ardent bridge that creates agents and enrolls them in HiveMem.`;
  return errorMessage(caught, fallback);
}

export interface AgentOperationView {
  operation: AgentOperation | null;
  /** Connection trouble the operator should know about. Empty while the stream is healthy. */
  note: string;
  /** Follow this operation, replacing any other. */
  follow: (operationId: string) => void;
}

/** The latest state of one operation: `operation` on connect and on every change, `done` at the end. */
export function useAgentOperation(): AgentOperationView {
  const [operation, setOperation] = useState<AgentOperation | null>(null);
  const [note, setNote] = useState('');
  const handle = useRef<StreamHandle | null>(null);
  const follow = useCallback((operationId: string) => {
    handle.current?.close();
    setNote('');
    let finished = false;
    const stream = openStream({
      path: agentOperationStreamPath(operationId),
      onEvent: ({ event, data }) => {
        if (event !== 'operation' && event !== 'done') return;
        let parsed: ReturnType<typeof ardentAgentOperationSchema.safeParse>;
        try {
          parsed = ardentAgentOperationSchema.safeParse(JSON.parse(data));
        } catch {
          return;
        }
        if (!parsed.success || parsed.data.id !== operationId) return;
        setOperation(parsed.data);
        if (event === 'done' || parsed.data.status !== 'running') {
          finished = true;
          stream.close();
        }
      },
      onState: (state, detail) => {
        if (state === 'open') setNote('');
        if (state === 'retrying') setNote('Reconnecting to the operation…');
        if (state !== 'stopped' || finished) return;
        if (handle.current === stream) handle.current = null;
        if (!detail) return;
        setNote(detail);
        // The stream is gone for good (forbidden, missing or signed out): show the last recorded state.
        readAgentOperation(operationId).then(setOperation, () => undefined);
      },
    });
    handle.current = stream;
  }, []);
  useEffect(() => () => handle.current?.close(), []);
  return { operation, note, follow };
}

const STATE_TONE: Record<StepState, Tone> = { pending: 'neutral', running: 'info', done: 'success', skipped: 'neutral', failed: 'danger' };
const STATE_LABEL: Record<StepState, string> = { pending: 'Pending', running: 'Running', done: 'Done', skipped: 'Skipped', failed: 'Failed' };

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <span className="spinner" aria-hidden="true" />;
  if (state === 'done') return <CheckCircle2 className="size-4 text-success" aria-hidden="true" />;
  if (state === 'failed') return <XCircle className="size-4 text-danger" aria-hidden="true" />;
  if (state === 'skipped') return <MinusCircle className="size-4 text-text-muted" aria-hidden="true" />;
  return <Circle className="size-4 text-text-muted" aria-hidden="true" />;
}

/** The operation's steps in order, each with its state and what it did. */
export function OperationChecklist({ operation, kind, className }: { operation: AgentOperation | null; kind: AgentOperation['kind']; className?: string }) {
  return (
    <ol className={cn('agent-op-steps', className)} aria-label="Operation steps">
      {checklistSteps(operation, kind === 'deploy' ? DEPLOY_STEPS : HIVEMEM_STEPS).map((step) => {
        const state = stepState(step.status);
        const summary = receiptSummary(step);
        return (
          <li key={step.name} className={cn('agent-op-step', state === 'running' && 'agent-op-step--running')} data-step={step.name} data-state={state}>
            <span className="agent-op-step__icon"><StepIcon state={state} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{stepLabel(step.name, kind)}</span>
              {summary ? <span className={cn('block break-words text-xs', state === 'failed' ? 'text-danger' : 'text-text-muted')}>{summary}</span> : null}
            </span>
            <Badge tone={STATE_TONE[state]} dot>{STATE_LABEL[state]}</Badge>
          </li>
        );
      })}
    </ol>
  );
}
