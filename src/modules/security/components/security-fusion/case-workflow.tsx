import { securityPost } from '@security/lib/security-api';
'use client';
import {useState} from 'react';
import {Panel} from '@ui';
import {useRouter} from '@security/navigation';
export function CaseWorkflow({caseId,eventId,preserveOnly=false}:{caseId:string;eventId?:string|undefined;preserveOnly?:boolean}) {
 const router=useRouter();const [summary,setSummary]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function send(path:string,body?:unknown){
  setBusy(true);setMessage('');
  try {
   await securityPost(`security-fusion/cases/${encodeURIComponent(caseId)}/${path}`,body);
   setMessage(body?'Investigation draft saved.':'Evidence preserved and hashed.');if(body)setSummary('');router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:'Request failed');}finally{setBusy(false);}
 }
 return <Panel title={preserveOnly ? "Evidence preservation" : "Investigation draft"}>
  {!preserveOnly && <label className="field">Findings and next checks
  <textarea id="investigation-summary" value={summary} onChange={e=>setSummary(e.target.value)} maxLength={4000} rows={4} /></label>}
  <div className="inline-actions">
   {!preserveOnly && <button disabled={busy||!summary.trim()} onClick={()=>send('investigations',{summary:summary.trim(),hypotheses:[],prioritizedChecks:[],proposedActions:[],evidenceSteps:[]})} className="btn btn--primary">Save draft</button>}
   {eventId&&<button disabled={busy} onClick={()=>send(`evidence/${encodeURIComponent(eventId)}/preserve`)} className="btn">Preserve latest case evidence</button>}
  </div>
  {message&&<p role="status" className="text-sm text-text-muted">{message}</p>}
 </Panel>;
}
