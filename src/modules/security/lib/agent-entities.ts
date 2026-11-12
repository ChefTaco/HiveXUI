// Agent entities: Cindertrace after 0.3.0 names an agent by `actor:<actorId>` and records its
// `agent-ref:<nodeId>~<profile>` and `magnus-node:<nodeId>` aliases. Case detail sends them as
// `aliasesJson`, a field the released browser contract does not describe yet, so they are read
// from the answer here with their own schema.
import { z } from 'zod';
import { parseAgentRef } from '../../agents/paths';

const MAX_ALIASES = 32;
const entityAliases = z.object({
  data: z.object({
    entities: z.array(
      z.object({ id: z.string(), aliasesJson: z.string().max(16_384).optional(), aliases: z.array(z.string()).max(MAX_ALIASES).optional() }),
    ),
  }),
});

function aliasList(entity: { aliasesJson?: string | undefined; aliases?: string[] | undefined }): string[] {
  if (entity.aliases) return entity.aliases;
  if (!entity.aliasesJson) return [];
  try {
    const value: unknown = JSON.parse(entity.aliasesJson);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_ALIASES) : [];
  } catch {
    return [];
  }
}

/** The agent reference an entity carries as `agent-ref:<nodeId>~<profile>`, or null. */
export function agentRefOf(canonical: string, aliases: readonly string[]): string | null {
  for (const value of [canonical, ...aliases]) {
    if (!value.startsWith('agent-ref:')) continue;
    const parsed = parseAgentRef(value.slice('agent-ref:'.length));
    if (parsed) return parsed.agentRef;
  }
  return null;
}

/** Each entity's aliases by entity ID, from a case detail answer. Empty when it sent none. */
export function caseEntityAliases(body: unknown): Map<string, string[]> {
  const parsed = entityAliases.safeParse(body);
  if (!parsed.success) return new Map();
  return new Map(parsed.data.data.entities.map((entity) => [entity.id, aliasList(entity)]));
}
