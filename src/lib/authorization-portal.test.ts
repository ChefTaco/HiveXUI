import { describe, expect, it } from 'vitest';
import { authorizationErrorRedirect, authorizationRedirect, parsePortalAuthorization, requiresFreshSignIn, validatePortalAuthorization } from './authorization-portal';
export const parameters = {
  client_id:'hivexui-security-console',redirect_uri:'https://security.example.com/api/auth/callback',
  response_type:'code',state:'s'.repeat(43),nonce:'n'.repeat(43),
  code_challenge:'c'.repeat(43),code_challenge_method:'S256',scope:'openid profile email',
};
const query = (override:Partial<typeof parameters>={}) => '?'+new URLSearchParams({...parameters,...override});
describe('authorization portal protocol boundary',()=>{
 it('maps standard OAuth query fields to the owning request contract without a verifier',()=>{
  const request=parsePortalAuthorization(query());
  expect(request).toEqual({clientId:parameters.client_id,redirectUri:parameters.redirect_uri,responseType:'code',state:parameters.state,nonce:parameters.nonce,codeChallenge:parameters.code_challenge,codeChallengeMethod:'S256',scope:'openid profile email'});
  expect(Object.isFrozen(request)).toBe(true);expect(request).not.toHaveProperty('codeVerifier');
 });
 it('rejects duplicate, unknown, downgraded, unbound and malformed requests locally',()=>{
  for(const value of [query()+'&client_id=hivexui-other',query()+'&%73tate=another',query()+'&prompt=bogus',query()+'&max_age=soon',query()+'&max_age=-1',query()+'&max_age=1.5',query()+'&login_ticket=forged',query()+'&loginTicket=forged',query()+'&prompt=login&prompt=none',query()+'&scope=%FF',query()+'&scope=%',query({client_id:'native-client'}),query({state:'short'}),query({nonce:'short'}),query({code_challenge_method:'plain'}),query({code_challenge:'short'}),query({response_type:'token'}),query({scope:'profile'}),query({scope:'openid\nprofile'})])expect(()=>parsePortalAuthorization(value)).toThrow();
  expect(()=>validatePortalAuthorization({...parsePortalAuthorization(query()),consent:'approve'})).toThrow();
 });
 it('rejects unsafe or ambiguous callbacks instead of redirecting errors to them',()=>{
  for(const redirect_uri of ['http://security.example.com/callback','javascript:alert(1)','https://user:password@security.example.com/callback','https://security.example.com/callback#','https://security.example.com/callback?%63ode=old','https://security.example.com/callback?state=old','https://security.example.com/callback?iss=old','https://security.example.com/callback?context=one&context=two','https://security.example.com/\\callback'])expect(()=>parsePortalAuthorization(query({redirect_uri}))).toThrow();
 });
 it('requires matching state and configured issuer and appends only a bounded code',()=>{
  const request=parsePortalAuthorization(query({redirect_uri:'https://security.example.com/callback?context=hello%20world'}));
  const response={code:'c'.repeat(43),state:parameters.state,iss:'https://identity.example.com'};
  const target=authorizationRedirect(request,response,response.iss);
  expect(target.startsWith(request.redirectUri+'&code=')).toBe(true);
  expect(new URL(target).searchParams.get('state')).toBe(parameters.state);expect(new URL(target).searchParams.get('iss')).toBe(response.iss);
  for(const change of [{state:'wrong'},{iss:'https://attacker.example.com'},{code:'c'.repeat(2049)},{code:'bad\ncode'}])expect(()=>authorizationRedirect(request,{...response,...change},response.iss)).toThrow();
 });
 it('accepts OpenID Connect prompt and max_age, and knows when a new sign-in is required',()=>{
  expect(parsePortalAuthorization(query()+'&prompt=login&max_age=0')).toMatchObject({prompt:'login',maxAge:0});
  expect(parsePortalAuthorization(query()+'&max_age=300').maxAge).toBe(300);
  expect(requiresFreshSignIn(parsePortalAuthorization(query()))).toBe(false);
  expect(requiresFreshSignIn(parsePortalAuthorization(query()+'&prompt=none'))).toBe(false);
  expect(requiresFreshSignIn(parsePortalAuthorization(query()+'&prompt=consent'))).toBe(false);
  for(const extra of ['&prompt=login','&prompt=select_account','&prompt=consent%20login','&max_age=0','&max_age=600'])expect(requiresFreshSignIn(parsePortalAuthorization(query()+extra))).toBe(true);
  // The login ticket is the portal's own continuation, never taken from the address.
  expect(validatePortalAuthorization({...parsePortalAuthorization(query()),loginTicket:'fixture-ticket'})).toHaveProperty('loginTicket','fixture-ticket');
 });
 it('returns OAuth errors only to the exact callback, with its state and the configured issuer',()=>{
  const request=parsePortalAuthorization(query({redirect_uri:'https://security.example.com/callback?context=one'}));
  const iss='https://identity.example.com';
  const redirectTo=request.redirectUri+'&error=access_denied&error_description=cancelled&state='+parameters.state+'&iss='+encodeURIComponent(iss);
  const answer={error:'access_denied',error_description:'cancelled',state:parameters.state,iss,redirectTo};
  expect(authorizationErrorRedirect(request,answer,iss)).toBe(redirectTo);
  for(const change of [{state:'other'},{iss:'https://attacker.example.com'},{redirectTo:'https://attacker.example.com/callback?error=access_denied&state='+parameters.state+'&iss='+iss},
   {redirectTo:'https://security.example.com/other?context=one&error=access_denied&state='+parameters.state+'&iss='+iss},{redirectTo:redirectTo.replace('error=access_denied','error=login_required')},
   {redirectTo:redirectTo.replace('state='+parameters.state,'state=other')},{error:'server_error'}])
   expect(()=>authorizationErrorRedirect(request,{...answer,...change},iss)).toThrow();
 });
});
