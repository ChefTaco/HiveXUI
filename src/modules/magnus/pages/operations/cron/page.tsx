import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ChevronDown, ChevronRight, Clock, RefreshCw, Search, Server, Terminal, Upload, XCircle } from 'lucide-react';
import { cronScanResponseSchema, libraryFileResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, Drawer, EmptyState, Field, PageHeader, TextInput } from '@ui';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus } from '../../../api/client';
import { agentDisabledMessage, errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem, ScanPanel } from '../../../effects';
import { FormError } from '../shared/parts';
import { describeSchedule, initiallyExpanded, jobMatches, publishBody, type ScannedJob } from './cron-model';

type PublishTarget = { job: ScannedJob; nodeName: string };

export default function CronPage() {
  const toast = useToast();
  // A read of the live crontabs, though it is a POST. It runs on arrival and on Rescan only.
  const scan = useMagnusResource((signal) => magnus.post('/scan/cron', cronScanResponseSchema, { signal }));
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const results = scan.data?.data;
  useEffect(() => {
    if (results) setExpanded(initiallyExpanded(results));
  }, [results]);
  const scanning = scan.loading || scan.refreshing;
  const scanned = results !== undefined && !scanning;
  const failed = !scanning && !!scan.error;
  const list = results ?? [];
  const totalJobs = list.reduce((sum, result) => sum + result.jobs.length, 0);
  const nodesScanned = list.filter((result) => result.status === 'done').length;
  const nodesErrored = list.filter((result) => result.status === 'error').length;
  const toggle = (nodeId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  function openPublish(job: ScannedJob, nodeName: string) {
    setPublishTarget({ job, nodeName });
    setVersion('1.0.0');
    setDescription('');
    setPublishError('');
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!publishTarget || !version) return;
    setPublishing(true);
    setPublishError('');
    try {
      await magnus.post('/library/files', libraryFileResponseSchema, { body: publishBody(publishTarget.job, version, description) });
      toast.success(`${publishTarget.job.name} published`, `Version ${version} is in the library.`);
      setPublishTarget(null);
    } catch (error) {
      setPublishError(errorMessage(error, 'The job could not be published'));
    } finally {
      setPublishing(false);
    }
  }
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Cron Jobs"
          eyebrow="Operations"
          icon={<Clock className="size-5" />}
          description="Discover and manage scheduled jobs across your fleet"
          status={scanned && !failed ? <span className="num text-xs text-text-muted">{list.length} node{list.length === 1 ? '' : 's'} · {totalJobs} job{totalJobs === 1 ? '' : 's'}{nodesErrored > 0 ? ` · ${nodesErrored} error${nodesErrored === 1 ? '' : 's'}` : ''}</span> : undefined}
          actions={<Button size="sm" icon={<RefreshCw className={cn('size-4', scanning && 'animate-spin')} />} disabled={scanning} onClick={() => void scan.refresh()}>{scanning ? 'Scanning…' : 'Rescan'}</Button>}
        />
      </PageItem>
      {scanning ? (
        <PageItem>
          <ScanPanel title="Scanning nodes for cron jobs" description="Probing all online nodes…" scanning nodes={list.map((result) => ({ nodeId: result.nodeId, nodeName: result.nodeName, status: 'scanning' as const }))} />
        </PageItem>
      ) : null}
      {scanned && !failed && totalJobs > 0 ? (
        <PageItem>
          <label className="relative block">
            <span className="sr-only">Search jobs</span>
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <TextInput className="w-full pl-9" placeholder="Search jobs by name, command or schedule…" value={query} onChange={setQuery} />
          </label>
        </PageItem>
      ) : null}
      {failed ? (
        <PageItem>
          <FxPanel fxTone="danger" interactive={false}>
            <EmptyState
              tone="danger"
              icon={<AlertTriangle className="size-5" />}
              title="Scan failed"
              message={errorMessage(scan.error)}
              action={<Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void scan.refresh()}>Retry scan</Button>}
            />
          </FxPanel>
        </PageItem>
      ) : null}
      {scanned && !failed ? (
        list.length === 0 ? (
          <PageItem>
            <FxPanel interactive={false}>
              <EmptyState icon={<Server className="size-5" />} title="No online nodes to scan" message="Ensure at least one node agent is running and connected." />
            </FxPanel>
          </PageItem>
        ) : (
          <>
            {list.map((result) => {
              const open = expanded.has(result.nodeId);
              const jobs = result.jobs.filter((job) => jobMatches(job, query));
              const disabled = result.status === 'error' ? agentDisabledMessage(result.error) : null;
              return (
                <PageItem key={result.nodeId}>
                  <FxPanel padding="none" fxTone={result.status === 'error' && !disabled ? 'danger' : 'accent'} className="overflow-hidden">
                    <button type="button" aria-expanded={open} onClick={() => toggle(result.nodeId)} className="flex w-full cursor-pointer items-center gap-4 p-4 text-left transition-colors duration-[var(--duration-base)] hover:bg-surface-hover">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent bg-accent-soft"><Server aria-hidden="true" className="size-4 text-accent" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{result.nodeName}</span>
                          {result.status === 'done' ? <Badge tone={result.jobs.length > 0 ? 'success' : 'neutral'}>{result.jobs.length} job{result.jobs.length === 1 ? '' : 's'}</Badge> : disabled ? <Badge>Disabled</Badge> : <Badge tone="danger">Error</Badge>}
                        </span>
                        {result.status === 'error' ? <span className={cn('mt-0.5 block truncate text-sm', disabled ? 'text-text-muted' : 'text-danger')}>{disabled ?? result.error}</span> : null}
                        {result.status === 'done' && result.jobs.length === 0 ? <span className="mt-0.5 block text-sm text-text-muted">No cron jobs found on this node</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {result.status === 'done' ? <CheckCircle2 aria-hidden="true" className="size-4 text-success" /> : <XCircle aria-hidden="true" className="size-4 text-danger" />}
                        {open ? <ChevronDown aria-hidden="true" className="size-4 text-text-muted" /> : <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />}
                      </span>
                    </button>
                    {open && result.status === 'done' ? (
                      <div className="border-t border-border bg-surface-sunken">
                        {jobs.length === 0 ? (
                          <p className="m-0 p-6 text-center text-sm text-text-muted">{result.jobs.length === 0 ? 'No cron jobs found on this node.' : 'No jobs match your search on this node.'}</p>
                        ) : (
                          <ul className="m-0 list-none divide-y divide-border p-0">
                            {jobs.map((job, index) => (
                              <li key={`${job.name}-${index}`} className="fx-rail grid gap-3 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <Clock aria-hidden="true" className="size-4 text-accent" />
                                    <span className="text-sm font-semibold">{job.name}</span>
                                    {job.user ? <Badge>{job.user}</Badge> : null}
                                    <Badge tone="info"><span className="font-mono">{job.schedule}</span></Badge>
                                  </div>
                                  <Button size="sm" icon={<Upload className="size-4" />} onClick={() => openPublish(job, result.nodeName)}>Publish</Button>
                                </div>
                                <p className="m-0 flex items-center gap-1 text-sm text-text-muted"><Calendar aria-hidden="true" className="size-4" />{describeSchedule(job.schedule)}</p>
                                <div className="flex items-start gap-2 rounded-control border border-border bg-surface p-3">
                                  <Terminal aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                                  <pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">{job.command}</pre>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </FxPanel>
                </PageItem>
              );
            })}
            <PageItem>
              <div className="num flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                <span>{nodesScanned} node{nodesScanned === 1 ? '' : 's'} scanned · {totalJobs} job{totalJobs === 1 ? '' : 's'} discovered</span>
                {nodesErrored > 0 ? <span className="text-danger">{nodesErrored} node{nodesErrored === 1 ? '' : 's'} unreachable</span> : null}
              </div>
            </PageItem>
          </>
        )
      ) : null}
      <Drawer open={!!publishTarget} title="Publish to Library" {...(publishTarget ? { eyebrow: publishTarget.job.name } : {})} onClose={() => setPublishTarget(null)}>
        <form className="grid gap-4" onSubmit={(event) => void publish(event)}>
          <Field label="Version"><TextInput value={version} onChange={setVersion} placeholder="1.0.0" required /></Field>
          <Field label="Description"><TextInput value={description} onChange={setDescription} placeholder="What does this cron job do?" /></Field>
          {publishTarget ? (
            <dl className="m-0 grid gap-1 rounded-control border border-border bg-surface-sunken p-3 text-sm">
              <div><dt className="inline text-text-muted">Source: </dt><dd className="inline">{publishTarget.nodeName}</dd></div>
              <div><dt className="inline text-text-muted">Schedule: </dt><dd className="inline font-mono">{publishTarget.job.schedule}</dd></div>
              <div><dt className="inline text-text-muted">Command: </dt><dd className="inline break-all font-mono text-accent">{publishTarget.job.command}</dd></div>
            </dl>
          ) : null}
          <FormError message={publishError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPublishTarget(null)}>Cancel</Button>
            <Button type="submit" variant="primary" icon={<Upload className="size-4" />} loading={publishing} disabled={!version}>Publish</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
