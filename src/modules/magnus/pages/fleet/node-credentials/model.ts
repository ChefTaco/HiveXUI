// How per-node credentials read on screen, in plain words. The wording follows Magnus's
// docs/NODE_CREDENTIALS.md; nothing here talks to the API.
import type { Tone } from '@ui';
import type { ConsoleRole } from '../../../routes';
import type { CredentialSummary, DowngradeCheck, EnforceBlocker, NodeCredential, NodeKey, PendingBinding, ResetResult, RevokeResult } from './api';

/** The first agent release that has a node key. An older agent only knows the shared node secret. */
export const NODE_KEYS_SINCE = '2.10.0';
/**
 * The first agent release a server in enforce mode reaches: 2.10.0 and 2.10.1 refuse every signed managed
 * request (Magnus 3.0.0 reports them as AGENTS_NEED_UPGRADE).
 */
export const ENFORCE_REACHES_AGENTS_SINCE = '2.10.2';
/** Magnus refuses to approve a binding whose agent has not asked for this long. */
export const PENDING_BINDING_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** The server's address in the CLI steps the UI shows as text. */
const API = '"$MAGNUS_URL"';

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

/**
 * Where the mode comes from, from Magnus 3.0.0 on (`modeExplicit`): set in the server's environment, or the
 * default. Null for an older Magnus, which does not say.
 */
export function modeSourceText(summary: CredentialSummary): string | null {
  if (summary.modeExplicit === undefined) return null;
  return summary.modeExplicit
    ? `Set explicitly: NODE_AUTH_MODE=${summary.mode} in the server's environment.`
    : `The default: NODE_AUTH_MODE is not set, so the server runs in ${summary.mode} mode.`;
}

/**
 * The warning for a deprecated explicit compat or warn mode (Magnus 3.0.0 `modeDeprecated`), with Magnus's
 * own notice. Null when the mode is not deprecated or this Magnus does not say.
 */
export function deprecationView(summary: CredentialSummary): { title: string; notice: string } | null {
  if (!summary.modeDeprecated) return null;
  return {
    title: `NODE_AUTH_MODE=${summary.mode} is deprecated`,
    notice: summary.deprecationNotice?.trim()
      || 'An explicit compat or warn mode keeps the shared node secret working for this major release only; the next major removes it. Clear the blockers below, then remove NODE_AUTH_MODE from the server\'s environment so it runs in enforce mode.',
  };
}

export function readinessText(summary: CredentialSummary): { tone: Tone; text: string } {
  if (summary.mode === 'enforce') return { tone: 'success', text: 'The server runs in enforce mode.' };
  // From 3.0.0 enforce is the default: the switch is removing the explicit mode, not setting one.
  const defaultsToEnforce = summary.modeExplicit !== undefined;
  if (summary.enforceReady) {
    return {
      tone: 'success',
      text: defaultsToEnforce
        ? 'Ready for enforce: removing NODE_AUTH_MODE from the server\'s environment (enforce is the default) would refuse no node that works today.'
        : 'Ready for enforce: switching the server to NODE_AUTH_MODE=enforce would refuse no node that works today.',
    };
  }
  const count = summary.blockers.length;
  const advice = defaultsToEnforce
    ? 'Keep NODE_AUTH_MODE set on the server while any remains: without it the server runs in enforce mode, and refuses to start.'
    : 'Do not set NODE_AUTH_MODE=enforce on the server while any remains.';
  return { tone: 'warning', text: `Not ready for enforce: ${count} ${count === 1 ? 'thing blocks' : 'things block'} it. ${advice}` };
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
  AGENTS_NEED_UPGRADE: {
    title: 'Agents enforce mode cannot reach (2.10.0 or 2.10.1)',
    whatToDo: `Upgrade these agents to ${ENFORCE_REACHES_AGENTS_SINCE} or later. They refuse every signed managed request (agent upgrades, Embermend, skills), so in enforce mode nothing reaches them. While the server runs compat or warn, it upgrades them from the Nodes page with the shared secret; in enforce mode, switch the server to compat for the upgrade or upgrade them on the host.`,
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

export type ServerKeyRotation = NonNullable<CredentialSummary['serverKeyRotation']>;

export interface RotationStatusLine {
  tone: Tone;
  text: string;
}
/**
 * Where a server-key rotation stands (Magnus 3.0.0 `serverKeyRotation`) and the next step, in plain words.
 * `pinningNext` counts keyed nodes whose agents reported pinning the staged key in the last ten minutes.
 */
export function rotationStatus(rotation: ServerKeyRotation, format: (value: string) => string): RotationStatusLine[] {
  const { agents } = rotation;
  const lines: RotationStatusLine[] = [];
  if (rotation.next) {
    lines.push(agents.pinningNext >= agents.keyedNodes
      ? { tone: 'success', text: `Every keyed agent pins the staged key (${agents.pinningNext} of ${agents.keyedNodes}): it can be promoted.` }
      : { tone: 'info', text: `A next key is staged. ${agents.pinningNext} of ${agents.keyedNodes} keyed ${agents.keyedNodes === 1 ? 'node\'s agent pins' : 'nodes\' agents pin'} it; promote once all do (a few heartbeats). Magnus refuses an earlier promote with SERVER_KEY_NOT_PINNED.` });
  }
  if (rotation.previous) {
    lines.push(rotation.previous.inGrace
      ? { tone: 'info', text: `The replaced key is still accepted until ${format(rotation.previous.retireAfter)}; retire it after that.` }
      : { tone: 'warning', text: `The grace period of the replaced key ended ${format(rotation.previous.retireAfter)}: retire it.` });
  }
  if (lines.length === 0) lines.push({ tone: 'neutral', text: 'No rotation in progress. To replace the server key, stage a next key (steps below).' });
  return lines;
}

/** The pin counts for the active key, from the agents that reported in the last ten minutes. */
export function rotationPinsText(rotation: ServerKeyRotation): string {
  const { agents } = rotation;
  const parts = [`${agents.reporting} of ${agents.keyedNodes} keyed ${agents.keyedNodes === 1 ? 'node' : 'nodes'} reported in the last ten minutes`, `${agents.pinningActive} pin the active key`];
  if (rotation.next) parts.push(`${agents.pinningNext} pin the staged key`);
  return `${parts.join('; ')}.`;
}

export interface RunbookStep {
  title: string;
  commands: string[];
  effect: string;
}
/**
 * Rotating the server key, from Magnus's docs/NODE_CREDENTIALS.md ("Rotating the server key"). Its routes
 * are not browser routes, so the UI shows them as text: the Magnus API with an administrator's token, or
 * magnus-server on the server host.
 */
export function serverKeyRunbook(): RunbookStep[] {
  const auth = '-H "Authorization: Bearer $TOKEN" -H \'content-type: application/json\'';
  const route = (step: string) => `${API}/api/v1/node-credentials/server-key/${step}`;
  return [
    {
      title: 'Stage a next key',
      commands: [`curl -X POST ${auth} -d '{}' ${route('stage')}`, 'magnus-server node-auth server-key stage   # or, on the server host'],
      effect: 'Agents pin it from their next heartbeat. The server signs nothing with it yet.',
    },
    {
      title: 'Promote it once every keyed agent pins it',
      commands: [`curl -X POST ${auth} -d '{"graceHours":168}' ${route('promote')}`, 'magnus-server node-auth server-key promote --force --grace-hours 168   # or, on the server host'],
      effect: 'Wait until this panel shows every keyed agent pinning the staged key. The API refuses earlier with SERVER_KEY_NOT_PINNED; the command line cannot see the pins and always needs --force. The new key signs from then on, and the replaced key stays accepted for the grace period (default 7 days).',
    },
    {
      title: 'Retire the replaced key after its grace period',
      commands: [`curl -X POST ${auth} -d '{}' ${route('retire')}`, 'magnus-server node-auth server-key retire   # or, on the server host'],
      effect: 'Its private part is destroyed. Its public key is kept, so decisions it signed still verify.',
    },
    {
      title: 'Back up the key file and check',
      commands: ['magnus-server node-auth server-key status   # on the server host', 'magnus-agent identity show   # on a node'],
      effect: 'Each step changes $MAGNUS_HOME/state/node-auth/server-signing-key.json: back it up with the database. The server\'s start-up line shows the new fingerprint, and a node lists it first among its pinned server keys.',
    },
  ];
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
      "An administrator resets the node's credentials on the server: with Reset under Keys on this card, where this Magnus offers it, or with the command below.",
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
 * Key administration, as CLI and API steps. `browserRoute` names the Magnus browser route that does the
 * same step, for an administrator, from the card; rotating (on the node) and issuing an enrollment token
 * (its answer is a secret) have none.
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
  browserRoute: string | null;
}
/**
 * The steps to show as text. With `inBrowser`, the card offers the list, revoke and reset itself, so only
 * the steps the browser cannot take remain.
 */
export function credentialTasks(nodeId: string, { inBrowser = false }: { inBrowser?: boolean } = {}): CredentialTask[] {
  const node = encodeURIComponent(nodeId);
  const auth = '-H "Authorization: Bearer $TOKEN"';
  const json = `-H 'content-type: application/json' -d '{}'`;
  const tasks: CredentialTask[] = [
    { id: 'list', title: 'List its keys', where: 'server', roles: ['ADMIN'], commands: [`curl ${auth} ${API}/api/v1/nodes/${node}/credentials`], effect: 'Key ids, fingerprints, status, origin and last use. Compare the fingerprint with magnus-agent identity show on the host.', browserRoute: 'GET /nodes/{nodeId}/credentials' },
    { id: 'rotate', title: 'Rotate the key', where: 'node', roles: null, commands: ['magnus-agent identity rotate'], effect: 'A new key, signed for by the old one. The old key stays valid for 24 hours.', browserRoute: null },
    { id: 'revoke', title: 'Revoke the key', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/credentials/revoke`], effect: 'The agent is refused (NODE_CREDENTIAL_REVOKED) and the node stays closed to the shared secret until it is enrolled again.', browserRoute: 'POST /nodes/{nodeId}/credentials/revoke' },
    { id: 'reenroll', title: 'Enroll it again with a token', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/enrollment-token`, "magnus-agent enroll --token-file /run/magnus/enrollment-token   # on the node"], effect: 'The token works once, for one hour. A new key replaces the old ones. The UI does not issue tokens: the answer is a secret.', browserRoute: null },
    { id: 'reset', title: 'Move it back to the shared secret', where: 'server', roles: ['ADMIN'], commands: [`curl -X POST ${auth} ${json} ${API}/api/v1/nodes/${node}/credentials/reset`, 'magnus-agent identity reset   # then, on the node'], effect: 'Both sides forget the key: reset the server first. Not available in enforce mode.', browserRoute: 'POST /nodes/{nodeId}/credentials/reset' },
  ];
  return inBrowser ? tasks.filter((task) => task.browserRoute === null) : tasks;
}

const KEY_STATUSES: Record<NodeKey['status'], { label: string; tone: Tone }> = {
  ACTIVE: { label: 'active', tone: 'success' },
  RETIRING: { label: 'retiring', tone: 'warning' },
  REVOKED: { label: 'revoked', tone: 'danger' },
};
export const keyStatusView = (key: NodeKey): { label: string; tone: Tone } => KEY_STATUSES[key.status] ?? { label: key.status.toLowerCase(), tone: 'neutral' };

/** Keys a revoke without a key id would revoke: every one still valid. */
export const revocableKeys = (keys: readonly NodeKey[]): NodeKey[] => keys.filter((key) => key.status !== 'REVOKED');

/** What the operator reads before revoking every valid key of a node. */
export function revokeMessage(nodeName: string, keys: readonly NodeKey[]): string {
  const valid = revocableKeys(keys);
  return [
    `Revoke ${valid.length === 1 ? 'the key' : `all ${valid.length} valid keys`} of ${nodeName}?`,
    '',
    ...valid.map((key) => `Key fingerprint: ${key.keyFingerprint} (${keyStatusView(key).label})`),
    '',
    'What happens: Magnus refuses this node\'s agent from its next request (NODE_CREDENTIAL_REVOKED). It does not fall back to the shared secret. The agent stays refused until the node is enrolled again with a token, or its credentials are reset.',
  ].join('\n');
}

/**
 * What the operator reads before resetting a node's credentials. `window` is the automatic upgrade window
 * from the fleet summary, or null when this Magnus does not report it.
 */
export function resetMessage(nodeName: string, keyCount: number, window: CredentialSummary['legacyUpgrade'] | null, format: (value: string) => string): string {
  const rebind = window === null
    ? `While the automatic upgrade window is open, an agent of ${NODE_KEYS_SINCE} or later binds a new key by itself after its next heartbeat; once it is closed, the node stays on the shared secret until it is enrolled with a token.`
    : window.open
      ? `The automatic upgrade window is open until ${format(window.until)}, so an agent of ${NODE_KEYS_SINCE} or later binds a new key by itself after its next heartbeat.`
      : 'The automatic upgrade window is closed, so the node stays on the shared secret until it is enrolled with a token.';
  return [
    `Move ${nodeName} back to the shared secret?`,
    '',
    `What happens: Magnus forgets ${keyCount === 1 ? 'its key' : `its ${keyCount} keys`} and accepts the fleet-wide shared secret from this node again. ${rebind}`,
    '',
    'For an older agent, or to make the node forget its key too, run magnus-agent identity reset on the node afterwards.',
  ].join('\n');
}

/** Why Reset is not offered, or null when it is. */
export function resetUnavailable(keys: readonly NodeKey[], credential: NodeCredential, summary: CredentialSummary | null | undefined): string | null {
  if (summary?.mode === 'enforce') {
    // Magnus 3.0.0 says whether enforce is the default; its rollback is an explicit compat on the server.
    if (summary.modeExplicit === undefined) return 'The server runs NODE_AUTH_MODE=enforce, which has no credential reset.';
    return `The server runs in enforce mode${summary.modeExplicit ? '' : ' (the default)'}, which has no credential reset: Magnus refuses it. Revoke still works. Moving a node back to the shared secret needs an explicit NODE_AUTH_MODE=compat on the server first (deprecated).`;
  }
  if (keys.length === 0 && credential.state === 'none') return 'The node has no key: it already uses the shared secret.';
  return null;
}

/** Magnus's sentence after a revoke or reset, with what it means for the agent, for the card to keep showing. */
export function keyActionOutcome(kind: 'revoke', result: RevokeResult): { tone: Tone; title: string; detail: string };
export function keyActionOutcome(kind: 'reset', result: ResetResult): { tone: Tone; title: string; detail: string };
export function keyActionOutcome(kind: 'revoke' | 'reset', result: RevokeResult | ResetResult): { tone: Tone; title: string; detail: string } {
  if (kind === 'revoke') {
    const revoke = result as RevokeResult;
    return {
      tone: revoke.agentRefused ? 'danger' : 'warning',
      title: `${revoke.revoked} ${revoke.revoked === 1 ? 'key' : 'keys'} revoked${revoke.agentRefused ? ': the agent is refused until it is enrolled again' : ''}${revoke.agentRefused && revoke.resetAvailable ? ' or reset' : ''}`,
      detail: revoke.detail,
    };
  }
  const reset = result as ResetResult;
  return {
    tone: 'info',
    title: `${reset.removed} ${reset.removed === 1 ? 'key' : 'keys'} removed: the node uses the shared secret again${reset.legacyUpgradeOpen ? ' and binds a new key by itself' : ''}`,
    detail: reset.detail,
  };
}
