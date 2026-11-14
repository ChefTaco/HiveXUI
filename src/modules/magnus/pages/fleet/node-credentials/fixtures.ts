// Test fixtures for per-node credentials, in the shapes of the Magnus browser contract. Tests only.
export const AT = '2026-11-05T12:00:00.000Z';

export const credential = (overrides: Record<string, unknown> = {}) => ({
  state: 'active',
  origin: 'LEGACY_UPGRADE',
  boundAt: AT,
  lastUsedAt: AT,
  keyFingerprint: 'abababababababab',
  evidenceSigning: true,
  legacyUse: { request: null, evidence: null, outbound: null, lastUsedAt: null },
  ...overrides,
});

export const summary = (overrides: Record<string, unknown> = {}) => ({
  mode: 'warn',
  serverKey: { keyId: 'f'.repeat(64), keyFingerprint: 'ffffffffffffffff' },
  legacyUpgrade: { open: true, until: '2026-12-05T12:00:00.000Z' },
  nodes: { total: 3, active: 1, none: 2, revoked: 0, evidenceSigning: 1 },
  pendingBindings: 1,
  legacyUse: { windowHours: 24, nodes: 1, request: 4, evidence: 0, outbound: 2, lastUsedAt: AT, unattributedSinceStart: 0 },
  enforceReady: false,
  blockers: [
    { code: 'NODES_WITHOUT_KEY', count: 2, nodes: [{ id: 'node-2', name: 'node two' }, { id: 'node-3', name: 'node three' }] },
    { code: 'PENDING_BINDINGS', count: 1, nodes: [{ id: 'node-2', name: 'node two' }] },
  ],
  generatedAt: AT,
  ...overrides,
});

/** The same summary from Magnus 3.0.0: an explicit, deprecated warn mode and a server key being rotated. */
export const summaryV3 = (overrides: Record<string, unknown> = {}) => summary({
  modeExplicit: true,
  modeDeprecated: true,
  deprecationNotice: 'NODE_AUTH_MODE=warn is deprecated and is removed in the next major release.',
  serverKeyRotation: {
    active: { keyId: 'f'.repeat(64), keyFingerprint: 'ffffffffffffffff', createdAt: AT },
    next: { keyId: 'e'.repeat(64), keyFingerprint: 'eeeeeeeeeeeeeeee', createdAt: AT },
    previous: { keyId: 'd'.repeat(64), keyFingerprint: 'dddddddddddddddd', createdAt: AT, promotedAt: AT, retireAfter: '2026-11-12T12:00:00.000Z', inGrace: true },
    retired: [{ keyId: '9'.repeat(64), keyFingerprint: '9999999999999999', createdAt: null, retiredAt: AT }],
    agents: { keyedNodes: 3, reporting: 3, pinningActive: 3, pinningNext: 2 },
  },
  blockers: [
    { code: 'AGENTS_NEED_UPGRADE', count: 1, nodes: [{ id: 'node-1', name: 'node one' }] },
    { code: 'PENDING_BINDINGS', count: 1, nodes: [{ id: 'node-2', name: 'node two' }] },
  ],
  ...overrides,
});

export const binding = (overrides: Record<string, unknown> = {}) => ({
  id: 'pb-1',
  nodeId: 'node-2',
  nodeName: 'node two',
  keyId: 'c'.repeat(64),
  keyFingerprint: 'cccccccccccccccc',
  fqdn: 'node-2.example.com',
  peerAddress: '198.51.100.7',
  recordedAddress: '192.0.2.12',
  status: 'PENDING',
  attempts: 3,
  createdAt: AT,
  lastSeenAt: new Date().toISOString(),
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  ...overrides,
});

export const node = (id: string, name: string, nodeCredential?: Record<string, unknown>) => ({
  id, name, hostname: `${id}.example.com`, ipAddress: '192.0.2.10', port: 4100, status: 'ONLINE', os: 'linux', arch: 'x64', tags: '[]', metadata: '{}', roleId: null,
  lastHeartbeatAt: AT, createdAt: AT, updatedAt: AT, role: null, upgradeReadiness: null, health: null,
  agent: { id: `agent-${id}`, nodeId: id, version: '2.10.0', status: 'RUNNING', pid: 1, startedAt: AT, lastCheckIn: AT, capabilities: '{}' },
  ...(nodeCredential ? { nodeCredential } : {}),
});

export const session = (role: string) => ({ success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '2.10.0', magnusVersion: '2.10.0', securityConsoleUrl: null } } });

export const nodeKey = (overrides: Record<string, unknown> = {}) => ({
  keyId: 'a'.repeat(64),
  keyFingerprint: 'abababababababab',
  status: 'ACTIVE',
  origin: 'LEGACY_UPGRADE',
  boundFqdn: 'node-1.example.com',
  evidenceSigning: true,
  evidenceSigningAt: AT,
  createdAt: AT,
  lastUsedAt: AT,
  retireAt: null,
  revokedAt: null,
  revokedBy: null,
  ...overrides,
});

export const revokeResult = (overrides: Record<string, unknown> = {}) => ({
  revoked: 1,
  state: 'revoked',
  agentRefused: true,
  sharedSecretAccepted: false,
  resetAvailable: true,
  detail: 'Revoked 1 key. The agent is refused until it is enrolled with a new token.',
  ...overrides,
});

export const resetResult = (overrides: Record<string, unknown> = {}) => ({
  removed: 2,
  state: 'none',
  sharedSecretAccepted: true,
  legacyUpgradeOpen: true,
  detail: 'Removed 2 keys. The node is accepted with the shared node secret again.',
  ...overrides,
});
