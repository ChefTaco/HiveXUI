import { securityPost } from '@security/lib/security-api';
import type { LabStatus } from '@security/contracts/index';
import { useState } from 'react';
import { RouteLink } from '../../../../components/route-link';
import { linkTo, navigateTo } from '../../../../lib/routes';
import { buttonClass, Panel } from '@ui';

export async function labPost(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
  return securityPost('security-fusion/'+path,body);
}
export const labButton = buttonClass({ variant: 'primary' });
const caseLink = (caseId: unknown) => linkTo('cindertrace', 'case', { caseId: String(caseId) });
export function LabHome({canAdmin, runs}: Pick<LabStatus, 'canAdmin' | 'runs'>) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = runs.find(x => x.status === 'active');
  async function start() {
    setBusy(true);
    try { const run = await labPost('lab/runs'); navigateTo(caseLink(run.caseId)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start lab'); setBusy(false); }
  }
  return <div className="page-stack">
    <Panel eyebrow="One case · three evidence releases" title="What would change your mind?">
      <p className="max-w-2xl">Investigate an application login finding. Save what you believe, cite what supports it, then reveal the next evidence. At the end, compare your assertions and containment choices across revisions.</p>
      <p className="warning-banner">Synthetic evidence only. Containment decisions are simulated and require human approval.</p>
      {active ? <RouteLink className={labButton} href={caseLink(active.caseId)}>Resume stage {active.stage}</RouteLink> : canAdmin ? <button className={labButton} disabled={busy} onClick={() => void start()}>Start investigation</button> : <p>An administrator can start a disposable investigation.</p>}
      {message && <p role="alert" className="error-banner">{message}</p>}
    </Panel>
    {runs.length > 0 && <section className="grid gap-3"><h3 className="section-title">Run history</h3><ul className="stack-list">{runs.map((run, i) => <li key={run.id}><RouteLink className="stack-item stack-item--button text-sm" href={caseLink(run.caseId)}><span>Investigation {runs.length - i}</span><span>{run.status} · stage {run.stage}/3</span></RouteLink></li>)}</ul></section>}
  </div>;
}
