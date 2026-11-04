import { apiFetch } from '../../../lib/transport';
export async function securityRequest(path:string,init:RequestInit={}) {
  if(!/^security-fusion(?:\/|$)/.test(path) || /\.\.|\\/.test(path))throw new Error('Invalid security request');
  return apiFetch('/api/security/'+path,init);
}
export async function securityFetch<T>(path:string):Promise<T> {
  const response=await securityRequest(path);
  if(!response.ok)throw new Error(response.status===403?'Your account cannot access this security record':'Security information could not be loaded');
  return response.json() as Promise<T>;
}
