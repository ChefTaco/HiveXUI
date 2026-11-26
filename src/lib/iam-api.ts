import {z} from 'zod';
import * as owner from '../../contracts/oathweave-browser.generated';
import {apiFetch} from './transport';
import {apiFailureFromBody, failureMeta, HiveApiError, parseAnswer, readJsonAnswer, type ApiFailure} from './api-error';
const identityFailure=(failure:ApiFailure):Error=>new HiveApiError(failure.status,failure.message,{...failureMeta(failure),code:failure.code});
export function createIamApi(send:typeof apiFetch=apiFetch,fail:(failure:ApiFailure)=>Error=identityFailure) {
  async function call<T>(path:string,schema:z.ZodType<T>,method='GET',body?:object):Promise<T>{
    const response=await send('/api/iam/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    if(!response.ok){
      const value:unknown=await response.json().catch(()=>null);
      // A bare code ({error:"CODE"}) was shown as the message before, so it still is.
      const failure=apiFailureFromBody(response.status,value,{fallback:'Identity request failed',response});
      throw fail({...failure,message:failure.remoteMessage??failure.code??failure.message});
    }
    const value=await readJsonAnswer(response,'Oathweave',method!=='GET');
    return parseAnswer(schema,value,'Oathweave',method!=='GET');
  }
  const id=(value:string)=>encodeURIComponent(value);
  const listQuery=(query:{page?:number;limit?:number;search?:string})=>{
    const params=new URLSearchParams();
    if(query.page&&query.page>1)params.set('page',String(Math.floor(query.page)));
    if(query.limit)params.set('limit',String(Math.floor(query.limit)));
    const search=query.search?.trim();
    if(search)params.set('search',search.slice(0,200));
    return params.toString();
  };
  return {
    iamHealth:()=>call('health',owner.IamHealthResponseSchema),
    /** One page of users (Oathweave caps a page at 100), optionally matching a username, email or display name. */
    iamUsers:(query:{page?:number;limit?:number;search?:string}={})=>call('users?'+listQuery({limit:100,...query}),owner.IamUsersResponseSchema),
    createIamUser:(body:owner.CreateIamUserRequest)=>call('users',owner.IamUserMutationResponseSchema,'POST',owner.CreateIamUserRequestSchema.parse(body)),
    updateIamUser:(key:string,body:owner.UpdateIamUserRequest)=>call('users/'+id(key),owner.IamUserMutationResponseSchema,'PATCH',owner.UpdateIamUserRequestSchema.parse(body)),
    deleteIamUser:(key:string)=>call('users/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    assignIamUserRoles:(key:string,roleIds:string[])=>call('users/'+id(key)+'/roles',owner.IamSuccessResponseSchema,'POST',owner.IamAssignRolesRequestSchema.parse({roleIds})),
    removeIamUserRole:(key:string,role:string)=>call('users/'+id(key)+'/roles/'+id(role),owner.IamSuccessResponseSchema,'DELETE'),
    lockIamUser:(key:string)=>call('users/'+id(key)+'/lock',owner.IamSuccessResponseSchema,'POST'),
    unlockIamUser:(key:string)=>call('users/'+id(key)+'/unlock',owner.IamSuccessResponseSchema,'POST'),
    rotateIamUserPassword:(key:string,password:string)=>call('users/'+id(key)+'/rotate-password',owner.IamSuccessResponseSchema,'POST',owner.IamRotatePasswordRequestSchema.parse({password})),
    iamRoles:()=>call('roles',owner.IamRolesResponseSchema),
    createIamRole:(body:owner.CreateIamRoleRequest)=>call('roles',owner.IamRoleResponseSchema,'POST',owner.CreateIamRoleRequestSchema.parse(body)),
    updateIamRole:(key:string,body:owner.UpdateIamRoleRequest)=>call('roles/'+id(key),owner.IamRoleResponseSchema,'PATCH',owner.UpdateIamRoleRequestSchema.parse(body)),
    deleteIamRole:(key:string)=>call('roles/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    iamServiceAccounts:()=>call('service-accounts',owner.IamServiceAccountsResponseSchema),
    createIamServiceAccount:(body:owner.CreateIamServiceAccountRequest)=>call('service-accounts',owner.IamCreatedServiceAccountResponseSchema,'POST',owner.CreateIamServiceAccountRequestSchema.parse(body)),
    updateIamServiceAccount:(key:string,body:owner.UpdateIamServiceAccountRequest)=>call('service-accounts/'+id(key),owner.IamServiceAccountMutationResponseSchema,'PATCH',owner.UpdateIamServiceAccountRequestSchema.parse(body)),
    deleteIamServiceAccount:(key:string)=>call('service-accounts/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    rotateIamServiceAccount:(key:string)=>call('service-accounts/'+id(key)+'/rotate',owner.IamRotatedServiceAccountResponseSchema,'POST'),
    iamClients:()=>call('clients',owner.IamClientsResponseSchema),
    createIamClient:(body:owner.CreateIamClientRequest)=>call('clients',owner.IamClientMutationResponseSchema,'POST',owner.CreateIamClientRequestSchema.parse(body)),
    updateIamClient:(key:string,body:owner.UpdateIamClientRequest)=>call('clients/'+id(key),owner.IamClientMutationResponseSchema,'PATCH',owner.UpdateIamClientRequestSchema.parse(body)),
    deleteIamClient:(key:string)=>call('clients/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    iamSystemUsers:()=>call('system-users',owner.IamSystemUsersResponseSchema),
    createIamSystemUser:(body:owner.CreateIamSystemUserRequest)=>call('system-users',owner.IamSystemUserResponseSchema,'POST',owner.CreateIamSystemUserRequestSchema.parse(body)),
    updateIamSystemUser:(key:string,body:owner.UpdateIamSystemUserRequest)=>call('system-users/'+id(key),owner.IamSystemUserResponseSchema,'PATCH',owner.UpdateIamSystemUserRequestSchema.parse(body)),
    deleteIamSystemUser:(key:string)=>call('system-users/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    iamSessions:()=>call('sessions',owner.IamSessionsResponseSchema),
    revokeIamSession:(key:string)=>call('sessions/'+id(key),owner.IamSuccessResponseSchema,'DELETE'),
    /** One page of audit events, newest first (Oathweave caps a page at 200). */
    iamAudit:(query:{page?:number;limit?:number}={})=>call('audit?'+listQuery({limit:50,...query}),owner.IamAuditResponseSchema),
    iamAuditStats:()=>call('audit/stats',owner.IamAuditStatsSchema),
    iamPasswordPolicy:()=>call('password-policy',owner.IamPasswordPolicyResponseSchema),
    updateIamPasswordPolicy:(body:owner.UpdateIamPasswordPolicyRequest)=>call('password-policy',owner.IamPasswordPolicyResponseSchema,'PATCH',owner.UpdateIamPasswordPolicyRequestSchema.parse(body)),
  };
}
