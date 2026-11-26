import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAuth, LoginRequired } from './browser-auth';
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
 it('sends a declined consent back to the application as access_denied',async()=>{
  unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent')prompt.resolve(false);});
  const redirectTo='https://security.example.com/callback?error=access_denied&error_description=declined&state='+state+'&iss='+encodeURIComponent(config.issuer);
  const send=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>JSON.parse(String(init?.body)).consent==='deny'
   ?Response.json({error:'access_denied',error_description:'declined',state,iss:config.issuer,redirectTo},{status:403})
   :Response.json({error:'CONSENT_REQUIRED',clientName:'Security',clientDescription:null,audience:'cindertrace',scope:'openid',permissions:[]},{status:403}));
  const auth=createBrowserAuth(config,send);const navigate=vi.fn();
  (await auth.approveAuthorization(request())).redirect(navigate);expect(navigate).toHaveBeenCalledWith(redirectTo);
  expect(send).toHaveBeenCalledTimes(2);expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toMatchObject({consent:'deny',state});
 });
 it('keeps a declined consent local when Oathweave does not return it to the application',async()=>{
  unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent')prompt.resolve(false);});
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'CONSENT_REQUIRED',clientName:'Security',clientDescription:null,audience:'cindertrace',scope:'openid',permissions:[]},{status:403}));const auth=createBrowserAuth(config,send);
  await expect(auth.approveAuthorization(request())).rejects.toThrow('not approved');await expect(auth.approveAuthorization(request())).rejects.toThrow('not approved');expect(send).toHaveBeenCalledTimes(2);
 });
 it('asks for a new sign-in with a login ticket, then repeats the same request with it',async()=>{
  const forced=parsePortalAuthorization('?'+new URLSearchParams({client_id:'hivexui-security-console',redirect_uri:'https://security.example.com/callback',response_type:'code',state,nonce,code_challenge:'c'.repeat(43),code_challenge_method:'S256',scope:'openid',prompt:'login',max_age:'0'}));
  const send=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>JSON.parse(String(init?.body)).loginTicket==='fixture-ticket'?response():Response.json({error:'LOGIN_REQUIRED',message:'Sign in again',reason:'prompt_login',loginTicket:'fixture-ticket',loginTicketExpiresIn:600},{status:401}));
  const auth=createBrowserAuth(config,send);
  const required=await auth.approveAuthorization(forced).catch((error:unknown)=>error);
  expect(required).toBeInstanceOf(LoginRequired);expect(required).toMatchObject({ticket:'fixture-ticket',reason:'prompt_login'});
  const navigate=vi.fn();(await auth.approveAuthorization({...forced,loginTicket:(required as LoginRequired).ticket})).redirect(navigate);
  expect(navigate.mock.calls[0]?.[0]).toMatch(/^https:\/\/security\.example\.com\/callback\?code=/);
  const bodies=send.mock.calls.map(call=>JSON.parse(String(call[1]?.body)) as Record<string,unknown>);
  expect(bodies[0]).toMatchObject({prompt:'login',maxAge:0});expect(bodies[1]).toEqual({...bodies[0],loginTicket:'fixture-ticket'});
 });
 it('returns prompt=none and cancelled sign-ins to the application',async()=>{
  const none=parsePortalAuthorization('?'+new URLSearchParams({client_id:'hivexui-security-console',redirect_uri:'https://security.example.com/callback',response_type:'code',state,nonce,code_challenge:'c'.repeat(43),code_challenge_method:'S256',scope:'openid',prompt:'none'}));
  const back=(error:string)=>'https://security.example.com/callback?error='+error+'&error_description=x&state='+state+'&iss='+encodeURIComponent(config.issuer);
  const send=vi.fn<typeof fetch>().mockImplementation(async input=>String(input).endsWith('/cancel')
   ?Response.json({error:'access_denied',error_description:'x',state,iss:config.issuer,redirectTo:back('access_denied')})
   :Response.json({error:'login_required',error_description:'x',state,iss:config.issuer,redirectTo:back('login_required')},{status:400}));
  const auth=createBrowserAuth(config,send);const navigate=vi.fn();
  (await auth.approveAuthorization(none)).redirect(navigate);expect(navigate).toHaveBeenCalledWith(back('login_required'));
  expect(await auth.cancelAuthorization(request())).toBe(back('access_denied'));
  const cancel=send.mock.calls.find(call=>String(call[0]).endsWith('/oauth/authorize/cancel'))!;
  expect(cancel[1]).toMatchObject({method:'POST',headers:{'X-Oathweave-Browser':'true'}});
  expect(JSON.parse(String(cancel[1]?.body))).toEqual({clientId:'hivexui-security-console',redirectUri:'https://security.example.com/callback',responseType:'code',state,nonce,codeChallenge:'c'.repeat(43),codeChallengeMethod:'S256',scope:'openid profile email'});
  // A redirect elsewhere is refused.
  send.mockImplementation(async()=>Response.json({error:'access_denied',error_description:'x',state,iss:config.issuer,redirectTo:'https://attacker.example.com/?error=access_denied&state='+state+'&iss='+config.issuer}));
  await expect(auth.cancelAuthorization(request())).rejects.toThrow();
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
