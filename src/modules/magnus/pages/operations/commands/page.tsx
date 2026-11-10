import { useState } from 'react';
import { Play, ShieldCheck, TerminalSquare, Zap } from 'lucide-react';
import { commandDetailResponseSchema, commandDispatchedResponseSchema, commandDryRunResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, Field, PageHeader, statusTone, TextArea, TextInput } from '@ui';
import { cn } from '@lib/cn';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage, MagnusApiError } from '../../../api/errors';
import { FxPanel, PageItem } from '../../../effects';
import { ActionConfirm } from '../../../ui/action-confirm';
import { NodeMultiSelect } from './node-multi-select';
import { destructiveWarning, executeMessage, nodeCount, QUICK_ACTIONS, resultText } from './quick-actions';

type Dispatched = { id: string; nodeId: string; status: string };
type Preview = { id: string; name: string; status: string; stale: boolean; allowed: boolean };

const ACTION_CLASS = {
  default: '',
  warning: 'border-warning text-warning glow-hover--warning hover:bg-warning-soft',
  danger: 'border-danger text-danger glow-hover--danger hover:bg-danger-soft',
};

export default function CommandsPage() {
  const [command, setCommand] = useState('');
  const [timeout, setTimeoutSeconds] = useState('60');
  const timeoutSeconds = Number(timeout);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [results, setResults] = useState<Dispatched[]>([]);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  // What the operator is asked about is what runs, whatever else changes behind the dialog.
  const [confirming, setConfirming] = useState<{ command: string; nodeIds: string[]; timeoutSeconds: number } | null>(null);
  const ready = command.trim() !== '' && nodeIds.length > 0 && Number.isInteger(timeoutSeconds) && timeoutSeconds >= 1 && timeoutSeconds <= 3600;

  /** Every click is a new key, in the body and the header as before. A request is sent once and never repeated. */
  async function dispatch(target: { command: string; nodeIds: string[]; timeoutSeconds: number }) {
    setConfirming(null);
    setRunning(true);
    setOutput(null);
    try {
      const key = idempotencyKey();
      const { data } = await magnus.post('/commands', commandDispatchedResponseSchema, {
        body: { nodeIds: target.nodeIds, command: target.command, args: [], timeoutSeconds: target.timeoutSeconds, idempotencyKey: key },
        idempotencyKey: key,
      });
      setResults(data.commands);
      if (data.commands.length === 0) setOutput('No command was queued: none of the selected nodes is online.');
    } catch (error) {
      setOutput(errorMessage(error, 'Dispatch failed'));
    } finally {
      setRunning(false);
    }
  }

  async function dryRun() {
    if (!ready) return;
    setRunning(true);
    setPreview(null);
    setOutput(null);
    try {
      const key = idempotencyKey();
      const { data } = await magnus.post('/commands', commandDryRunResponseSchema, {
        body: { nodeIds, command, args: [], timeoutSeconds, idempotencyKey: key, dryRun: true },
        idempotencyKey: key,
      });
      setPreview(data.targets);
    } catch (error) {
      setOutput(errorMessage(error, 'Dry run failed'));
    } finally {
      setRunning(false);
    }
  }

  async function fetchResult(commandId: string) {
    try {
      const { data } = await magnus.get(`/commands/${segment(commandId)}`, commandDetailResponseSchema);
      setResults((current) => current.map((row) => row.id === data.id ? { ...row, status: data.status } : row));
      setOutput(data.result ? resultText(data.result) : `Result not yet available (${data.status})`);
    } catch (error) {
      setOutput(error instanceof MagnusApiError && error.notFound ? 'Result not yet available' : errorMessage(error));
    }
  }

  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="Command Dispatch" eyebrow="Operations" icon={<TerminalSquare className="size-5" />} description="Execute bash commands across your Magnus nodes" />
      </PageItem>
      <PageItem>
        <FxPanel title={<span className="flex items-center gap-2"><Zap className="size-4 text-accent" />Quick actions</span>} description="Common Ubuntu administration tasks. Click to fill in the command." interactive={false}>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                title={action.description}
                aria-pressed={command === action.command}
                onClick={() => setCommand(action.command)}
                className={cn('glow-hover inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-raised px-3 py-1.5 text-sm text-text-muted transition-colors duration-[var(--duration-base)] hover:border-accent hover:text-accent', ACTION_CLASS[action.variant ?? 'default'], command === action.command && 'glow-accent border-accent')}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </FxPanel>
      </PageItem>
      <PageItem>
        <FxPanel title="Dispatch command" interactive={false}>
          <div className="grid gap-4">
            <NodeMultiSelect label="Target nodes" value={nodeIds} onChange={setNodeIds} />
            <Field label="Command">
              <TextArea value={command} onChange={setCommand} placeholder="ls -la /opt/magnus" rows={3} className="font-mono transition-shadow duration-[var(--duration-base)] focus:shadow-[0_0_8px_var(--glow-accent)]" />
            </Field>
            <Field label="Timeout (seconds)" hint="A finite execution budget, from 1 to 3600 seconds.">
              <TextInput type="number" min={1} max={3600} step={1} value={timeout} onChange={setTimeoutSeconds} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button icon={<ShieldCheck className="size-4" />} loading={running} disabled={!ready} onClick={() => void dryRun()}>Dry run</Button>
              <Button variant="primary" icon={<Play className="size-4" />} loading={running} disabled={!ready} onClick={() => setConfirming({ command, nodeIds, timeoutSeconds })}>
                {running ? 'Dispatching…' : `Execute on ${nodeCount(nodeIds.length)}`}
              </Button>
            </div>
          </div>
        </FxPanel>
      </PageItem>
      {preview ? (
        <PageItem>
          <FxPanel title="Dry run preview" description="Targets marked stale are blocked by policy before dispatch" fxTone="info">
            <div className="grid gap-2 sm:grid-cols-2">
              {preview.map((target) => (
                <div key={target.id} className="scan-sweep flex items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{target.name}</div>
                    <div className="text-xs text-text-muted">{target.status}{target.stale ? ' · stale heartbeat' : ''}</div>
                  </div>
                  <Badge tone={target.allowed ? 'success' : 'warning'}>{target.allowed ? 'Allowed' : 'Blocked'}</Badge>
                </div>
              ))}
              {preview.length === 0 ? <p className="m-0 text-sm text-text-muted">None of the selected nodes exists any more.</p> : null}
            </div>
          </FxPanel>
        </PageItem>
      ) : null}
      {results.length > 0 ? (
        <PageItem>
          <FxPanel title="Dispatched commands" fxTone="success">
            <ul className="m-0 grid list-none gap-2 p-0">
              {results.map((result) => (
                <li key={result.id} className="scan-sweep flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-4 py-2 hover:border-accent">
                  <div className="min-w-0 text-sm">
                    <span className="font-mono text-accent" title={result.id}>{result.id.slice(0, 12)}…</span>
                    <span className="ml-3 font-mono text-text-muted" title={result.nodeId}>→ {result.nodeId.slice(0, 12)}…</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(result.status)}>{result.status}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => void fetchResult(result.id)}>View result</Button>
                  </div>
                </li>
              ))}
            </ul>
          </FxPanel>
        </PageItem>
      ) : null}
      {output ? (
        <PageItem>
          <FxPanel title="Output" interactive={false}>
            <pre className="code-block m-0" role="status">{output}</pre>
          </FxPanel>
        </PageItem>
      ) : null}
      <ActionConfirm
        open={!!confirming}
        title={confirming && destructiveWarning(confirming.command) ? 'Run a destructive command?' : 'Run this command?'}
        message={confirming ? executeMessage(confirming.command, confirming.nodeIds.length) + `\n\nTimeout: ${confirming.timeoutSeconds} seconds.` : ''}
        confirmLabel={confirming ? `Execute on ${nodeCount(confirming.nodeIds.length)}` : 'Execute'}
        onConfirm={() => { if (confirming) void dispatch(confirming); }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
