// What the operator reads when a terminal cannot start or has ended. Fixed sentences only: nothing a
// node or an upstream wrote is shown, apart from the gateway's own fixed refusal text as a fallback.
export interface TerminalNotice {
  tone: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
}

const REASONS: Readonly<Record<string, TerminalNotice>> = {
  'client-closed': { tone: 'info', title: 'Terminal closed', message: 'This session was closed.' },
  'remote-ended': { tone: 'info', title: 'Shell ended', message: 'The shell on the node has exited.' },
  'connection-lost': { tone: 'danger', title: 'Connection lost', message: 'The SSH connection to the node was lost. Anything it was running may still be running.' },
  'token-revoked': { tone: 'warning', title: 'Sign-in revoked', message: 'Your sign-in was revoked, so this shell was ended.' },
  'token-expired': { tone: 'warning', title: 'Sign-in expired', message: 'Your sign-in expired before it was renewed, so this shell was ended. This also happens when a tab is asleep.' },
  'authority-lost': { tone: 'warning', title: 'Permission removed', message: 'You no longer hold the terminal permission, so this shell was ended.' },
  'idle-timeout': { tone: 'warning', title: 'Ended for inactivity', message: 'No input was sent for too long, so the gateway ended this shell. Output does not count as activity.' },
  'max-lifetime': { tone: 'warning', title: 'Time limit reached', message: 'This session reached its maximum lifetime, so the gateway ended it.' },
  detached: { tone: 'warning', title: 'Disconnected too long', message: 'This browser could not read the session for too long, so the gateway ended it.' },
  'gateway-shutdown': { tone: 'warning', title: 'Gateway restarted', message: 'The fleet gateway shut down, which ends every shell.' },
  'audit-unavailable': { tone: 'danger', title: 'Audit unavailable', message: 'The session could not be recorded in the audit log, so the gateway ended it.' },
  'output-overflow': { tone: 'danger', title: 'Too much output', message: 'The node sent output faster than this browser could read it, so the gateway ended the session.' },
};

export const endedNotice = (reason: string): TerminalNotice => (Object.hasOwn(REASONS, reason) ? REASONS[reason]! : { tone: 'warning', title: 'Session ended', message: 'The gateway ended this session.' });

export const SIGNED_OUT: TerminalNotice = { tone: 'info', title: 'Signed out', message: 'You signed out, so this shell was closed.' };
export const SIGN_IN_AGAIN: TerminalNotice = { tone: 'warning', title: 'Sign in again', message: 'The gateway no longer accepts your sign-in, so this shell has ended.' };
export const NO_AUTHORITY: TerminalNotice = { tone: 'warning', title: 'Not permitted', message: 'The gateway no longer allows you this terminal.' };
export const SESSION_GONE: TerminalNotice = { tone: 'warning', title: 'Session ended', message: 'The gateway no longer knows this session. It has ended.' };
export const UNREACHABLE: TerminalNotice = { tone: 'danger', title: 'Connection lost', message: 'The fleet gateway could not be reached for a minute, so this terminal was given up. The gateway ends a shell nobody is reading.' };
export const INPUT_LOST: TerminalNotice = { tone: 'warning', title: 'Input may be lost', message: 'Something you typed may not have reached the node, and it was not sent again. Check the shell before you continue.' };
export const INPUT_STALLED: TerminalNotice = { tone: 'warning', title: 'Input not accepted', message: 'The node stopped accepting input, so what was waiting was dropped. Check the shell before you continue.' };
export const VERIFIED: TerminalNotice = { tone: 'info', title: 'Identity verified', message: 'Open the terminal again to start the session.' };
export const VERIFY_FIRST: TerminalNotice = { tone: 'warning', title: 'Verify your identity', message: 'A terminal needs a recent identity check. Verify your identity, then open it again.' };

/** Refusals that need an operator on the gateway. Trying again changes nothing, and a changed key can mean an attack. */
const REFUSALS: Readonly<Record<string, TerminalNotice & { final?: boolean }>> = {
  HOST_KEY_UNTRUSTED: { final: true, tone: 'warning', title: 'Host key not approved', message: 'No SSH host key has been approved for this node, so the gateway will not connect. An operator approves it on the gateway with magnus-fleet-gateway trust add, after comparing it with the key on the node.' },
  HOST_KEY_CHANGED: { final: true, tone: 'danger', title: 'Host key changed', message: 'The node presented an SSH host key that was not approved, which can mean an attack. The gateway did not log in. An operator must compare the key on the node before approving it with magnus-fleet-gateway trust rotate.' },
  NODE_TARGET_CHANGED: { final: true, tone: 'danger', title: 'Node address changed', message: 'The node no longer matches its approved host record, so the gateway did not connect. An operator must review the record.' },
  NODE_TARGET_REFUSED: { final: true, tone: 'warning', title: 'Node not reachable by terminal', message: 'The gateway does not dial this node’s address.' },
  FORBIDDEN: { final: true, tone: 'warning', title: 'Not permitted', message: 'The web terminal needs an administrator link and the terminal permission.' },
  RESOURCE_ADMISSION_REFUSED: { final: true, tone: 'warning', title: 'Terminal not available on this node', message: 'Resource coordination does not currently allow a terminal here, because the node is enrolled or draining.' },
  NODE_NOT_FOUND: { final: true, tone: 'warning', title: 'Node not found', message: 'The gateway does not know this node.' },
  SESSION_LIMIT_REACHED: { tone: 'warning', title: 'Too many terminals', message: 'You have the most terminals allowed open. Close one, then try again.' },
  RATE_LIMITED: { tone: 'warning', title: 'Too many attempts', message: 'Too many terminals were opened recently. Wait a minute, then try again.' },
  SSH_CONNECT_FAILED: { tone: 'danger', title: 'SSH connection failed', message: 'The gateway could not connect to the node over SSH.' },
  CONTROL_API_UNAVAILABLE: { tone: 'danger', title: 'Magnus API unavailable', message: 'The gateway could not reach the Magnus API.' },
  TRUST_STORE_UNAVAILABLE: { tone: 'danger', title: 'Host key store unavailable', message: 'The gateway could not read its approved host keys, so it refuses every connection.' },
  AUDIT_UNAVAILABLE: { tone: 'danger', title: 'Audit unavailable', message: 'The session could not be recorded, so it was not opened.' },
  GATEWAY_STOPPING: { tone: 'warning', title: 'Gateway restarting', message: 'The fleet gateway is shutting down. Try again shortly.' },
};

export function refusedNotice(code: string | undefined, fallback: string): { notice: TerminalNotice; final: boolean } {
  const known = code !== undefined && Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : null;
  if (!known) return { notice: { tone: 'danger', title: 'The terminal could not open', message: fallback }, final: false };
  const { final = false, ...notice } = known;
  return { notice, final };
}
