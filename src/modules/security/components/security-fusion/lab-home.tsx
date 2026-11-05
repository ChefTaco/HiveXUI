import { securityPost } from '@security/lib/security-api';
'use client';
import type { LabStatus } from '@security/contracts/index';
import { useState } from 'react';
import Link from '@security/navigation';
import { useRouter } from '@security/navigation';
import { Panel } from '@ui';

export async function labPost(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
  return securityPost('security-fusion/'+path,body);
}
export const labButton = 'btn btn--primary';
export function LabHome({canAdmin, runs}: Pick<LabStatus, 'canAdmin' | 'runs'>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = runs.find(x => x.status === 'active');
  async function start() {
    setBusy(true);
    try { const run = await labPost('lab/runs'); router.push(`/security-fusion/cases/${run.caseId}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start lab'); setBusy(false); }
  }
  return <div className="page-stack">
    <Panel eyebrow="One case · three evidence releases" title="What would change your mind?">
      <p className="max-w-2xl">Investigate an application login finding. Save what you believe, cite what supports it, then reveal the next evidence. At the end, compare your assertions and containment choices across revisions.</p>
      <p className="warning-banner">Synthetic evidence only. Containment decisions are simulated and require human approval.</p>
      {active ? <Link className={labButton} href={`/security-fusion/cases/${active.caseId}`}>Resume stage {active.stage}</Link> : canAdmin ? <button className={labButton} disabled={busy} onClick={() => void start()}>Start investigation</button> : <p>An administrator can start a disposable investigation.</p>}
      {message && <p role="alert" className="error-banner">{message}</p>}
    </Panel>
    {runs.length > 0 && <section className="grid gap-3"><h3 className="section-title">Run history</h3><ul className="stack-list">{runs.map((run, i) => <li key={run.id}><Link className="stack-item stack-item--button text-sm" href={`/security-fusion/cases/${run.caseId}`}><span>Investigation {runs.length - i}</span><span>{run.status} · stage {run.stage}/3</span></Link></li>)}</ul></section>}
  </div>;
}
