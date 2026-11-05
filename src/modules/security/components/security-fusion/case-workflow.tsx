import { securityPost } from '@security/lib/security-api';
'use client';
import {useState} from 'react';
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
 return <section className="mt-6 space-y-3 border border-border/60 p-4">
  <h2 className="font-mono text-xs uppercase tracking-widest text-primary">{preserveOnly ? "Evidence preservation" : "Investigation draft"}</h2>
  {!preserveOnly && <><label className="block text-xs text-text-muted" htmlFor="investigation-summary">Findings and next checks</label>
  <textarea id="investigation-summary" value={summary} onChange={e=>setSummary(e.target.value)} maxLength={4000} rows={4} className="w-full border border-border bg-bg p-2 text-sm text-text" /></>}
  <div className="flex flex-wrap gap-3">
   {!preserveOnly && <button disabled={busy||!summary.trim()} onClick={()=>send('investigations',{summary:summary.trim(),hypotheses:[],prioritizedChecks:[],proposedActions:[],evidenceSteps:[]})} className="border border-primary/40 bg-surface px-3 py-2 text-xs text-primary disabled:opacity-40">Save draft</button>}
   {eventId&&<button disabled={busy} onClick={()=>send(`evidence/${encodeURIComponent(eventId)}/preserve`)} className="border border-border bg-surface px-3 py-2 text-xs text-text disabled:opacity-40">Preserve latest case evidence</button>}
  </div>
  {message&&<p role="status" className="text-xs text-text-muted">{message}</p>}
 </section>;
}
