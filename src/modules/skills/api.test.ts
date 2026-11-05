import { describe, it, expect, vi } from 'vitest';
import { createSkillsApi } from './api';
describe('generated registry contract client', () => {
  it('uses the direct resource API and preserves immutable upload bytes', async () => {
    const release = {
      skillSlug: 'fixture',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
      archivePath: '/opt/private/archive.tgz',
    };
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(release));
    const result = await createSkillsApi(send).upload('fixture', {
      version: '1.0.0',
      archiveBase64: 'ZmFrZS1maXh0dXJl',
    });
    expect(send.mock.calls[0]?.[0]).toBe(
      '/api/skills/admin/skills/fixture/releases',
    );
    expect(send.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(
      JSON.parse(String(send.mock.calls[0]?.[1]?.body)).archiveBase64,
    ).toBe('ZmFrZS1maXh0dXJl');
    expect(result).not.toHaveProperty('archivePath');
  });
  it('rejects malformed response digests and propagates owner authorization failures', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          skillSlug: 'fixture',
          version: '1.0.0',
          sha256: 'invalid',
          notes: null,
          createdAt: '2026-01-01',
        },
      ]),
    );
    await expect(createSkillsApi(send).releases('fixture')).rejects.toThrow();
    send.mockResolvedValue(
      Response.json({ error: 'Permission required' }, { status: 403 }),
    );
    await expect(createSkillsApi(send).skills()).rejects.toThrow(
      'Permission required',
    );
  });
  it('keeps enrollment credentials in the one response and never rewrites a target identity', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        target: 'fixture-target',
        token: 'obviously-fake-test-token',
        oneTime: true,
      }),
    );
    await createSkillsApi(send).enroll('fixture-target', {
      channel: 'canary',
      skills: ['fixture-skill'],
    });
    expect(send.mock.calls[0]?.[0]).toBe(
      '/api/skills/admin/targets/fixture-target/enroll',
    );
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
      channel: 'canary',
      skills: ['fixture-skill'],
    });
  });
});

describe('reviewed native deployment workflow',()=>{
 const job={id:'fixture-job',target:'fixture-target',actor:'admin',status:'awaiting_approval',result:null,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',manifest_json:JSON.stringify({schemaVersion:1,channel:'stable',skills:[]}),publication_sha256:'a'.repeat(64),approval_expires_at:'2026-01-01T00:05:00Z',approved_at:null,magnus_job_id:null};
 it('previews and approves the exact owning digest through the product API',async()=>{const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json(job));const api=createSkillsApi(send);const preview=await api.prepareDeployment('fixture-target');expect(preview.publication_sha256).toBe(job.publication_sha256);await api.approveDeployment(job.id,job.publication_sha256);expect(send.mock.calls[0]?.[0]).toBe('/api/skills/admin/deployments/fixture-target');expect(send.mock.calls[1]?.[0]).toBe('/api/skills/admin/deployments/jobs/fixture-job/approve');expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toEqual({publicationSha256:job.publication_sha256});expect(()=>api.approveDeployment(job.id,'invalid')).toThrow();expect(send).toHaveBeenCalledTimes(2)});
 it('reads and reconciles an unknown operation without creating or replaying a deployment',async()=>{const send=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({...job,status:'unknown',magnus_job_id:'magnus-original'}));const api=createSkillsApi(send);expect((await api.deployment(job.id)).status).toBe('unknown');await api.reconcileDeployment(job.id);expect(send.mock.calls.map(call=>call[0])).toEqual(['/api/skills/admin/deployments/jobs/fixture-job','/api/skills/admin/deployments/jobs/fixture-job/reconcile']);expect(send.mock.calls[0]?.[1]?.method).toBe('GET');expect(send.mock.calls[1]?.[1]?.method).toBe('POST')});
});
