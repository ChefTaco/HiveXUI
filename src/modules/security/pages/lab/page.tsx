import type { LabStatus } from '@security/contracts/index';
import { SecurityPage, SecurityRecordUnavailable, useSecurityData } from '@security/lib/page-data';
import { FusionHeader } from '@security/components/security-fusion/fusion-ui';
import { LabHome } from '@security/components/security-fusion/lab-home';
import { fusionFetch } from '@security/lib/security-fusion';
export default function LabPage() {
  const loaded = useSecurityData(async () => {
    const data = await fusionFetch<LabStatus>('lab');
    if (!data?.enabled) throw new SecurityRecordUnavailable();
    return data;
  }, 'lab');
  return <SecurityPage data={loaded}>{(data) => <div className="page-stack"><FusionHeader eyebrow="Investigation practice" title="Evolving evidence lab" copy="A disposable case. A record of what you knew at each decision." /><LabHome canAdmin={data.canAdmin} runs={data.runs} /></div>}</SecurityPage>;
}
