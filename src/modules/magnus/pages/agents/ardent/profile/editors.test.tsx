// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubApi, stubBrowser, type, type Mounted } from '../../../../test-dom';
import type { ArdentProfileClient } from '../api';
import { IdentityFile, MemoryPanel, SettingsForm, SkillList } from './editors';

const REF = { nodeId: 'node-1', profileId: 'writer' };
let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

/** A client that answers every action with `answer` and records what it was asked. */
function fakeClient(answer: (action: string) => unknown) {
  const calls: Array<{ action: string; options: unknown }> = [];
  const client: ArdentProfileClient = {
    action: async (action, schema, options) => {
      calls.push({ action, options });
      return schema.parse(answer(action));
    },
    read: async (_resource, schema) => schema.parse({ history: [] }),
  };
  return { client, calls };
}

describe('the reusable profile editors', () => {
  it('save an identity file through the client they are given and report the new revision', async () => {
    const { client, calls } = fakeClient(() => ({ text: 'A careful cartographer.', revision: 'rev-2' }));
    const onSaved = vi.fn();
    view = await mount(<IdentityFile {...REF} client={client} kind="soul" entry={{ text: 'Draft', revision: 'rev-1' }} onSaved={onSaved} savedMessage="Applies from the agent's next turn." className="studio-panel" />);
    expect(view.container.querySelector('.studio-panel')?.textContent).toContain('SOUL.md');
    await type(view.container.querySelector('textarea'), 'A careful cartographer.');
    await click(button('Save'));
    expect(calls).toEqual([{ action: 'identity-save', options: { body: { text: 'A careful cartographer.', revision: 'rev-1' }, target: 'soul' } }]);
    expect(onSaved).toHaveBeenCalledWith({ text: 'A careful cartographer.', revision: 'rev-2' });
    expect(view.container.textContent).toContain("Applies from the agent's next turn.");
  });

  it('go to the node through Magnus by default, as the fleet profile page uses them', async () => {
    const api = stubApi(({ method, path }) => (method === 'POST' && path === '/ardent/installations/node-1/profiles/writer/action' ? { success: true, data: { revision: 'rev-9' } } : undefined));
    vi.stubGlobal('fetch', api.request);
    const onChange = vi.fn();
    view = await mount(<SkillList {...REF} initial={[{ name: 'research', description: 'Finds sources', hash: 'abc', enabled: true }]} initialRevision="rev-8" onChange={onChange} />);
    await click(button('Disable'));
    await settle();
    expect(api.mutations()).toEqual([{ method: 'POST', path: '/ardent/installations/node-1/profiles/writer/action', body: { action: 'skill-set', target: 'research', body: { enabled: false, revision: 'rev-8' } } }]);
    expect(onChange).toHaveBeenCalledWith([{ name: 'research', description: 'Finds sources', hash: 'abc', enabled: false }], 'rev-9');
    expect(view.container.textContent).toContain('Disabled');
  });

  it('switch a skill from its configured state and say when the running profile has not caught up', async () => {
    const { client, calls } = fakeClient(() => ({ revision: 'rev-3' }));
    view = await mount(<SkillList {...REF} client={client} initial={[{ name: 'web-research', description: 'Searches', hash: 'abc', enabled: true, running: false }]} initialRevision="rev-2" />);
    expect(view.container.textContent).toContain('Enabled — applies after restart');
    await click(button('Disable'));
    await settle();
    expect(calls).toEqual([{ action: 'skill-set', options: { body: { enabled: false, revision: 'rev-2' }, target: 'web-research' } }]);
    // Configured off and not running: nothing waits for a restart any more.
    expect(view.container.textContent).toContain('Disabled');
    expect(view.container.textContent).not.toContain('applies after restart');
  });

  it('name the raw editor the host offers when the form cannot read the configuration', async () => {
    view = await mount(<SettingsForm {...REF} entry={{ text: 'execution: [unclosed', revision: 'rev-1' }} section="providers" running={false} rawEditorHint="in Fleet details" />);
    expect(view.container.textContent).toContain('Edit it in Fleet details.');
    expect(view.container.textContent).not.toContain('Configuration tab');
  });

  it('save settings through the client and hand the host the saved configuration', async () => {
    const { client, calls } = fakeClient((action) => (action === 'config-validate' ? { valid: true } : { revision: 'rev-2' }));
    const onSaved = vi.fn();
    view = await mount(<SettingsForm {...REF} client={client} entry={{ text: 'execution:\n  backend: llamacpp\n', revision: 'rev-1' }} section="providers" running onSaved={onSaved} />);
    await click(button('Validate and save'));
    expect(calls.map((call) => call.action)).toEqual(['config-validate', 'config-save']);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 'rev-2' }));
  });

  it('let the host label private memory', async () => {
    view = await mount(<MemoryPanel {...REF} status={{ status: 'ready', agent_id: 'agent-1', workspace_id: 'ws-1', retrieval: 'hybrid', storage: 'sqlite', reason: null }} title="Private to this agent" placeholder="Search this agent's memory" />);
    expect(view.container.querySelector('h3')?.textContent).toBe('Private to this agent');
    expect(view.container.querySelector('input')?.getAttribute('placeholder')).toBe("Search this agent's memory");
  });
});
