// Runs inside the stack network (compose `tools` service). Phase "enroll" waits for the stack,
// publishes the synthetic HiveSkills catalog skill and starts the Magnus resource enrollment of the
// fleet node (Magnus itself creates the agents' HiveMem workspace as its Oathweave service); phase "agents"
// activates the reviewed Ardent-only scope (over the evidence Magnus's ADMIN API reports: the drain
// receipt digests and scheduler snapshot), installs the staged Ardent package and deploys the first
// agents through Magnus's New Agent operation, signed in as the seeded operator through the console
// ingress.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const stateDir = process.env.STUDIO_E2E_STATE ?? '/state';
const statePath = join(stateDir, 'state.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const say = message => process.stdout.write(`[bootstrap] ${message}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}

/** HTTPS request; `via` connects to another container while keeping the URL's host for TLS and Host. */
export function request(url, { method = 'GET', headers = {}, body, via } = {}) {
  const target = new URL(url);
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: target.hostname, port: target.port || 443, path: target.pathname + target.search, method,
      headers: { ...(payload !== undefined && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(via ? { lookup: (_host, options, callback) => dnsLookup(via, options, callback) } : {}), timeout: 120_000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${url}`)));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function until(label, check, { timeoutMs = 300_000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { if (error.fatal) throw error; last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ''}`);
}

const MAGNUS = 'https://magnus:4000/api/v1';
async function magnus(path, options = {}) {
  const response = await request(MAGNUS + path, { ...options, headers: { 'x-api-secret': state.secrets.magnusApi, ...(options.headers ?? {}) } });
  if (response.status >= 400) throw new Error(`Magnus ${options.method ?? 'GET'} ${path}: ${response.status} ${response.text.slice(0, 400)}`);
  return response.json?.data ?? response.json;
}

/** Sign in as the seeded operator through the ingress and get a product token (PKCE, as HiveXUI does). */
export async function productToken(client) {
  const origin = state.origin;
  const via = 'ingress';
  const base = `https://localhost:8443`;
  const headers = { Origin: origin, 'X-Oathweave-Browser': 'true', Host: new URL(origin).host };
  const login = await request(`${base}/api/oathweave/auth/login`, { method: 'POST', via, headers, body: { username: state.admin.username, password: state.admin.password } });
  if (login.status !== 200) throw new Error(`Sign-in failed: ${login.status} ${login.text.slice(0, 200)}`);
  const cookie = [].concat(login.headers['set-cookie'] ?? []).find(value => value.startsWith('__Host-oathweave_sso=')).split(';')[0];
  const verifier = randomBytes(32).toString('base64url');
  const authorize = await request(`${base}/api/oathweave/oauth/authorize`, { method: 'POST', via, headers: { ...headers, Cookie: cookie }, body: {
    clientId: client, redirectUri: `${origin}/auth/callback`, responseType: 'code', codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', scope: 'openid profile', state: randomBytes(16).toString('base64url'), nonce: randomBytes(16).toString('base64url') } });
  if (authorize.status !== 200) throw new Error(`Authorize ${client} failed: ${authorize.status} ${authorize.text.slice(0, 200)}`);
  const token = await request(`${base}/api/oathweave/oauth/token`, { method: 'POST', via, headers, body: {
    grant_type: 'authorization_code', client_id: client, code: authorize.json.code, code_verifier: verifier, redirect_uri: `${origin}/auth/callback` } });
  if (token.status !== 200) throw new Error(`Token ${client} failed: ${token.status} ${token.text.slice(0, 200)}`);
  return token.json.access_token;
}

async function waitForStack() {
  await until('Oathweave', async () => (await request('https://oathweave:4200/api/v1/health/ready')).status === 200);
  await until('HiveMem', async () => (await request('https://hivemem:18790/v1/health')).status === 200);
  await until('HiveSkills', async () => (await request('https://hiveskills:4030/healthz')).status === 200);
  await until('Magnus', async () => (await request(`${MAGNUS}/health`)).status === 200);
  await until('the console ingress', async () => (await request('https://localhost:8443/_hive/ready', { via: 'ingress', headers: { Host: new URL(state.origin).host } })).status === 200);
  say('services are up');
}

/** A gzip-compressed ustar archive of regular files, as HiveSkills and Magnus accept for a skill release. */
export function skillArchive(files) {
  const blocks = [];
  const field = (block, offset, length, value) => block.write(value, offset, length, 'utf8');
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(512);
    field(header, 0, 100, name); field(header, 100, 8, '0000644\0'); field(header, 108, 8, '0001750\0'); field(header, 116, 8, '0001750\0');
    field(header, 124, 12, body.length.toString(8).padStart(11, '0') + '\0'); field(header, 136, 12, '00000000000\0');
    header.fill(32, 148, 156); field(header, 156, 1, '0'); field(header, 257, 6, 'ustar\0'); field(header, 263, 2, '00');
    field(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ');
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

export const SYNTHETIC_SKILL = { slug: 'field-notes', version: '1.0.0' };

/** Publish one synthetic skill on HiveSkills' stable channel, as a registry administrator through the console. */
async function publishSkill() {
  const token = await productToken('hivexui-hiveskills');
  const headers = { Authorization: `Bearer ${token}`, Host: new URL(state.origin).host };
  const base = 'https://localhost:8443/api/hiveskills';
  const send = async (method, path, body, accept = [200, 201]) => {
    const response = await request(base + path, { method, via: 'ingress', headers, body });
    if (!accept.includes(response.status)) throw new Error(`HiveSkills ${method} ${path}: ${response.status} ${response.text.slice(0, 300)}`);
    return response.json;
  };
  const { slug, version } = SYNTHETIC_SKILL;
  await send('POST', '/admin/skills', { slug, name: 'Field notes', description: 'Keeps short, dated field notes while working on a project.' }, [201, 409]);
  const archive = skillArchive({
    'SKILL.md': `---\nname: ${slug}\ndescription: Keep short, dated field notes while working on a project.\n---\n\n# Field notes\n\nWrite one dated line per finding. Keep notes factual and short.\n`,
    'templates/note.md': '- YYYY-MM-DD: finding\n',
  });
  const release = await send('POST', `/admin/skills/${slug}/releases`, { version, archiveBase64: archive.toString('base64'), notes: 'Synthetic end-to-end skill' }, [201, 409]);
  await send('PUT', `/admin/channels/stable/${slug}`, { version });
  state.skill = { slug, version, sha256: release?.sha256 ?? sha256(archive) };
  say(`HiveSkills publishes ${slug} ${version} on stable`);
}

async function enroll() {
  await waitForStack();
  await publishSkill();
  const node = await until('the node heartbeat', async () => {
    const nodes = await magnus('/nodes');
    const list = Array.isArray(nodes) ? nodes : nodes.nodes ?? nodes.items ?? [];
    return list.find(item => item.hostname === 'node1.studio.test' && item.status !== 'OFFLINE');
  }, { timeoutMs: 240_000 });
  state.node = { id: node.id, hostname: node.hostname };
  say(`node ${node.hostname} is ${node.status} (${node.id})`);
  const id = node.id;
  const drain = await magnus(`/resource-leases/enrollment/${id}/begin`, { method: 'POST', body: {} });
  const prepared = await magnus(`/resource-leases/enrollment/${id}/refresh`, { method: 'POST', body: { participant: 'api' } });
  const descriptor = prepared.descriptor;
  const hashes = { preinstrumentationSha256: sha256('studio-e2e:preinstrumentation'), localDescendantsSha256: sha256('studio-e2e:local'), sshDescendantsSha256: sha256('studio-e2e:ssh') };
  const evidenceSha256 = sha256(canonical({ nodeId: id, nodeFqdn: node.hostname, epoch: drain.epoch, barrierId: drain.barrierId, ...hashes }));
  const api = { ...descriptor, status: 'drained', activeCount: 0, unknownCount: 0, evidenceSha256, ...hashes, observedAt: Date.now(), approvalRef: 'studio-e2e:fresh-test-node' };
  const signature = createHmac('sha256', state.secrets.magnusReconcile).update('magnus.resource-enrollment-api-attestation.v1\n' + canonical(api)).digest('hex');
  await magnus(`/resource-leases/enrollment/${id}/api-attest`, { method: 'POST', body: { ...api, signature } });
  for (const participant of ['agent', 'dashboard']) {
    const result = await magnus(`/resource-leases/enrollment/${id}/refresh`, { method: 'POST', body: { participant } });
    if (result.status !== 'verified') throw new Error(`Enrollment participant ${participant}: ${JSON.stringify(result).slice(0, 300)}`);
  }
  state.enrollment = { epoch: drain.epoch, barrierId: drain.barrierId };
  state.phase = 'enrolling';
  save();
  say('node drain receipts verified');
}

/** Activate the reviewed Ardent-only scope over the evidence Magnus reports for it, read just before signing. */
async function activateArdentScope(id, hostname) {
  const evidence = await magnus(`/resource-leases/enrollment/${id}/ardent-scope/evidence`);
  if (evidence.scope === 'active') return;
  if (!evidence.ready) throw new Error(`Ardent-only scope cannot be activated: ${evidence.blockers.join('; ')}`);
  if (evidence.epoch !== state.enrollment.epoch || evidence.barrierId !== state.enrollment.barrierId) throw new Error('The node drain changed since enrollment');
  const assertion = { version: 1, scope: 'managed-ardent-actions-only', excludedParticipant: 'scheduler', nodeId: id, nodeFqdn: hostname,
    epoch: evidence.epoch, barrierId: evidence.barrierId, decisionId: randomUUID(), approvalRef: 'studio-e2e:operator',
    reviewSha256: sha256('studio-e2e:review'), schedulerSnapshotSha256: evidence.schedulerSnapshotSha256,
    receiptSha256: evidence.receiptSha256, expiresAt: Date.now() + 120_000 };
  const signature = createHmac('sha256', state.secrets.magnusReconcile).update('magnus.ardent-scope-activation.v1\n' + canonical(assertion)).digest('hex');
  await magnus(`/resource-leases/enrollment/${id}/ardent-scope/activate`, { method: 'POST', body: { ...assertion, signature } });
}

async function agents() {
  const { id, hostname } = state.node;
  await activateArdentScope(id, hostname);
  say('Ardent-only scope is active');
  const install = await magnus(`/ardent/installations/${id}/profiles/install/action`, { method: 'POST', body: { action: 'package-install' } });
  say(`Ardent package installed: ${JSON.stringify(install).slice(0, 200)}`);

  const token = await productToken('hivexui-magnus');
  const deployed = [];
  for (const profile of state.initialAgents ?? ['ember', 'sage']) {
    const body = { nodeId: id, profile, soul_md: `# ${profile}\nA careful collaborator on synthetic test projects.`,
      identity_md: `# ${profile}\nAn Ardent agent created by the Studio end-to-end stack.`, model: { base_url: 'http://model:8080', model: 'studio-fixture' },
      skills: [], hivemem: true };
    const started = await request(`https://localhost:8443/api/magnus/ardent/agents`, { method: 'POST', via: 'ingress',
      headers: { Authorization: `Bearer ${token}`, Host: new URL(state.origin).host, 'X-Idempotency-Key': randomUUID() }, body });
    if (started.status !== 202) throw new Error(`New Agent ${profile}: ${started.status} ${started.text.slice(0, 400)}`);
    const operationId = started.json.data?.operationId ?? started.json.operationId;
    const done = await until(`New Agent ${profile}`, async () => {
      const operation = await magnus(`/ardent/agents/operations/${operationId}`);
      if (operation.status === 'failed') throw Object.assign(new Error(`New Agent ${profile} failed: ${JSON.stringify(operation).slice(0, 800)}`), { fatal: true });
      return operation.status === 'succeeded' ? operation : null;
    }, { timeoutMs: 300_000, intervalMs: 3000 });
    deployed.push({ profile, ref: `${id}~${profile}`, operationId, steps: done.steps.map(step => `${step.name ?? step.id}:${step.status}`) });
    say(`agent ${profile} is ready`);
  }
  state.agents = deployed;
  state.phase = 'ready';
  save();
}

const phase = process.argv[2];
try {
  if (phase === 'enroll') await enroll();
  else if (phase === 'agents') await agents();
  else throw new Error('Usage: bootstrap.mjs enroll|agents');
} catch (error) {
  process.stderr.write(`[bootstrap] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
