import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Activity, AlertTriangle, CheckCircle2, Clock, Download, Loader2, Power, RefreshCw, Shield, Terminal, XCircle } from 'lucide-react';
import { quickCommandResponseSchema } from '@contracts/magnus/browser';
import { Button, Drawer } from '@ui';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { FxPanel, PageItem } from '../../../effects';
import type { Ask } from './ask';

interface QuickCommand {
  id: string;
  label: string;
  command: string;
  args: string[];
  icon: ReactNode;
  variant: 'default' | 'danger' | 'primary';
  confirm?: { title: string; message: string; label: string };
  timeoutSeconds: number;
}
const QUICK_COMMANDS: readonly QuickCommand[] = [
  { id: 'apt-update', label: 'apt update', command: 'sudo', args: ['apt', 'update'], icon: <Download className="size-4" />, variant: 'default', timeoutSeconds: 120 },
  { id: 'apt-upgrade', label: 'apt upgrade', command: 'sudo', args: ['apt', 'upgrade', '-y'], icon: <RefreshCw className="size-4" />, variant: 'default', confirm: { title: 'Run apt upgrade', message: 'This will upgrade all packages on the node. Continue?', label: 'Upgrade packages' }, timeoutSeconds: 300 },
  { id: 'magnus-status', label: 'magnus status', command: 'systemctl', args: ['status', 'magnus-agent', '--no-pager'], icon: <Activity className="size-4" />, variant: 'primary', timeoutSeconds: 15 },
  { id: 'magnus-update', label: 'magnus update', command: 'sudo', args: ['systemctl', 'restart', 'magnus-agent'], icon: <Shield className="size-4" />, variant: 'default', confirm: { title: 'Restart the Magnus agent', message: 'This will restart the Magnus agent. Continue?', label: 'Restart agent' }, timeoutSeconds: 30 },
  { id: 'dmesg', label: 'dmesg', command: 'sudo', args: ['dmesg', '--time-format=reltime', '-T'], icon: <AlertTriangle className="size-4" />, variant: 'default', timeoutSeconds: 15 },
  { id: 'reboot', label: 'Reboot', command: 'sudo', args: ['reboot'], icon: <Power className="size-4" />, variant: 'danger', confirm: { title: 'Reboot this node', message: 'Are you sure you want to REBOOT this node? It will go offline temporarily.', label: 'Reboot' }, timeoutSeconds: 10 },
];

type CommandResult = z.output<typeof quickCommandResponseSchema>['data'];

/** Fixed commands with their output. A free command line is the terminal, which comes later through its own gateway. */
export function QuickCommandBar({ nodeId, nodeStatus, ask }: { nodeId: string; nodeStatus: string; ask: Ask }) {
  const [active, setActive] = useState<QuickCommand | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = nodeStatus !== 'ONLINE';

  async function run(command: QuickCommand) {
    setActive(command);
    setResult(null);
    setError(null);
    setRunning(true);
    setOpen(true);
    try {
      const answer = await magnus.post(`/quick-command/${segment(nodeId)}/exec`, quickCommandResponseSchema, {
        body: { command: command.command, args: command.args, timeoutSeconds: command.timeoutSeconds },
        timeoutMs: (command.timeoutSeconds + 10) * 1000,
      });
      setResult(answer.data);
    } catch (caught) {
      setError(errorMessage(caught, 'Command execution failed'));
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <PageItem>
        <FxPanel padding="sm" aria-label="Quick commands">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 flex items-center gap-2 text-sm font-semibold text-text-muted"><Terminal aria-hidden="true" className="size-4" />Quick commands</span>
            {QUICK_COMMANDS.map((command) => (
              <Button
                key={command.id}
                variant={command.variant}
                size="sm"
                icon={command.icon}
                disabled={disabled}
                onClick={() => (command.confirm ? ask({ ...command.confirm, action: () => void run(command) }) : void run(command))}
              >
                {command.label}
              </Button>
            ))}
            {disabled ? <span className="text-sm text-text-muted">Node must be ONLINE to run commands</span> : null}
          </div>
        </FxPanel>
      </PageItem>
      <Drawer open={open} title={active?.label ?? 'Command'} {...(active ? { eyebrow: `${active.command} ${active.args.join(' ')}` } : {})} onClose={() => setOpen(false)}>
        <div className="grid gap-4">
          <div role="status" className="flex items-center gap-2 text-sm">
            {running ? (
              <><Loader2 aria-hidden="true" className="size-4 animate-spin text-accent" /><span className="text-accent">Executing on the node…</span></>
            ) : error ? (
              <><XCircle aria-hidden="true" className="size-4 text-danger" /><span className="text-danger">Error</span></>
            ) : result ? (
              <>
                {result.exitCode === 0 ? <CheckCircle2 aria-hidden="true" className="size-4 text-success" /> : <XCircle aria-hidden="true" className="size-4 text-danger" />}
                <span className={result.exitCode === 0 ? 'text-success' : 'text-danger'}>Exit code: {result.exitCode}</span>
                <span className="num ml-auto flex items-center gap-1 text-text-muted"><Clock aria-hidden="true" className="size-3" />{(result.durationMs / 1000).toFixed(2)}s</span>
              </>
            ) : null}
          </div>
          {error ? <p className="m-0 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
          {result ? (
            <>
              {result.stdout ? <Output label="stdout" text={result.stdout} className="max-h-80 text-success" /> : null}
              {result.stderr ? <Output label="stderr" text={result.stderr} className="max-h-40 border-danger text-danger" /> : null}
              {!result.stdout && !result.stderr ? <p className="m-0 text-sm text-text-muted">No output captured</p> : null}
              {result.truncated ? <p className="m-0 text-sm text-warning">Output was truncated (exceeded 1MB)</p> : null}
            </>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}

function Output({ label, text, className }: { label: string; text: string; className: string }) {
  return (
    <div>
      <p className="m-0 mb-1 text-xs font-semibold text-text-muted">{label}</p>
      <pre className={`m-0 overflow-auto rounded-control border border-border bg-surface-sunken p-3 font-mono text-sm whitespace-pre-wrap ${className}`}>{text}</pre>
    </div>
  );
}
