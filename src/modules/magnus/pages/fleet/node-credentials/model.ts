// How per-node credentials read on screen, in plain words. The wording follows Magnus's
// docs/NODE_CREDENTIALS.md; nothing here talks to the API.
import type { Tone } from '@ui';
import type { ConsoleRole } from '../../../routes';
import type { CredentialSummary, DowngradeCheck, EnforceBlocker, NodeCredential, PendingBinding } from './api';

/** The first agent release that has a node key. An older agent only knows the shared node secret. */
export const NODE_KEYS_SINCE = '2.10.0';
/** Magnus refuses to approve a binding whose agent has not asked for this long. */
export const PENDING_BINDING_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type CredentialState = NodeCredential['state'] | 'pending';

export interface CredentialStateView {
  state: CredentialState;
  /** Short, for a badge. */
  label: string;
  tone: Tone;
  /** One or two sentences: what the state means and what happens next. */
  explanation: string;
}

const STATES: Record<CredentialState, Omit<CredentialStateView, 'state'>> = {
  active: {
    label: 'own key',
    tone: 'success',
    explanation: 'This node signs its requests with its own Ed25519 key. Magnus refuses the fleet-wide shared secret for it.',
  },
  none: {
    label: 'shared secret',
    tone: 'warning',
    explanation: `This node still authenticates with the fleet-wide shared secret. An agent of ${NODE_KEYS_SINCE} or later binds its own key by itself after its first heartbeat while the automatic upgrade window is open; after that, enroll it with a token.`,
  },
  revoked: {
    label: 'key revoked',
    tone: 'danger',
    explanation: 'Its key was revoked, so Magnus refuses this agent, and the shared secret stays closed for it. Enroll the node again with a token.',
  },
  pending: {
    label: 'awaiting approval',
    tone: 'info',
    explanation: 'The agent asked to bind its key from an address other than the one recorded for this node. An administrator compares the fingerprint with the host and approves or rejects it.',
  },
};

/**
 * The state to show for one node. `pending` is not a server state: it is a node without a key that has a
 * binding waiting for an administrator, which only an administrator can list.
 */
export function credentialStateView(credential: NodeCredential, pending: PendingBinding | null | undefined = null): CredentialStateView {
  const state: CredentialState = credential.state === 'none' && pending ? 'pending' : credential.state;
  return { state, ...STATES[state] };
}

const ORIGINS: Record<NonNullable<NodeCredential['origin']>, string> = {
  ENROLLMENT_TOKEN: 'Enrolled with a one-time token',
  LEGACY_UPGRADE: 'Bound automatically while moving off the shared secret',
  ROTATION: 'Rotated on the node (magnus-agent identity rotate)',
};
export const originLabel = (origin: NodeCredential['origin']): string => (origin ? ORIGINS[origin] ?? origin : '—');

export interface LegacyChannelView {
  channel: 'request' | 'evidence' | 'outbound';
  label: string;
  count: number;
  lastUsedAt: string | null;
}
const CHANNELS: ReadonlyArray<{ channel: LegacyChannelView['channel']; label: string }> = [
  { channel: 'request', label: 'Requests from the node on the shared secret' },
  { channel: 'evidence', label: 'Evidence accepted on the shared result key' },
  { channel: 'outbound', label: 'Shared secret still sent to the node' },
];
/** Each channel's recorded use of the shared credentials. Null when this Magnus does not report it. */
export function legacyUseRows(credential: NodeCredential): LegacyChannelView[] | null {
  const use = credential.legacyUse;
  if (!use) return null;
  return CHANNELS.map(({ channel, label }) => ({ channel, label, count: use[channel]?.count ?? 0, lastUsedAt: use[channel]?.lastUsedAt ?? null }));
}

/** Whether the node's agent signs evidence with its key; null when this Magnus does not say (before phase 2). */
export function evidenceSigningText(credential: NodeCredential): string | null {
  if (credential.evidenceSigning === undefined) return null;
  if (credential.evidenceSigning) return 'Yes: evidence signed only with the shared result key is refused for this node.';
  if (credential.state !== 'active') return 'No: the node has no active key.';
  return 'Not yet: the agent is older than this Magnus release, or has not been told yet that the server verifies node evidence.';
}

export const MODES: Record<CredentialSummary['mode'], { label: string; tone: Tone; explanation: string }> = {
  compat: {
    label: 'compat',
    tone: 'neutral',
    explanation: 'Compat mode: an agent may sign its requests or present the shared secret, but a node that has its own key is closed to the shared secret.',
  },
  warn: {
    label: 'warn',
    tone: 'warning',
    explanation: 'Warn mode: as in compat mode, and every use of the shared secret is also logged, audited once a day per node, and fails the readiness check.',
  },
  enforce: {
    label: 'enforce',
    tone: 'success',
    explanation: 'Enforce mode: signatures only. The shared secret is refused and no longer sent, the automatic upgrade is closed and credentials cannot be reset.',
  },
};

export function upgradeWindowText(window: CredentialSummary['legacyUpgrade'], format: (value: string) => string): string {
  return window.open
    ? `Open until ${format(window.until)}: an agent of ${NODE_KEYS_SINCE} or later on a node without a key binds its own key by itself.`
    : `Closed since ${format(window.until)}: a node without a key needs an enrollment token, or extend NODE_AUTH_LEGACY_UPGRADE_UNTIL on the server.`;
}

export function readinessText(summary: CredentialSummary): { tone: Tone; text: string } {
  if (summary.mode === 'enforce') return { tone: 'success', text: 'The server runs in enforce mode.' };
  if (summary.enforceReady) return { tone: 'success', text: 'Ready for enforce: switching the server to NODE_AUTH_MODE=enforce would refuse no node that works today.' };
  const count = summary.blockers.length;
  return { tone: 'warning', text: `Not ready for enforce: ${count} ${count === 1 ? 'thing blocks' : 'things block'} it. Do not set NODE_AUTH_MODE=enforce on the server while any remains.` };
}

export interface BlockerView {
  code: string;
  title: string;
  whatToDo: string;
  count: number;
  nodes: EnforceBlocker['nodes'];
}
const BLOCKERS: Record<EnforceBlocker['code'], { title: string; whatToDo: string }> = {
  SERVER_KEY_UNAVAILABLE: {
    title: 'The server signing key cannot be read',
    whatToDo: 'Check that the key file ($MAGNUS_HOME/state/node-auth/server-signing-key.json, or NODE_AUTH_SERVER_KEY_PATH) exists and the server can read it, then restart the server. Back the file up with the database.',
  },
  NODES_WITHOUT_KEY: {
    title: 'Nodes still on the shared secret',
    whatToDo: `Upgrade their agents to ${NODE_KEYS_SINCE} or later: each binds its own key after its first heartbeat while the automatic upgrade window is open. After the window, enroll them with a token.`,
  },
  NODES_REVOKED: {
    title: 'Nodes whose keys were revoked',
    whatToDo: 'Enroll each one again: an administrator issues an enrollment token, then runs magnus-agent enroll on the node.',
  },
  NODES_NOT_SIGNING_EVIDENCE: {
    title: 'Agents that do not sign their evidence with their key yet',
    whatToDo: 'Upgrade them to the current agent. An agent with a key starts signing once a heartbeat reply tells it the server verifies node evidence.',
  },
  RECENT_SHARED_SECRET_USE: {
    title: 'Shared node secret or result key used in the last 24 hours',
    whatToDo: 'Upgrade or enroll the nodes listed. The count clears 24 hours after their last use of a shared credential.',
  },
  PENDING_BINDINGS: {
    title: 'Bindings waiting for an administrator',
    whatToDo: 'Review the pending bindings: compare each fingerprint with magnus-agent identity show on the host, then approve or reject it.',
  },
};
export function blockerView(blocker: EnforceBlocker): BlockerView {
  const known = BLOCKERS[blocker.code] ?? { title: blocker.code, whatToDo: 'See docs/NODE_CREDENTIALS.md in Magnus.' };
  return { code: blocker.code, count: blocker.count, nodes: blocker.nodes, ...known };
}

/** Whether the overview should raise the summary: something needs a person now, not just a migration step. */
export function summaryNeedsAttention(summary: CredentialSummary): string[] {
  const lines: string[] = [];
  if (summary.pendingBindings > 0) lines.push(`${summary.pendingBindings} key ${summary.pendingBindings === 1 ? 'binding waits' : 'bindings wait'} for an administrator`);
  if (summary.nodes.revoked > 0) lines.push(`${summary.nodes.revoked} ${summary.nodes.revoked === 1 ? 'node has its key' : 'nodes have their keys'} revoked and ${summary.nodes.revoked === 1 ? 'is' : 'are'} refused until enrolled again`);
  if (summary.blockers.some((blocker) => blocker.code === 'SERVER_KEY_UNAVAILABLE')) lines.push('the server signing key cannot be read');
  return lines;
}

/** Magnus refuses to approve a binding whose agent has gone quiet for seven days. */
export const bindingIsStale = (binding: PendingBinding, now = Date.now()): boolean => now - new Date(binding.lastSeenAt).getTime() > PENDING_BINDING_STALE_MS;

/** The confirmation an administrator reads before approving: everything needed to judge the host. */
export function approvalMessage(binding: PendingBinding): string {
  return [
    `Bind this key as the first credential of ${binding.nodeName ?? binding.nodeId}?`,
    '',
    `Key fingerprint: ${binding.keyFingerprint}`,
    `Host name the agent claims: ${binding.fqdn}`,
    `Address it called from: ${binding.peerAddress}`,
    `Address recorded for the node: ${binding.recordedAddress}`,
    '',
    'Run magnus-agent identity show on the host first: the fingerprints must match. Approve only a genuine host (behind NAT, or whose address changed).',
  ].join('\n');
}
export function rejectionMessage(binding: PendingBinding): string {
  return `Refuse key ${binding.keyFingerprint} for ${binding.nodeName ?? binding.nodeId}, sent from ${binding.peerAddress}? The node stays on the shared secret; enroll it with a token if the host is genuine.`;
}

export type DowngradeAction = DowngradeCheck['action'];
export interface DowngradeView {
  tone: Tone;
  title: string;
  /** Magnus's own sentence about this node and version. */
  detail: string;
  /** What the operator does, in order. */
  steps: string[];
  /** The server-side command, when there is one. */
  command: string | null;
}
const API = '"$MAGNUS_URL"';
export function downgradeView(check: DowngradeCheck): DowngradeView {
  if (check.action === 'none') return { tone: 'success', title: `Nothing to do for the node key: install ${check.to} as usual`, detail: check.detail, steps: [], command: null };
  if (check.action === 'enroll-instead') {
    return {
      tone: 'danger',
      title: `Do not install ${check.to} on this node`,
      detail: check.detail,
      steps: [`The server runs NODE_AUTH_MODE=enforce, which has no credential reset. Keep an agent of ${NODE_KEYS_SINCE} or later on this node.`],
      command: null,
    };
  }
  const path = check.resetPath ?? `/api/v1/nodes/${encodeURIComponent(check.nodeId)}/credentials/reset`;
  return {
    tone: 'warning',
    title: `Reset the node's credentials before installing ${check.to}`,
    detail: check.detail,
    steps: [
      "An administrator resets the node's credentials on the server with the command below. The UI does not offer this step.",
      'If the node runs NODE_AUTH_MODE=enforce in its agent .env, set it to compat and restart the agent.',
      `Install ${check.to}. Without the reset, Magnus refuses the older agent for this node.`,
      `Upgrading back to ${NODE_KEYS_SINCE} or later binds a new key by itself while the automatic upgrade window is open.`,
    ],
    command: `curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}' ${API}${path}`,
  };
}

/** A version the server accepts as `to`: numbers and dots, with an optional prerelease. */
export const looksLikeVersion = (text: string): boolean => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(text.trim());

/**
 * Key administration the browser cannot do yet: Magnus keeps these routes out of the browser class.
 * Each task is shown as instructions; `browserRoute` stays null until the owner allows the route, and a
 * button can then use it without changing the rest.
 */
export interface CredentialTask {
  id: 'list' | 'rotate' | 'revoke' | 'reset' | 'reenroll';
  title: string;
  /** Where the step runs. */
  where: 'node' | 'server';
  /** Roles the server requires, for a step that runs against its API. */
  roles: readonly ConsoleRole[] | null;
  commands: string[];
  effect: string;
  browserRoute: null;
}
export function credentialTasks(nodeId: string): CredentialTask[] {
  const node = encodeURIComponent(nodeId);
  const auth = '-H "Authorization: Bearer $TOKEN"';
  const json = `-H 'content-type: application/json' -d '{}'`;
  return [
    { id: 'list', title: 'List its keys', where: 'server', roles: ['ADMIN'], commands: [`curl ${auth} ${API}/api/v1/nodes/${node}/credentials`], effect: 'Key ids, fingerprints, status, origin and last use. Compare the fingerprint with magnus-agent identity show on the host.', browserRoute: null },
    { id: 'rotate', title: 'Rotate the key', where: 'node', roles: null, commands: ['magnus-agent identity rotate'], effect: 'A new key, signed for by the old one. The old key stays valid for 24 hours.', browserRoute: null },
    { id: 'revoke', title: 'Revoke the key', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/credentials/revoke`], effect: 'The agent is refused (NODE_CREDENTIAL_REVOKED) and the node stays closed to the shared secret until it is enrolled again.', browserRoute: null },
    { id: 'reenroll', title: 'Enroll it again with a token', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/enrollment-token`, "magnus-agent enroll --token-file /run/magnus/enrollment-token   # on the node"], effect: 'The token works once, for one hour. A new key replaces the old ones.', browserRoute: null },
    { id: 'reset', title: 'Move it back to the shared secret', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/credentials/reset`, 'magnus-agent identity reset   # then, on the node'], effect: 'Both sides forget the key: reset the server first. Not available in enforce mode.', browserRoute: null },
  ];
}
