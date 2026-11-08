#!/usr/bin/env node
// Ardent Project Studio end-to-end stack: build every service from sibling checkouts, start it
// with throwaway secrets and certificates, and bootstrap a fleet node with Ardent agents.
//
//   node e2e/stack/stack.mjs up        build (if needed), start, bootstrap; prints the console URL
//   node e2e/stack/stack.mjs down      remove this stack's containers, volumes and run directory
//   node e2e/stack/stack.mjs status    print the saved run state (credentials stay in the file)
//
// Environment:
//   STUDIO_E2E_PRODUCTS_ROOT  directory holding the product checkouts (default: parent of HiveXUI)
//   STUDIO_E2E_MAGNUS_DIR     Magnus checkout to build (default: $ROOT/Magnus)
//   STUDIO_E2E_ARDENT_TGZ     Ardent package tarball to stage on the node (default: packed from $ROOT/Ardent)
//   STUDIO_E2E_REBUILD=1      rebuild images even when they exist
//   STUDIO_E2E_PROJECT        compose project name (default studio-e2e)
//   STUDIO_E2E_PORT           loopback console port (default: a free port)
//   STUDIO_E2E_TAG            tag of the stack's images (default local), so runs of other checkouts keep theirs
// Only the model is a fixture (e2e/stack/model/server.mjs). Nothing here uses real credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

const stack = import.meta.dirname;
const hivexui = resolve(stack, '../..');
const root = resolve(process.env.STUDIO_E2E_PRODUCTS_ROOT ?? dirname(hivexui));
const project = process.env.STUDIO_E2E_PROJECT ?? 'studio-e2e';
const tag = process.env.STUDIO_E2E_TAG ?? 'local';
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(tag)) throw new Error('STUDIO_E2E_TAG must be a lowercase image tag');
const run = join(hivexui, 'output', project);
const statePath = join(run, 'state.json');

const say = message => process.stdout.write(`[studio-e2e] ${message}\n`);
const sh = (command, args, options = {}) => (execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options }) ?? '').trim();
const secret = (bytes = 32) => randomBytes(bytes).toString('hex');
const line = (key, value) => `${key}=${value}\n`;
const write = (path, text, mode = 0o600) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { mode }); chmodSync(path, mode); };

export function dockerAvailable() {
  return spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status === 0
    && spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
}

function composeEnv(port) {
  return { ...process.env, STUDIO_E2E_PROJECT: project, STUDIO_E2E_RUN: run, STUDIO_E2E_STACK: stack, STUDIO_E2E_PORT: String(port), STUDIO_E2E_TAG: tag };
}
function compose(args, port, options = {}) {
  return sh('docker', ['compose', '-p', project, '-f', join(stack, 'compose.yml'), ...args], { env: composeEnv(port), ...options });
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)); });
    server.on('error', reject);
  });
}

function imageExists(tag) { return spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0; }

function buildImages() {
  const magnus = resolve(process.env.STUDIO_E2E_MAGNUS_DIR ?? join(root, 'Magnus'));
  const images = [
    [`studio-e2e-oathweave:${tag}`, join(root, 'Oathweave'), 'Dockerfile'],
    [`studio-e2e-hivemem:${tag}`, join(root, 'HiveMem'), 'Dockerfile'],
    [`studio-e2e-ardentstudio:${tag}`, join(root, 'ArdentStudio'), 'Dockerfile'],
    [`studio-e2e-hivexui:${tag}`, hivexui, 'Dockerfile'],
    [`studio-e2e-magnus:${tag}`, magnus, 'services/control-api/Dockerfile'],
    [`studio-e2e-node:${tag}`, magnus, join(stack, 'node.Dockerfile')],
  ];
  for (const [tag, context, file] of images) {
    if (imageExists(tag) && process.env.STUDIO_E2E_REBUILD !== '1') continue;
    if (!existsSync(context)) throw new Error(`Missing checkout ${context}; set STUDIO_E2E_PRODUCTS_ROOT`);
    say(`building ${tag} from ${context}`);
    const result = spawnSync('docker', ['build', '-q', '-f', file.startsWith('/') ? file : join(context, file), '-t', tag, context], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (result.status !== 0) throw new Error(`docker build failed for ${tag}`);
  }
}

function ardentTarball() {
  if (process.env.STUDIO_E2E_ARDENT_TGZ) return resolve(process.env.STUDIO_E2E_ARDENT_TGZ);
  const ardent = join(root, 'Ardent');
  say('packing Ardent from its checkout');
  sh('npm', ['run', 'build'], { cwd: ardent });
  const directory = join(run, 'ardent-pack');
  mkdirSync(directory, { recursive: true });
  const name = sh('npm', ['pack', '--ignore-scripts', '--pack-destination', directory], { cwd: ardent }).split('\n').pop();
  return join(directory, name);
}

function certificates(origin) {
  const certs = join(run, 'certs');
  mkdirSync(certs, { recursive: true });
  const ssl = args => sh('openssl', args, { cwd: certs });
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=studio-e2e-authority',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const leaves = { oathweave: ['oathweave', 'localhost'], hivemem: ['hivemem', 'localhost'], magnus: ['magnus', 'localhost'],
    node1: ['node1.studio.test', 'node1', 'localhost'], console: [new URL(origin).hostname] };
  for (const [name, names] of Object.entries(leaves)) {
    writeFileSync(join(certs, `${name}.ext`), `subjectAltName=${names.map(item => `DNS:${item}`).join(',')},IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n`);
    ssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${names[0]}`]);
    ssl(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', `0x${secret(8)}`, '-days', '2', '-extfile', `${name}.ext`, '-out', `${name}.crt`]);
    chmodSync(join(certs, `${name}.key`), 0o600);
  }
  for (const file of readdirSync(certs)) if (file.endsWith('.crt') || file === 'ca.pem') chmodSync(join(certs, file), 0o644);
}

function hivememToken(jwtSecret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'hivemem', aud: 'hivemem-api', token_type: 'access', iat: now, exp: now + 3 * 86400,
    jti: randomUUID(), sub: 'magnus-control', role: 'admin', scope: 'admin:all' })}`;
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
}

function configure(port) {
  const origin = `https://localhost:${port}`;
  const issuer = `${origin}/api/oathweave`;
  const nativeIssuer = `oathweave-${project}`;
  const admin = { username: 'admin', email: 'admin@example.com', password: `e2e-${secret(12)}`, subject: secret(16) };
  const studioMagnus = 'ardentstudio-magnus', studioHivemem = 'ardentstudio-hivemem';
  const s = Object.fromEntries(['oathCookie', 'oathAgent', 'oathRedis', 'nativeHive', 'nativeRouter', 'memJwt', 'memRenewal', 'magnusDb', 'magnusRedis',
    'magnusApi', 'magnusJwt', 'magnusManager', 'magnusAudit', 'magnusResult', 'magnusLog', 'magnusRotation', 'magnusMetrics', 'magnusWebhook',
    'magnusReconcile', 'magnusCommandReconcile', 'studioMagnus', 'studioHivemem'].map(name => [name, secret()]));
  const config = join(run, 'config');
  const redirect = `${origin}/auth/callback`;
  const clients = [
    { id: 'hivexui-oathweave', audience: 'oathweave', permissions: ['iam:users:read', 'iam:users:write', 'iam:roles:read', 'iam:sessions:revoke', 'iam:audit:read'] },
    { id: 'hivexui-hivemem', audience: 'hivemem', permissions: ['hivemem:admin:all'] },
    { id: 'hivexui-magnus', audience: 'magnus', permissions: ['magnus:view', 'magnus:operate', 'magnus:admin'] },
    { id: 'hivexui-ardentstudio', audience: 'ardentstudio', permissions: ['ardentstudio:projects:read', 'ardentstudio:projects:write', 'ardentstudio:templates:read',
      'ardentstudio:templates:write', 'ardentstudio:review:write', 'ardentstudio:agents:admin'] },
  ].map(client => ({ ...client, redirectUris: [redirect], firstParty: true }));
  write(join(config, 'suite-bootstrap.json'), JSON.stringify({ schema: 1, adminId: admin.subject, clients }));
  const policies = Object.fromEntries(clients.map(client => [client.id, { audience: client.audience, permissions: client.permissions }]));
  const common = line('NODE_ENV', 'production') + line('HIVE_HOME', '/data') + line('HIVE_AUTO_UPGRADE', 'false') + line('HIVE_UPDATE_CHECK', 'false')
    + line('NODE_EXTRA_CA_CERTS', '/config/authority.pem');
  const identity = line('OATHWEAVE_ISSUER', issuer) + line('OATHWEAVE_JWKS_URL', 'https://oathweave:4200/api/v1/oauth/jwks')
    + line('OATHWEAVE_USERINFO_URL', 'https://oathweave:4200/api/v1/oauth/userinfo');

  write(join(config, 'oathweave-redis.conf'), `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${s.oathRedis}\n`, 0o644);
  write(join(config, 'oathweave.env'), common + line('HIVE_AUTO_MIGRATE', 'true') + line('HOST', '0.0.0.0') + line('PORT', '4200')
    + line('DATABASE_URL', 'file:/data/iam/iam.db') + line('REDIS_URL', `redis://:${s.oathRedis}@oathweave-redis:6379`)
    + line('JWT_ISSUER', nativeIssuer) + line('IAM_BROWSER_ISSUER', issuer) + line('IAM_BROWSER_CLIENT_POLICIES', JSON.stringify(policies))
    + line('COOKIE_SECRET', s.oathCookie) + line('IAM_AGENT_SECRET', s.oathAgent) + line('RELAX_AUTH_LIMITS', 'true')
    + line('SEED_ADMIN_USERNAME', admin.username) + line('SEED_ADMIN_EMAIL', admin.email) + line('SEED_ADMIN_PASSWORD', admin.password)
    + line('SEED_HIVE_CLIENT_SECRET', s.nativeHive) + line('SEED_HIVE_ROUTER_CLIENT_SECRET', s.nativeRouter)
    + line('OATHWEAVE_SUITE_BOOTSTRAP_FILE', '/config/suite-bootstrap.json')
    + line('IAM_MACHINE_CLIENT_POLICIES', JSON.stringify({
      [studioMagnus]: { audience: 'magnus', permissions: ['magnus:ardent'], lifetimeSeconds: 300, rotationOwner: 'hive-suite', issuer: 'browser' },
      [studioHivemem]: { audience: 'hivemem', permissions: ['hivemem:workspaces:write', 'hivemem:memories:write'], lifetimeSeconds: 300, rotationOwner: 'hive-suite' } }))
    + line('IAM_MACHINE_CLIENT_SECRETS', JSON.stringify({ [studioMagnus]: s.studioMagnus, [studioHivemem]: s.studioHivemem }))
    + line('TLS_CERT_PATH', '/config/tls.crt') + line('TLS_KEY_PATH', '/config/tls.key') + line('CORS_ORIGIN', origin)
    + line('WEBAUTHN_RP_ID', 'localhost') + line('WEBAUTHN_RP_ORIGIN', origin) + line('WEBAUTHN_RP_NAME', 'Oathweave')
    + line('IAM_RECOVERY_OUTBOX_DIRECTORY', '/data/iam/recovery-outbox'));

  write(join(config, 'hivemem.env'), common + line('HIVE_AUTO_MIGRATE', 'true') + identity + line('HIVEMEM_TS_CORE_HOST', '0.0.0.0') + line('HIVEMEM_TS_CORE_PORT', '18790')
    + line('HIVEMEM_STORAGE_PATH', '/data/memory') + line('HIVEMEM_TS_PERSISTENCE', 'memory')
    + line('HIVEMEM_JWT_SECRET', s.memJwt) + line('HIVEMEM_RENEWAL_SECRET', s.memRenewal)
    + line('HIVEMEM_TS_TLS_CERT_FILE', '/config/tls.crt') + line('HIVEMEM_TS_TLS_KEY_FILE', '/config/tls.key')
    + line('HIVEMEM_OATHWEAVE_IDENTITIES_JSON', JSON.stringify([{ issuer, subject: admin.subject, localId: 'admin', credentialGeneration: 0 }]))
    + line('HIVEMEM_OATHWEAVE_SERVICES_JSON', JSON.stringify([{ issuer: nativeIssuer, clientId: studioHivemem, localId: 'ardentstudio', scopes: ['workspaces:write', 'memories:write'] }])));

  write(join(config, 'magnus-postgres.env'), line('POSTGRES_DB', 'magnus') + line('POSTGRES_USER', 'magnus') + line('POSTGRES_PASSWORD', s.magnusDb));
  write(join(config, 'magnus-redis.conf'), `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${s.magnusRedis}\n`, 0o644);
  const hivememAdminToken = hivememToken(s.memJwt);
  write(join(config, 'magnus.env'), line('NODE_ENV', 'production') + line('NODE_EXTRA_CA_CERTS', '/config/authority.pem') + identity
    + line('MAGNUS_HOME', '/var/lib/magnus') + line('MAGNUS_AUTO_MIGRATE', 'true') + line('MAGNUS_UPDATE_CHECK', 'false') + line('MAGNUS_AGENT_UPGRADES', 'false')
    + line('DATABASE_URL', `postgresql://magnus:${s.magnusDb}@magnus-postgres:5432/magnus`) + line('REDIS_URL', `redis://:${s.magnusRedis}@magnus-redis:6379`)
    + line('API_SECRET', s.magnusApi) + line('JWT_SECRET', s.magnusJwt) + line('NODE_MANAGER_SECRET', s.magnusManager)
    + line('AUDIT_HMAC_SECRET', s.magnusAudit) + line('RESULT_SIGNING_SECRET', s.magnusResult) + line('LOG_INGEST_SIGNING_SECRET', s.magnusLog)
    + line('CREDENTIAL_ROTATION_KEY', s.magnusRotation) + line('METRICS_TOKEN', s.magnusMetrics) + line('WEBHOOK_ENCRYPTION_KEY', s.magnusWebhook)
    + line('RESOURCE_PARTICIPANT_RECONCILIATION_SECRET', s.magnusReconcile) + line('COMMAND_RECONCILIATION_SECRET', s.magnusCommandReconcile)
    + line('TLS_CERT_PATH', '/config/tls.crt') + line('TLS_KEY_PATH', '/config/tls.key') + line('CONTROL_API_BIND_HOST', '0.0.0.0') + line('CONTROL_API_PORT', '4000')
    + line('CONTROL_API_URL', 'https://magnus:4000') + line('CORS_ORIGIN', origin) + line('DASHBOARD_PUBLIC_ORIGIN', origin)
    + line('SECURITY_FUSION_MODE', 'off') + line('ENABLE_AGENT_DISCOVERY', 'false') + line('AGENT_TLS_DOMAIN_SUFFIX', 'studio.test')
    + line('MAGNUS_CONSOLE_BASE_PATH', '/fleet') + line('MAGNUS_HERMES_ENABLED', 'true') + line('RESOURCE_ENROLLMENT_DASHBOARD_PARTICIPANT', 'absent')
    + line('MAGNUS_OATHWEAVE_IDENTITIES_JSON', JSON.stringify([{ issuer, subject: admin.subject, localUserId: 'operator-admin', role: 'ADMIN' },
      { issuer, subject: studioMagnus, localUserId: 'ardentstudio', role: 'ARDENT_SERVICE' }]))
    + line('MAGNUS_ARDENT_HIVEMEM_URL', 'https://hivemem:18790/') + line('MAGNUS_ARDENT_HIVEMEM_ENROLLMENT_TOKEN', hivememAdminToken)
    + line('MAGNUS_ARDENT_HIVEMEM_WORKSPACE_ID', 'agents'));

  write(join(config, 'agent.env'), line('NODE_ENV', 'production') + line('CONTROL_API_URL', 'https://magnus:4000') + line('HOST_FQDN', 'node1.studio.test')
    + line('NODE_MANAGER_SECRET', s.magnusManager) + line('RESULT_SIGNING_SECRET', s.magnusResult) + line('NODE_MANAGER_PORT', '4100')
    // The same independent key on both sides lets an ADMIN reconcile an Ardent action whose outcome is unknown.
    + line('COMMAND_RECONCILIATION_SECRET', s.magnusCommandReconcile)
    + line('TLS_CERT_PATH', '/etc/magnus-agent/tls.crt') + line('TLS_KEY_PATH', '/etc/magnus-agent/tls.key') + line('NODE_EXTRA_CA_CERTS', '/etc/studio-e2e/ca.pem')
    + line('MAGNUS_AGENT_PRIVILEGED', 'true') + line('MAGNUS_AGENT_SELF_UPGRADE', 'false') + line('MAGNUS_EXECUTION_SUPERVISOR_ENABLED', 'true')
    + line('AGENT_INSTALL_DIR', '/var/lib/magnus-agent') + line('ARDENT_OWNER_USER', 'ardent') + line('ARDENT_STAGED_PACKAGE', '/opt/ardent-stage/ardent-package.tgz'));
  // The Ardent gateways are user services; the owner's user manager gives them the stack's CA.
  write(join(config, 'ardent-user-environment.conf'), line('NODE_EXTRA_CA_CERTS', '/etc/studio-e2e/ca.pem'), 0o644);

  write(join(config, 'ardentstudio.env'), line('NODE_ENV', 'production') + line('NODE_EXTRA_CA_CERTS', '/config/authority.pem')
    + line('ARDENT_STUDIO_HOST', '0.0.0.0') + line('ARDENT_STUDIO_PORT', '8097') + line('ARDENT_STUDIO_DATA', '/data') + identity
    + line('ARDENT_STUDIO_OATHWEAVE_IDENTITIES_JSON', JSON.stringify([{ issuer, subject: admin.subject, localUserId: 'operator-admin', displayName: admin.username }]))
    + line('ARDENT_STUDIO_OATHWEAVE_TOKEN_URL', 'https://oathweave:4200/api/v1/oauth/token')
    + line('ARDENT_STUDIO_MAGNUS_URL', 'https://magnus:4000') + line('ARDENT_STUDIO_MAGNUS_CLIENT_ID', studioMagnus)
    + line('ARDENT_STUDIO_MAGNUS_CLIENT_SECRET', s.studioMagnus) + line('ARDENT_STUDIO_MAGNUS_SCOPE', 'magnus:ardent')
    + line('ARDENT_STUDIO_HIVEMEM_URL', 'https://hivemem:18790') + line('ARDENT_STUDIO_HIVEMEM_CLIENT_ID', studioHivemem)
    + line('ARDENT_STUDIO_HIVEMEM_CLIENT_SECRET', s.studioHivemem) + line('ARDENT_STUDIO_HIVEMEM_SCOPE', "'hivemem:workspaces:write hivemem:memories:write'"));

  write(join(config, 'runtime.json'), JSON.stringify({ schema: 1, mode: 'suite',
    products: { oathweave: '/api/oathweave', hivemem: '/api/hivemem', magnus: '/api/magnus', ardentstudio: '/api/ardentstudio' },
    identity: { issuer, apiPrefix: '/api/oathweave', clients: { oathweave: 'hivexui-oathweave', hivemem: 'hivexui-hivemem', magnus: 'hivexui-magnus', ardentstudio: 'hivexui-ardentstudio' } } }), 0o644);

  write(join(config, 'ingress.env'), line('HIVE_CONSOLE_HOST', 'localhost') + line('XDG_CONFIG_HOME', '/data/config') + line('XDG_DATA_HOME', '/data')
    + ['oathweave:OATHWEAVE:4200', 'hivemem:HIVEMEM:18790', 'magnus:MAGNUS:4000'].map(entry => {
      const [host, label, hostPort] = entry.split(':');
      return line(`${label}_ENDPOINT`, `https://${host}:${hostPort}`) + line(`${label}_TLS_NAME`, host);
    }).join('') + line('ARDENTSTUDIO_ENDPOINT', 'http://ardentstudio:8097'));
  const caddyfile = join(root, 'Hive', 'deployment', 'Caddyfile');
  if (!existsSync(caddyfile)) throw new Error(`Missing ${caddyfile}: the stack serves the console through Hive's ingress configuration`);
  cpSync(caddyfile, join(config, 'Caddyfile'));
  chmodSync(join(config, 'Caddyfile'), 0o644);

  return { origin, issuer, admin, port, secrets: { magnusApi: s.magnusApi, magnusReconcile: s.magnusReconcile, hivememAdminToken } };
}

function stageArdent(tarball) {
  const stage = join(run, 'ardent-stage');
  mkdirSync(stage, { recursive: true });
  cpSync(tarball, join(stage, 'ardent-package.tgz'));
  const bytes = readFileSync(join(stage, 'ardent-package.tgz'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const name = JSON.parse(sh('tar', ['-xzOf', join(stage, 'ardent-package.tgz'), 'package/package.json']));
  const sidecar = Buffer.from(JSON.stringify({ name: name.name, version: name.version, sha256 }));
  writeFileSync(join(stage, 'ardent-package.json'), sidecar);
  writeFileSync(join(stage, 'component-manifest.json'), JSON.stringify({ component: 'agent', files: [
    { path: 'ardent-package.json', sha256: createHash('sha256').update(sidecar).digest('hex') }, { path: 'ardent-package.tgz', sha256 }] }));
  for (const file of readdirSync(stage)) chmodSync(join(stage, file), 0o644);
  return { name: name.name, version: name.version };
}

function bootstrap(phase, port) {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', join(stack, 'compose.yml'), 'run', '--rm', '-T', 'tools', 'node', '/stack/bootstrap.mjs', phase],
    { env: composeEnv(port), stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`Bootstrap ${phase} failed; inspect with: docker compose -p ${project} logs`);
}

async function up() {
  if (!dockerAvailable()) { say('Docker is not available; nothing to start'); process.exitCode = 2; return; }
  if (existsSync(statePath)) throw new Error(`A ${project} run already exists (${run}); run "down" first`);
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true, mode: 0o700 });
  buildImages();
  const port = Number(process.env.STUDIO_E2E_PORT ?? await freePort());
  const tarball = ardentTarball();
  const settings = configure(port);
  certificates(settings.origin);
  const ardent = stageArdent(tarball);
  write(statePath, JSON.stringify({ project, ...settings, ardent, phase: 'starting' }, null, 2));
  say(`starting ${project} on ${settings.origin}`);
  compose(['up', '-d', '--quiet-pull'], port, { stdio: ['ignore', 'inherit', 'inherit'] });
  say('bootstrapping the fleet node and agents');
  bootstrap('enroll', port);
  bootstrap('agents', port);
  say(`ready: ${settings.origin} (state in ${statePath})`);
}

function down() {
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { port: 0 };
  if (dockerAvailable()) {
    try { compose(['--profile', 'tools', 'down', '-v', '--remove-orphans', '--timeout', '10'], state.port, { stdio: ['ignore', 'inherit', 'inherit'] }); }
    catch (error) { say(`compose down: ${error instanceof Error ? error.message : error}`); }
  }
  rmSync(run, { recursive: true, force: true });
  say(`removed ${project}`);
}

const command = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (command === 'up') await up();
    else if (command === 'down') down();
    else if (command === 'status') process.stdout.write(existsSync(statePath) ? `${run}\n` : 'not running\n');
    else { process.stderr.write('Usage: stack.mjs up|down|status\n'); process.exitCode = 2; }
  } catch (error) {
    process.stderr.write(`[studio-e2e] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
