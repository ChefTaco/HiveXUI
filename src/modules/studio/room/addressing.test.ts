import { describe, expect, it } from 'vitest';
import { conversation, revision } from '../test-fixtures';
import { addressing, mentionChoices, mentionedRoleKeys, postBody, recipientOptions } from './addressing';

const roles = revision().body.roles;
const team = conversation();

describe('composer addressing', () => {
  it('offers Team, the coordinator by name, then each other role', () => {
    expect(recipientOptions(roles).map((option) => option.label)).toEqual(['Team', 'Coordinator (Story Lead)', 'Worldbuilder', 'Continuity Editor']);
  });

  it('sends Team and Coordinator to the coordinator', () => {
    for (const choice of ['team', 'coordinator'] as const) {
      const route = addressing(team, choice, 'Where do we start?', roles);
      expect(route.roles.map((role) => role.key)).toEqual(['lead']);
      expect(route.summary).toBe('Story Lead answers.');
    }
  });

  it('lets @mentions replace the coordinator, in order of mention, ignoring unknown keys', () => {
    expect(mentionedRoleKeys('@world then @lead, @world and @nobody', roles)).toEqual(['world', 'lead']);
    const route = addressing(team, 'team', 'Ask @world first, then @lead', roles);
    expect(route.roles.map((role) => role.key)).toEqual(['world', 'lead']);
    expect(route.summary).toBe('Worldbuilder, then Story Lead answer in turn.');
  });

  it('adds mentions after a chosen role, and warns about a role without an agent', () => {
    const route = addressing(team, 'role:world', 'And @editor please check', roles);
    expect(route.roles.map((role) => role.key)).toEqual(['world', 'editor']);
    expect(route.problem).toMatch(/Continuity Editor has no bound agent/);
  });

  it('always goes to the role of a direct conversation, and starts nothing in a discussion', () => {
    expect(addressing(conversation({ kind: 'direct', role_key: 'world' }), 'coordinator', 'Hi @lead', roles).roles.map((role) => role.key)).toEqual(['world']);
    expect(addressing(conversation({ kind: 'discussion' }), 'team', 'A note', roles)).toMatchObject({ roles: [], problem: null });
  });

  it('builds the post with the recipient, thread and attachments', () => {
    expect(postBody({ body: '  Hello  ', choice: 'role:world', replyTo: 'msg_a', threadRoot: 'msg_b', attachments: ['fil_1'] })).toEqual({
      body_md: 'Hello',
      to: { kind: 'roles', roles: ['world'] },
      reply_to: 'msg_a',
      thread_root: 'msg_b',
      attachments: ['fil_1'],
    });
    expect(postBody({ body: 'Hi', choice: 'team' })).toEqual({ body_md: 'Hi', to: { kind: 'team' }, attachments: [] });
  });

  it('suggests roles by key or by a word of their name', () => {
    expect(mentionChoices(roles, 'wo').map((role) => role.key)).toEqual(['world']);
    expect(mentionChoices(roles, 'edi').map((role) => role.key)).toEqual(['editor']);
    expect(mentionChoices(roles, '')).toHaveLength(3);
  });
});
