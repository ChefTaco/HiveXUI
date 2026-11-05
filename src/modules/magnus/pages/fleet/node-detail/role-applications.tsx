import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { roleApplicationListResponseSchema } from '@contracts/magnus/browser';
import { Badge, type Tone } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { FxPanel } from '../../../effects';
import { parseRoleSteps, type RoleStep } from './node-data';

type RoleApplication = z.output<typeof roleApplicationListResponseSchema>['data'][number];

const APP_TONE: Record<string, Tone> = { completed: 'success', failed: 'danger', running: 'info' };
const STEP: Record<RoleStep['status'], { mark: string; className: string }> = {
  completed: { mark: '✓', className: 'text-success' },
  failed: { mark: '✗', className: 'text-danger' },
  running: { mark: '⟳', className: 'text-info' },
  skipped: { mark: '—', className: 'text-text-muted' },
  pending: { mark: '○', className: 'text-text-muted' },
};

export function RoleApplicationsCard({ applications }: { applications: readonly RoleApplication[] }) {
  if (applications.length === 0) return null;
  return (
    <FxPanel title="Role applications">
      <div className="grid gap-4">
        {applications.map((application) => (
          <div key={`${application.id}-${application.status}`} className="scan-sweep min-w-0 rounded-control border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-accent" />
                <span className="text-sm font-medium break-words">{application.action === 'apply' ? 'Apply' : 'Remove'}: {application.role.name}</span>
              </div>
              <Badge tone={APP_TONE[application.status] ?? 'neutral'}>{application.status}</Badge>
            </div>
            {application.error ? <p className="m-0 mb-2 rounded-control border border-danger bg-danger-soft px-2 py-1 font-mono text-xs break-words text-danger">{application.error}</p> : null}
            <div className="grid gap-1">
              {parseRoleSteps(application.steps).map((step) => (
                <div key={step.name} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span aria-hidden="true" className={STEP[step.status].className}>{STEP[step.status].mark}</span>
                  <span className={cn('min-w-0 break-words', step.status === 'skipped' && 'text-text-muted line-through')}>{step.name}</span>
                  <span className="sr-only">{step.status}</span>
                  {step.error ? <span className="ml-2 min-w-0 truncate text-danger" title={step.error}>{step.error}</span> : null}
                </div>
              ))}
            </div>
            <p className="num m-0 mt-2 text-xs text-text-muted">
              {application.startedAt ? `Started: ${formatTime(application.startedAt)}` : ''}
              {application.completedAt ? ` — Completed: ${formatTime(application.completedAt)}` : ''}
            </p>
          </div>
        ))}
      </div>
    </FxPanel>
  );
}
