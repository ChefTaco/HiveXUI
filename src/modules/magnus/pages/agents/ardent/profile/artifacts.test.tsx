// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type Mounted } from '../../../../test-dom';
import ArdentProfilePage from './page';

const BYTES = new TextEncoder().encode('{"regions":3}');
const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const TASK = '0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e';
const profile = (capabilities?: Record<string, number>) => ({ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null, ...(capabilities ? { version: '3.2.0', capabilities } : {}) });
const installation = (capabilities?: Record<string, number>) => ({
  nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '3.2.0', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
  capabilities: { studio: 4 }, profiles: [profile(capabilities)],
});

let view: Mounted | undefined;
let saved: Array<{ name: string; type: string }>;
beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
  saved = [];
  // saveBlob makes a blob: link and clicks it; record what it would save.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    saved.push({ name: '', type: blob.type });
    return 'blob:artifact';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.at(-1)!.name = this.download;
  });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function open(capabilities: Record<string, number> | undefined, sha: string, content: () => Response) {
  const stub = stubApi(({ path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role: 'ADMIN', capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: installation(capabilities) };
    const base = '/ardent/installations/node-1/profiles/lead';
    if (path === `${base}/status`) return { success: true, data: { backend: 'llamacpp' } };
    if (path === `${base}/tasks`) return { success: true, data: { tasks: [{ id: TASK, state: 'completed', prompt: 'Draw the world map', created_ms: 1 }] } };
    if (path === `${base}/tasks/${TASK}/events`)
      return { success: true, data: { events: [{ sequence: 1, kind: 'artifact_registered', created_ms: 1, detail: { artifact_id: 'f'.repeat(32), name: 'regions.json', mime: 'application/json', sha256: sha, size: BYTES.length, revision: 1, supersedes_sha256: null, manifest: {} } }] } };
    if (path === `${base}/artifacts/${sha}/content` || path === `${base}/artifacts/${sha}`) return content();
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  history.replaceState(null, '', `/fleet/ardent/profiles/node-1~lead?tab=tasks&task=${TASK}`);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  // The page reads the installation, the tasks, then the linked task's journal.
  for (let index = 0; index < 100 && !button(/regions\.json/); index += 1) await settle(10);
  return stub;
}

describe('artifacts on the Ardent profile page', () => {
  it('lists a registered artifact and downloads it through transfer v2 with its type and name', async () => {
    const sha = await hex(BYTES);
    const stub = await open({ recovery: 1, lineage: 1, artifact_transfer: 2 }, sha, () => new Response(BYTES, { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="regions.json"', 'x-content-sha256': sha } }));
    // The link from Agent 360 opened the task.
    await click(button(/regions\.json/));
    for (let index = 0; index < 50 && !saved.length && !document.querySelector('[role="alert"]'); index += 1) await settle(10);
    expect(stub.requests.some((item) => item.path === `/ardent/installations/node-1/profiles/lead/artifacts/${sha}/content`)).toBe(true);
    expect(saved).toEqual([{ name: 'regions.json', type: 'application/json' }]);
  });

  it('saves nothing when the transferred bytes do not match the digest', async () => {
    const sha = await hex(BYTES);
    await open({ recovery: 1, lineage: 1, artifact_transfer: 2 }, sha, () => new Response(new TextEncoder().encode('tampered'), { headers: { 'content-type': 'application/json' } }));
    await click(button(/regions\.json/));
    for (let index = 0; index < 50 && !saved.length && !document.querySelector('[role="alert"]'); index += 1) await settle(10);
    expect(saved).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('does not match its digest');
  });

  it('uses the older route on a profile without transfer v2', async () => {
    const sha = await hex(BYTES);
    const stub = await open(undefined, sha, () => new Response(BYTES, { headers: { 'content-type': 'application/octet-stream' } }));
    await click(button(/regions\.json/));
    for (let index = 0; index < 50 && !saved.length && !document.querySelector('[role="alert"]'); index += 1) await settle(10);
    expect(stub.requests.some((item) => item.path.endsWith('/content'))).toBe(false);
    expect(saved).toEqual([{ name: 'regions.json', type: 'application/octet-stream' }]);
  });
});
