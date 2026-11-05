import { apiFetch } from '../../../lib/transport';
import { securityBrowserRoute,securityBrowserResponseSchema } from '../../../../contracts/cindertrace/browser';
export async function securityRequest(path:string,init:RequestInit={}) {
  securityBrowserRoute(path,init.method??'GET');
  return apiFetch('/api/security/'+path,init);
}
export async function securityCall<T>(path:string,init:RequestInit={}):Promise<T> {
  const method=init.method??'GET',route=securityBrowserRoute(path,method);
  if(route.request && typeof init.body==='string') {
    const parsed=route.request.safeParse(JSON.parse(init.body));
    if(!parsed.success)throw new Error('Security request does not match the product contract');
  }
  const response=await securityRequest(path,init);
  if(!response.ok) {
    if(method!=='GET') {
      const payload:unknown=await response.json().catch(()=>null);
      if(payload && typeof payload==='object' && 'error' in payload) {
        const error=payload.error;
        if(typeof error==='string')throw new Error(error);
        if(error && typeof error==='object' && 'message' in error && typeof error.message==='string')throw new Error(error.message);
      }
    }
    throw new Error(response.status===403?'Your account cannot access this security record':'Security request could not be completed');
  }
  const parsed=securityBrowserResponseSchema(path,method).safeParse(await response.json());
  if(!parsed.success)throw new Error('Security returned an unsupported response; check the product release before retrying.');
  return parsed.data as T;
}
export const securityFetch=<T,>(path:string):Promise<T>=>securityCall<T>(path);
export async function securityPost(path:string,body?:unknown):Promise<Record<string,unknown>> {
  const payload=await securityCall<{data:Record<string,unknown>}>(path,{method:'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});return payload.data;
}
