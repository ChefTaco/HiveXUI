import { describe, expect, it } from 'vitest';
import { agentRefOf, caseEntityAliases } from './agent-entities';

describe('agent entity aliases', () => {
  it('read aliasesJson from a case detail answer, and aliases from an entity list', () => {
    const body = { success: true, data: { entities: [
      { id: 'ent-1', type: 'agent', canonical: 'actor:ardent-lead', aliasesJson: JSON.stringify(['actor:ardent-lead', 'magnus-node:node-1', 'agent-ref:node-1~lead']) },
      { id: 'ent-2', type: 'host', canonical: 'host:node-1' },
      { id: 'ent-3', type: 'agent', canonical: 'actor:other', aliases: ['agent-ref:node-2~other'] },
      { id: 'ent-4', type: 'agent', canonical: 'actor:broken', aliasesJson: '{not json' },
    ] } };
    const aliases = caseEntityAliases(body);
    expect(agentRefOf('actor:ardent-lead', aliases.get('ent-1')!)).toBe('node-1~lead');
    expect(aliases.get('ent-2')).toEqual([]);
    expect(agentRefOf('actor:other', aliases.get('ent-3')!)).toBe('node-2~other');
    expect(aliases.get('ent-4')).toEqual([]);
  });

  it('know a provisional agent by its canonical reference', () => {
    expect(agentRefOf('agent-ref:node-1~lead', [])).toBe('node-1~lead');
  });

  it('ignore anything that is not an agent reference', () => {
    expect(agentRefOf('actor:ardent-lead', ['magnus-node:node-1'])).toBeNull();
    expect(agentRefOf('actor:ardent-lead', ['agent-ref:node 1~lead', 'agent-ref:a~b~c', 'agent-ref:'])).toBeNull();
    expect(caseEntityAliases(null).size).toBe(0);
    expect(caseEntityAliases({ data: { entities: 'nope' } }).size).toBe(0);
  });
});
