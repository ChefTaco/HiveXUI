import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAuth } from './browser-auth';
import { parsePortalAuthorization } from './authorization-portal';
import { subscribeIdentityPrompts } from './identity-prompts';
vi.stubGlobal('location',{origin:'https://console.example.com'});
const state='s'.repeat(43),nonce='n'.repeat(43);
const request=()=>parsePortalAuthorization('?'+new URLSearchParams({client_id:'hivexui-security-console',redirect_uri:'https://security.example.com/callback',response_type:'code',state,nonce,code_challenge:'c'.repeat(43),code_challenge_method:'S256',scope:'openid profile email'}));
const response=()=>Response.json({code:'obviously-fake-authorization-code',state,iss:'https://identity.example.com'});
const config={issuer:'https://identity.example.com',apiPrefix:'/api/identity',clients:{}};
let unsubscribe:(()=>void)|undefined;
afterEach(()=>{unsubscribe?.();unsubscribe=undefined;});
describe('external relying-party authorization',()=>{
 it('deduplicates requests and redirect capabilities without external client token exchange',async()=>{
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>response());const auth=createBrowserAuth(config,send);
  const first=auth.approveAuthorization(request()),second=auth.approveAuthorization(request());expect(second).toBe(first);
  const approval=await first;const navigate=vi.fn();approval.redirect(navigate);(await second).redirect(navigate);
  expect(navigate).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toBe('/api/identity/oauth/authorize');
  expect(send.mock.calls[0]?.[1]).toMatchObject({method:'POST',credentials:'include',redirect:'error',headers:{'X-Oathweave-Browser':'true'}});
  const body=JSON.parse(String(send.mock.calls[0]?.[1]?.body));expect(body).toMatchObject({clientId:'hivexui-security-console',codeChallenge:'c'.repeat(43),state,nonce});expect(body).not.toHaveProperty('codeVerifier');expect(body).not.toHaveProperty('clientSecret');
 });
 it('requires explicit consent, binds the original request and shares one prompt',async()=>{
  let prompts=0;unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent'){prompts++;prompt.resolve(true);}});
  const send=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>JSON.parse(String(init?.body)).consent==='approve'?response():Response.json({error:'CONSENT_REQUIRED',clientName:'Security console',clientDescription:null,audience:'cindertrace',scope:'openid profile email',permissions:['security:read']},{status:403}));
  const auth=createBrowserAuth(config,send);await Promise.all([auth.approveAuthorization(request()),auth.approveAuthorization(request())]);expect(prompts).toBe(1);expect(send).toHaveBeenCalledTimes(2);
  const first=JSON.parse(String(send.mock.calls[0]?.[1]?.body));const second=JSON.parse(String(send.mock.calls[1]?.[1]?.body));expect(second).toEqual({...first,consent:'approve'});
 });
 it('keeps declined and authorization failures local without retrying or redirecting',async()=>{
  unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent')prompt.resolve(false);});
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'CONSENT_REQUIRED',clientName:'Security',clientDescription:null,audience:'cindertrace',scope:'openid',permissions:[]},{status:403}));const auth=createBrowserAuth(config,send);
  await expect(auth.approveAuthorization(request())).rejects.toThrow('not approved');await expect(auth.approveAuthorization(request())).rejects.toThrow('not approved');expect(send).toHaveBeenCalledTimes(1);
 });
 it('rejects state, issuer, malformed codes and unregistered client failures before navigation',async()=>{
  for(const override of [{state:'wrong'},{iss:'https://attacker.example.com'},{code:'x'.repeat(2049)}]){
   const auth=createBrowserAuth(config,vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({code:'fake-code',state,iss:config.issuer,...override})));await expect(auth.approveAuthorization(request())).rejects.toThrow();
  }
  const denied=createBrowserAuth(config,vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'INVALID_CLIENT',message:'Client is not registered'},{status:400})));await expect(denied.approveAuthorization(request())).rejects.toThrow('not registered');
 });
 it('invalidates both pending and already-resolved redirects even if logout fails',async()=>{
  let finish:((value:Response)=>void)|undefined;
  const send=vi.fn<typeof fetch>().mockImplementation(input=>String(input).endsWith('/browser/logout')?Promise.reject(new Error('Network unavailable')):new Promise(resolve=>{finish=resolve;}));
  const auth=createBrowserAuth(config,send);const pending=auth.approveAuthorization(request());const observed=expect(pending).rejects.toThrow('session ended');await expect(auth.logout()).rejects.toThrow('Network unavailable');finish!(response());await observed;
  const success=createBrowserAuth(config,vi.fn<typeof fetch>().mockImplementation(async()=>response()));const approved=await success.approveAuthorization(request());success.invalidate();const navigate=vi.fn();expect(()=>approved.redirect(navigate)).toThrow('session ended');expect(navigate).not.toHaveBeenCalled();
 });
 it('validates malformed envelopes without making any request',()=>{const send=vi.fn<typeof fetch>();const auth=createBrowserAuth(config,send);expect(()=>auth.approveAuthorization({...request(),codeChallengeMethod:'plain' as 'S256'})).toThrow();expect(send).not.toHaveBeenCalled();});
});
