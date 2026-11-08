// Access to the running end-to-end stack (e2e/stack): its saved state, an operator sign-in
// that follows HiveXUI's PKCE flow through the console ingress, a Studio API client and a
// project event-stream recorder. TLS is verified against the stack's own throwaway authority.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const statePath = resolve(process.env.STUDIO_E2E_STATE_FILE ?? join(here, '../../../output/studio-e2e/state.json'));

export type StackState = {
  project?: string; origin: string; port: number;
  admin: { username: string; password: string; subject: string };
  node: { id: string; hostname: string };
  agents: { profile: string; ref: string }[];
  /** The synthetic HiveSkills catalog skill the bootstrap publishes. */
  skill?: { slug: string; version: string; sha256: string };
  /** Lifetime of the agents' HiveMem credentials, in hours. */
  credentialHours?: number;
  /** Throwaway stack secrets; the specs use only the HiveMem admin token, for read-only checks. */
  secrets?: { hivememAdminToken: string };
};

/** A container of this stack, by compose service name. */
export const container = (service: string): string => `${stack().project ?? 'studio-e2e'}-${service}-1`;

export function stackAvailable(): boolean {
  if (!existsSync(statePath)) return false;
  try { return (JSON.parse(readFileSync(statePath, 'utf8')) as { phase?: string }).phase === 'ready'; } catch { return false; }
}
export function stack(): StackState { return JSON.parse(readFileSync(statePath, 'utf8')) as StackState; }
const authority = () => readFileSync(join(dirname(statePath), 'certs/ca.pem'));

export type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; json: any; text: string };

export function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; raw?: Buffer } = {}): Promise<Reply> {
  const target = new URL(url);
  const payload = init.raw ?? (init.body === undefined ? undefined : Buffer.from(JSON.stringify(init.body)));
  const headers: Record<string, string> = { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) };
  return new Promise((resolveReply, reject) => {
    const request = https.request({ hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: init.method ?? 'GET', headers, ca: authority(), timeout: 120_000 }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolveReply({ status: response.statusCode ?? 0, headers: response.headers, body, json, text });
      });
    });
    request.on('timeout', () => request.destroy(new Error(`Timed out: ${init.method ?? 'GET'} ${url}`)));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

/** The operator's per-product access token, obtained the way HiveXUI obtains it. */
export async function signIn(client: string): Promise<string> {
  const { origin, admin } = stack();
  const browser = { Origin: origin, 'X-Oathweave-Browser': 'true' };
  const login = await call(`${origin}/api/oathweave/auth/login`, { method: 'POST', headers: browser, body: { username: admin.username, password: admin.password } });
  if (login.status !== 200) throw new Error(`Sign-in failed with ${login.status}`);
  const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find(value => value.startsWith('__Host-oathweave_sso='))!.split(';')[0]!;
  const verifier = randomBytes(32).toString('base64url');
  const authorize = await call(`${origin}/api/oathweave/oauth/authorize`, { method: 'POST', headers: { ...browser, Cookie: cookie }, body: {
    clientId: client, redirectUri: `${origin}/auth/callback`, responseType: 'code', codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256', scope: 'openid profile', state: randomBytes(16).toString('base64url'), nonce: randomBytes(16).toString('base64url') } });
  if (authorize.status !== 200) throw new Error(`Authorization for ${client} failed with ${authorize.status}`);
  const token = await call(`${origin}/api/oathweave/oauth/token`, { method: 'POST', headers: browser, body: {
    grant_type: 'authorization_code', client_id: client, code: authorize.json.code, code_verifier: verifier, redirect_uri: `${origin}/auth/callback` } });
  if (token.status !== 200) throw new Error(`Token exchange for ${client} failed with ${token.status}`);
  return token.json.access_token as string;
}

export class StudioApi {
  constructor(private readonly token: string, private readonly base = `${stack().origin}/api/ardentstudio/v1`) {}
  private async send(method: string, path: string, body?: unknown, raw?: { bytes: Buffer; type: string }): Promise<any> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (method !== 'GET') headers['X-Idempotency-Key'] = randomUUID();
    if (raw) headers['Content-Type'] = raw.type;
    const reply = await call(this.base + path, { method, headers, ...(raw ? { raw: raw.bytes } : body === undefined ? {} : { body }) });
    if (reply.status >= 400) throw Object.assign(new Error(`${method} ${path} answered ${reply.status}: ${reply.text.slice(0, 500)}`), { reply });
    return reply.json ?? reply.body;
  }
  get(path: string) { return this.send('GET', path); }
  post(path: string, body: unknown = {}) { return this.send('POST', path, body); }
  put(path: string, body: unknown) { return this.send('PUT', path, body); }
  upload(projectId: string, name: string, type: string, bytes: Buffer) {
    return this.send('POST', `/projects/${projectId}/files?name=${encodeURIComponent(name)}&purpose=reference`, undefined, { bytes, type });
  }
  async blob(sha256: string): Promise<Reply> {
    return call(`${this.base}/blobs/${sha256}`, { headers: { Authorization: `Bearer ${this.token}` } });
  }
}

export type StudioEvent = { type: string; id?: string; data: any; at: number };

/** Records a project's event stream; `close()` drops the connection the way a lost network does. */
export class ProjectStream {
  readonly events: StudioEvent[] = [];
  private request: ReturnType<typeof https.request> | undefined;
  constructor(private readonly token: string, private readonly projectId: string) {}
  open(after?: number): Promise<void> {
    const url = new URL(`${stack().origin}/api/ardentstudio/v1/projects/${this.projectId}/stream${after === undefined ? '' : `?after=${after}`}`);
    return new Promise((opened, failed) => {
      this.request = https.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, ca: authority(),
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' } }, response => {
        if (response.statusCode !== 200) { failed(new Error(`Stream answered ${response.statusCode}`)); return; }
        opened();
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            let type = 'message', id: string | undefined; const data: string[] = [];
            for (const lineText of block.split('\n')) {
              if (lineText.startsWith('event:')) type = lineText.slice(6).trim();
              else if (lineText.startsWith('id:')) id = lineText.slice(3).trim();
              else if (lineText.startsWith('data:')) data.push(lineText.slice(5).trimStart());
            }
            let parsed: unknown = data.join('\n');
            try { parsed = JSON.parse(data.join('\n')); } catch { /* text */ }
            this.events.push({ type, ...(id ? { id } : {}), data: parsed, at: Date.now() });
          }
        });
      });
      this.request.on('error', error => { if (!this.request?.destroyed) failed(error); });
      this.request.end();
    });
  }
  close(): void { this.request?.destroy(); }
  lastSeq(): number | undefined { return [...this.events].reverse().find(event => event.id)?.id as unknown as number | undefined; }
  async waitFor(predicate: (event: StudioEvent) => boolean, timeoutMs = 120_000, label = 'event'): Promise<StudioEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}; saw ${[...new Set(this.events.map(event => event.type))].join(', ')}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
  }
}

export async function eventually<T>(label: string, check: () => Promise<T | undefined | null | false>, timeoutMs = 120_000, intervalMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
    await new Promise(resolveWait => setTimeout(resolveWait, intervalMs));
  }
}
