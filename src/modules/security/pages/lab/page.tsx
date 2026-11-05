import type { LabStatus } from '@security/contracts/index';
import { notFound } from '@security/navigation';
import { FusionHeader } from '@security/components/security-fusion/fusion-ui';
import { LabHome } from '@security/components/security-fusion/lab-home';
import { fusionFetch } from '@security/lib/security-fusion';
export const dynamic = 'force-dynamic';
export default async function LabPage() {
  const data = await fusionFetch<LabStatus>('lab');
  if (!data?.enabled) notFound();
  return <div className="page-stack"><FusionHeader eyebrow="Investigation practice" title="Evolving evidence lab" copy="A disposable case. A record of what you knew at each decision." /><LabHome canAdmin={data.canAdmin} runs={data.runs} /></div>;
}
