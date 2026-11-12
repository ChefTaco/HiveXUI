import { securityPost } from '@security/lib/security-api';
import {useState} from 'react';
import { Panel, Button } from '@ui';
import { useSecurityRefresh } from '@security/lib/page-data';
export function CaseWorkflow({caseId,eventId,preserveOnly=false}:{caseId:string;eventId?:string|undefined;preserveOnly?:boolean}) {
 const refresh=useSecurityRefresh();const [summary,setSummary]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function send(path:string,body?:unknown){
  setBusy(true);setMessage('');
  try {
   await securityPost(`security-fusion/cases/${encodeURIComponent(caseId)}/${path}`,body);
   setMessage(body?'Investigation draft saved.':'Evidence preserved and hashed.');if(body)setSummary('');refresh();
  }catch(error){setMessage(error instanceof Error?error.message:'Request failed');}finally{setBusy(false);}
 }
 return <Panel title={preserveOnly ? "Evidence preservation" : "Investigation draft"}>
  {!preserveOnly && <label className="field">Findings and next checks
  <textarea id="investigation-summary" value={summary} onChange={e=>setSummary(e.target.value)} maxLength={4000} rows={4} /></label>}
  <div className="inline-actions">
   {!preserveOnly && <Button disabled={busy||!summary.trim()} onClick={()=>send('investigations',{summary:summary.trim(),hypotheses:[],prioritizedChecks:[],proposedActions:[],evidenceSteps:[]})} variant="primary">Save draft</Button>}
   {eventId&&<Button disabled={busy} onClick={()=>send(`evidence/${encodeURIComponent(eventId)}/preserve`)}>Preserve latest case evidence</Button>}
  </div>
  {message&&<p role="status" className="text-sm text-text-muted">{message}</p>}
 </Panel>;
}
