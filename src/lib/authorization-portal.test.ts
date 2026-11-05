import { describe, expect, it } from 'vitest';
import { authorizationRedirect, parsePortalAuthorization, validatePortalAuthorization } from './authorization-portal';
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
  for(const value of [query()+'&client_id=hivexui-other',query()+'&%73tate=another',query()+'&prompt=none',query()+'&scope=%FF',query()+'&scope=%',query({client_id:'native-client'}),query({state:'short'}),query({nonce:'short'}),query({code_challenge_method:'plain'}),query({code_challenge:'short'}),query({response_type:'token'}),query({scope:'profile'}),query({scope:'openid\nprofile'})])expect(()=>parsePortalAuthorization(value)).toThrow();
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
});
