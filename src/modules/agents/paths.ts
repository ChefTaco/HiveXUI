// Pure path handling for Agent 360, shared by the route table and the page. Imports nothing, so it
// adds next to nothing to the main chunk.
export const AGENTS_PREFIX = '/agents';

/** One part of an agent reference: a Magnus node ID or a profile name, as Magnus checks it. */
const PART = /^[A-Za-z0-9._-]{1,128}$/;

export interface AgentRef {
  /** `<nodeId>~<profile>`, exactly as given. */
  agentRef: string;
  nodeId: string;
  profile: string;
}

/** `<magnusNodeId>~<profile>`, or null for anything Magnus would refuse. */
export function parseAgentRef(value: string | null | undefined): AgentRef | null {
  if (!value || value.length > 257) return null;
  const parts = value.split('~');
  if (parts.length !== 2) return null;
  const [nodeId, profile] = parts as [string, string];
  return PART.test(nodeId) && PART.test(profile) ? { agentRef: value, nodeId, profile } : null;
}

/** A HiveMem actor ID, the agent's identity in HiveMem, Emberpath and Cindertrace. */
export const isActorId = (value: string | null | undefined): value is string => !!value && /^[a-z0-9_-]{2,32}$/.test(value);
