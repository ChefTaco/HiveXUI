import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBrowserAuth } from './browser-auth';
import { subscribeIdentityPrompts, type IdentityPrompt } from './identity-prompts';
import { clearAccess, configureEndpoint, createApiFetch, setAccessProvider, setStepUpProvider } from './transport';
vi.stubGlobal('crypto',webcrypto);
vi.stubGlobal('location',{origin:'https://console.example.com'});
let keys:Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async()=>{keys=await generateKeyPair('RS256')});
let unsubscribe:(()=>void)|undefined;
afterEach(()=>{unsubscribe?.();unsubscribe=undefined;clearAccess();setAccessProvider(undefined);setStepUpProvider(undefined)});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
async function fixture(options:{holdConsent?:boolean;holdToken?:boolean}={}){
 let verified=false,consentSent=false,tokenHeld=false,count=0;
 const consent=deferred<Response>(),token=deferred<Response>(),verification=deferred<Response>();
 const codes=new Map<string,{clientId:string;nonce:string}>();
 const send=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
  const path=String(input),body=JSON.parse(String(init?.body??'{}')) as Record<string,string>;
  if(path.endsWith('/oauth/jwks'))return Response.json({keys:[{...await exportJWK(keys.publicKey),kid:'fixture'}]});
  if(path.endsWith('/browser/logout'))return Response.json({ok:true});
  if(path.endsWith('/auth/step-up')){const response=await verification.promise;if(response.ok)verified=true;return response}
  if(path.endsWith('/oauth/authorize')){
   if(body.clientId==='hivexui-oathweave'&&body.consent!=='approve'){
    const response=Response.json({error:'CONSENT_REQUIRED',clientName:'Identity review',clientDescription:null,audience:'oathweave',scope:'openid profile',permissions:['iam:audit:read']},{status:403});
    if(options.holdConsent&&!consentSent){consentSent=true;return consent.promise}return response;
   }
   const code='fixture-code-'+(++count);codes.set(code,{clientId:body.clientId!,nonce:body.nonce!});return Response.json({code,state:body.state,iss:'https://identity.example.com'});
  }
  if(path.endsWith('/oauth/token')){
   const issued=codes.get(body.code!)!;const access='obviously-fake-'+issued.clientId+(verified?'-verified':'-original');
   const hash=createHash('sha256').update(access).digest().subarray(0,16).toString('base64url');
   const id=await new SignJWT({nonce:issued.nonce,at_hash:hash}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject('fixture-user').setIssuer('https://identity.example.com').setAudience(issued.clientId).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
   const response=Response.json({access_token:access,id_token:id,token_type:'Bearer',expires_in:300});
   if(options.holdToken&&issued.clientId==='hivexui-oathweave'&&!tokenHeld){tokenHeld=true;return token.promise.then(()=>response)}return response;
  }
  if(path.endsWith('/client-keys'))return new Headers(init?.headers).get('authorization')?.endsWith('-verified')?Response.json({keys:[]}):Response.json({error:'STEP_UP_REQUIRED'},{status:403});
  if(path.endsWith('/auth/me'))return Response.json({user:{id:'fixture-user',username:'admin',displayName:null,roles:[],permissions:[]}});
  throw Error('Unexpected fixture endpoint');
 });
 const auth=createBrowserAuth({issuer:'https://identity.example.com',apiPrefix:'/api/identity',clients:{emberpath:'hivexui-emberpath',oathweave:'hivexui-oathweave'}},send);
 configureEndpoint('emberpath','/api/emberpath');configureEndpoint('oathweave','/api/oathweave');setAccessProvider(auth.ensure);setStepUpProvider(auth.stepUp);
 return{auth,send,api:createApiFetch(send),consent,token,verification,consentResponse:()=>Response.json({error:'CONSENT_REQUIRED',clientName:'Identity review',clientDescription:null,audience:'oathweave',scope:'openid profile',permissions:['iam:audit:read']},{status:403})};
}
describe('same-session verification concurrency',()=>{
 it('preserves explicit unrelated consent while a sensitive read refreshes its credentials',async()=>{
  let prompt:IdentityPrompt|undefined;
  unsubscribe=subscribeIdentityPrompts(value=>{if(value?.kind==='step-up')value.resolve({password:'obviously-fake-password'});if(value?.kind==='consent')prompt=value});
  const run=await fixture({holdConsent:true});await run.auth.ensure('emberpath');
  const identityRead=run.api('/api/iam/auth/me');await vi.waitFor(()=>expect(run.send.mock.calls.some(call=>String(call[1]?.body).includes('hivexui-oathweave'))).toBe(true));
  const keyRead=run.api('/api/client-keys');await vi.waitFor(()=>expect(run.send.mock.calls.some(call=>String(call[0]).endsWith('/auth/step-up'))).toBe(true));
  run.consent.resolve(run.consentResponse());await vi.waitFor(()=>expect(prompt?.kind).toBe('consent'));
  const held=prompt!;run.verification.resolve(Response.json({success:true}));expect((await keyRead).status).toBe(200);
  expect(prompt).toBe(held);expect(prompt?.kind).toBe('consent');if(prompt?.kind==='consent')prompt.resolve(true);
  expect((await identityRead).status).toBe(200);
  const keys=run.send.mock.calls.filter(call=>String(call[0]).endsWith('/client-keys'));expect(keys).toHaveLength(2);
  const identity=run.send.mock.calls.find(call=>String(call[0]).endsWith('/auth/me'))!;expect(new Headers(identity[1]?.headers).get('authorization')).toBe('Bearer obviously-fake-hivexui-oathweave-verified');
 });
 it('discards a token exchange that crosses verification and authorizes again without repeating a product operation',async()=>{
  unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent')prompt.resolve(true);if(prompt?.kind==='step-up')prompt.resolve({password:'obviously-fake-password'})});
  const run=await fixture({holdToken:true});const read=run.api('/api/iam/auth/me');
  await vi.waitFor(()=>expect(run.send.mock.calls.filter(call=>String(call[0]).endsWith('/oauth/token'))).toHaveLength(1));
  const verification=run.auth.stepUp();await vi.waitFor(()=>expect(run.send.mock.calls.some(call=>String(call[0]).endsWith('/auth/step-up'))).toBe(true));run.verification.resolve(Response.json({success:true}));await verification;
  run.token.resolve(Response.json({}));expect((await read).status).toBe(200);
  expect(run.send.mock.calls.filter(call=>String(call[0]).endsWith('/oauth/token'))).toHaveLength(2);
  const reads=run.send.mock.calls.filter(call=>String(call[0]).endsWith('/auth/me'));expect(reads).toHaveLength(1);expect(new Headers(reads[0]?.[1]?.headers).get('authorization')).toBe('Bearer obviously-fake-hivexui-oathweave-verified');
 });
 it('keeps unrelated reads authorized after verification cancellation but never authorizes a declined resource',async()=>{
  unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='consent')prompt.resolve(false);if(prompt?.kind==='step-up')prompt.resolve(null)});
  const run=await fixture();await expect(run.auth.stepUp()).rejects.toThrow('cancelled');await expect(run.auth.ensure('oathweave')).rejects.toThrow('not approved');
  await expect(run.auth.ensure('oathweave')).rejects.toThrow('declined');expect(run.send.mock.calls.filter(call=>String(call[0]).endsWith('/oauth/token'))).toHaveLength(0);
 });
 it('logout cancels pending consent and prevents token/read resurrection after late network completion',async()=>{
  let prompt:IdentityPrompt|undefined;unsubscribe=subscribeIdentityPrompts(value=>{if(value?.kind==='consent')prompt=value});
  const run=await fixture({holdConsent:true});const read=run.api('/api/iam/auth/me');const rejected=expect(read).rejects.toThrow('session ended');
  await vi.waitFor(()=>expect(run.send.mock.calls.some(call=>String(call[0]).endsWith('/oauth/authorize'))).toBe(true));run.consent.resolve(run.consentResponse());await vi.waitFor(()=>expect(prompt?.kind).toBe('consent'));
  await run.auth.logout();await rejected;
  expect(run.send.mock.calls.filter(call=>String(call[0]).endsWith('/oauth/token')||String(call[0]).endsWith('/auth/me'))).toHaveLength(0);
 });
});
