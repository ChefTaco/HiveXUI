// Who a room message goes to, worked out the way the Studio service does (Team and Coordinator start
// a coordinator turn, a role or an @role_key mention one turn per addressee), so the composer can say
// who will answer before it is sent. Pure.
import type { Conversation, PostMessage, Recipient, TeamRevision } from '../api/endpoints';

export type Role = TeamRevision['body']['roles'][number];
/** The composer's recipient control: Team, Coordinator, or one role by key. */
export type RecipientChoice = 'team' | 'coordinator' | `role:${string}`;

const MENTION = /(^|[\s(,;])@([a-z][a-z0-9_-]{0,47})(?![a-z0-9_-])/g;

/** Role keys @mentioned in a message, in order of first mention. Unknown keys are ignored, as the service does. */
export function mentionedRoleKeys(body: string, roles: readonly Pick<Role, 'key'>[]): string[] {
  const known = new Set(roles.map((role) => role.key));
  const found: string[] = [];
  for (const match of body.matchAll(MENTION)) {
    const key = match[2]!;
    if (known.has(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

export function recipientOptions(roles: readonly Role[]): Array<{ value: RecipientChoice; label: string }> {
  const coordinator = roles.find((role) => role.coordinator);
  return [
    { value: 'team', label: 'Team' },
    { value: 'coordinator', label: coordinator ? `Coordinator (${coordinator.name})` : 'Coordinator' },
    ...roles.filter((role) => !role.coordinator).map((role) => ({ value: `role:${role.key}` as const, label: role.name })),
  ];
}

export function recipientOf(choice: RecipientChoice): Recipient {
  if (choice === 'team') return { kind: 'team' };
  if (choice === 'coordinator') return { kind: 'coordinator' };
  return { kind: 'roles', roles: [choice.slice('role:'.length)] };
}

export interface Addressing {
  /** The roles that will be asked to answer, in order. Empty for a discussion note. */
  roles: Role[];
  /** Why the message cannot start the turns it asks for; the service would answer 409. */
  problem: string | null;
  /** The line the composer shows: who answers. */
  summary: string;
}

/** Who a message starts turns for. Mirrors the service's rules, so the preview never promises a turn it refuses. */
export function addressing(conversation: Pick<Conversation, 'kind' | 'role_key'> | null, choice: RecipientChoice, body: string, roles: readonly Role[]): Addressing {
  if (conversation?.kind === 'discussion') return { roles: [], problem: null, summary: 'A note to the discussion. The next turns see it; it starts none.' };
  let keys: string[];
  if (conversation?.kind === 'direct') keys = conversation.role_key ? [conversation.role_key] : [];
  else {
    const mentions = mentionedRoleKeys(body, roles);
    const recipient = recipientOf(choice);
    if (recipient.kind === 'roles') keys = [...new Set([...recipient.roles, ...mentions])];
    else if (mentions.length) keys = mentions;
    else {
      const coordinator = roles.find((role) => role.coordinator);
      if (!coordinator) return { roles: [], problem: 'The team has no coordinator. Publish a team with one, or address a role.', summary: 'No coordinator' };
      keys = [coordinator.key];
    }
  }
  const chosen = keys.flatMap((key) => roles.filter((role) => role.key === key));
  if (chosen.length !== keys.length) return { roles: chosen, problem: 'This conversation names a role that is not in the published team.', summary: 'Unknown role' };
  const unbound = chosen.filter((role) => !role.agent_ref);
  if (unbound.length) return { roles: chosen, problem: `${unbound.map((role) => role.name).join(', ')} ${unbound.length === 1 ? 'has' : 'have'} no bound agent. Bind ${unbound.length === 1 ? 'it' : 'them'} in Team Assignment.`, summary: 'Unbound role' };
  const names = chosen.map((role) => role.name);
  const summary = names.length === 1 ? `${names[0]} answers.` : `${names.join(', then ')} answer in turn.`;
  return { roles: chosen, problem: null, summary };
}

/** The body of POST /conversations/:id/messages for what the composer holds. */
export function postBody(input: { body: string; choice: RecipientChoice; replyTo?: string | null; threadRoot?: string | null; attachments?: readonly string[] }): PostMessage {
  return {
    body_md: input.body.trim(),
    to: recipientOf(input.choice),
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    ...(input.threadRoot ? { thread_root: input.threadRoot } : {}),
    attachments: [...(input.attachments ?? [])],
  };
}

/** Roles whose key or name starts a word with what was typed after @, for the autocomplete list. */
export function mentionChoices(roles: readonly Role[], query: string): Role[] {
  const needle = query.toLowerCase();
  return roles
    .filter((role) => !needle || role.key.startsWith(needle) || role.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle)))
    .slice(0, 8);
}
