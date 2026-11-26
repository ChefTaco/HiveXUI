import {describe,it,expect,vi} from 'vitest';
import {createIamApi} from './iam-api';
import {EnrollmentRequestSchema,MfaSetupResponseSchema} from '../../contracts/oathweave-browser.generated';
describe('owned Oathweave browser contracts',()=>{
 it('validates user envelopes and removes server-only fields',async()=>{
  const user={id:'fixture-user',email:'alice@example.com',username:'alice',displayName:null,active:true,lastLoginAt:null,createdAt:'2026-01-01',roles:[],passwordHash:'obviously-fake-unexposed-hash'};
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({users:[user],total:1,page:1,limit:100}));
  expect((await createIamApi(send).iamUsers()).users[0]).not.toHaveProperty('passwordHash');
  send.mockImplementation(async()=>Response.json({users:[{...user,active:'yes'}],total:1,page:1,limit:100}));
  await expect(createIamApi(send).iamUsers()).rejects.toThrow();
 });
 it('rejects invalid public clients and request bounds before transport',()=>{
  const send=vi.fn<typeof fetch>();const api=createIamApi(send);
  expect(()=>api.createIamClient({name:'Fixture',clientType:'public',grantTypes:['client_credentials']})).toThrow();
  expect(()=>api.assignIamUserRoles('fixture',[])).toThrow();
  expect(()=>api.updateIamPasswordPolicy({minLength:1})).toThrow();
  expect(send).not.toHaveBeenCalled();
 });
 it('preserves native mutation compatibility and one-time keys without replay',async()=>{
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({client:{id:'fixture',name:'Fixture',clientId:'fixture',clientType:'public',firstParty:false,active:true,description:null,redirectUris:'[]',grantTypes:'["authorization_code"]'}}));
  const api=createIamApi(send);expect((await api.updateIamClient('fixture/id',{active:false})).client.grantTypes).toBe('["authorization_code"]');
  expect(send.mock.calls[0]?.[0]).toBe('/api/iam/clients/fixture%2Fid');
  send.mockImplementation(async()=>Response.json({apiKey:'obviously-fake-once',warning:'Store once'}));
  expect((await api.rotateIamServiceAccount('fixture')).apiKey).toBe('obviously-fake-once');
  send.mockImplementation(async()=>Response.json({error:'PERMISSION_DENIED',message:'Permission required'},{status:403}));
  await expect(api.iamRoles()).rejects.toThrow('Permission required');expect(send).toHaveBeenCalledTimes(3);
 });
 it('rejects unsafe authenticator QR responses using the owning validation',()=>{expect(MfaSetupResponseSchema.safeParse({secret:'obviously-fake',qrDataUrl:'https://untrusted.example.com/qr'}).success).toBe(false)});
 it('retains product enrollment refinements instead of reconstructing JSON schemas',()=>{
  const body={agentId:'fixture-agent',displayName:'Fixture',iamClientId:'fixture-client',scopes:['memories:read']};
  expect(EnrollmentRequestSchema.safeParse(body).success).toBe(true);
  expect(EnrollmentRequestSchema.safeParse({...body,scopes:['admin:all']}).success).toBe(false);
 });
 it('pages and filters users and audit events in the query',async()=>{
  const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({users:[],total:0,page:2,limit:100}));
  const api=createIamApi(send);
  await api.iamUsers();
  await api.iamUsers({page:2,search:' ali ce '});
  send.mockImplementation(async()=>Response.json({events:[],total:0,page:3,limit:50}));
  await api.iamAudit({page:3});
  expect(send.mock.calls.map(call=>call[0])).toEqual(['/api/iam/users?limit=100','/api/iam/users?page=2&limit=100&search=ali+ce','/api/iam/audit?page=3&limit=50']);
 });
});
