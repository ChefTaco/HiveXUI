import { describe, expect, it } from 'vitest';
import type { ArdentInstallation } from '../schemas';
import {
  buildRequest,
  checklistSteps,
  DEPLOY_STEPS,
  emptyDraft,
  nodeChoices,
  receiptSummary,
  skillList,
  starterIdentity,
  stepLabel,
  stoppedAt,
  suggestPort,
  validateStep,
  type AgentOperation,
  type AgentStep,
  type NewAgentDraft,
} from './new-agent-logic';

const profile = (id: string, apiPort: number | null) => ({ id, name: id, backend: 'llamacpp', apiPort, running: true, a2aEnabled: false, channels: {}, error: null });
const node = (nodeId: string, patch: Partial<ArdentInstallation> = {}): ArdentInstallation => ({
  nodeId, nodeName: `${nodeId} name`, hostname: `${nodeId}.example.com`, reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator',
  profiles: [], checkedAt: '2026-11-08T00:00:00.000Z', capabilities: { studio: 1 }, ...patch,
});
const draft = (patch: Partial<NewAgentDraft> = {}): NewAgentDraft => ({ ...emptyDraft(), nodeId: 'node-1', profileId: 'scout', apiPort: '9911', alias: 'general', ...patch });
const step = (patch: Partial<AgentStep> & Pick<AgentStep, 'name'>): AgentStep => ({ status: 'succeeded', startedAt: null, finishedAt: null, receipt: null, error: null, ...patch });

describe('New Agent node choices', () => {
  it('offer only nodes whose agent reports the bridge, and say what the others need', () => {
    const choices = nodeChoices([
      node('old', { capabilities: undefined }),
      node('ready'),
      node('newer', { capabilities: { studio: 2 } }),
      node('bare', { installed: false }),
      node('gone', { reachable: false, error: 'connection refused' }),
    ]);
    expect(choices.map((choice) => [choice.installation.nodeId, choice.disabledReason])).toEqual([
      ['ready', null],
      ['newer', null],
      ['old', 'Upgrade the Magnus agent on old name'],
      ['bare', 'Install the Ardent package on bare name first'],
      ['gone', 'gone name is unreachable: connection refused'],
    ]);
  });

  it('suggest the first port from 9910 that no profile uses', () => {
    expect(suggestPort(node('n', { profiles: [profile('a', 9910), profile('b', 9912), profile('c', null)] }))).toBe(9911);
    expect(suggestPort(undefined)).toBe(9910);
  });
});

describe('New Agent validation', () => {
  const choices = nodeChoices([node('node-1', { profiles: [profile('lead', 9910)] }), node('node-2', { capabilities: { studio: 0 } })]);

  it('accepts a complete first step', () => {
    expect(validateStep(0, draft(), choices)).toEqual({});
  });

  it('checks the profile ID like the old form, and against the node', () => {
    expect(validateStep(0, draft({ profileId: 'has space' }), choices).profileId).toMatch(/letters, digits/);
    expect(validateStep(0, draft({ profileId: '' }), choices).profileId).toBeDefined();
    expect(validateStep(0, draft({ profileId: 'lead' }), choices).profileId).toBe('A profile with this ID already exists on the node');
  });

  it('refuses a port out of range or in use, and a node without the bridge', () => {
    expect(validateStep(0, draft({ apiPort: '80' }), choices).apiPort).toBe('Choose a port from 1024 to 65535');
    expect(validateStep(0, draft({ apiPort: '9910.5' }), choices).apiPort).toBeDefined();
    expect(validateStep(0, draft({ apiPort: '9910' }), choices).apiPort).toBe('Port 9910 is assigned to another profile');
    expect(validateStep(0, draft({ nodeId: 'node-2' }), choices).nodeId).toBe('Upgrade the Magnus agent on node-2 name');
    expect(validateStep(0, draft({ nodeId: '' }), choices).nodeId).toBe('Choose a node');
  });

  it('needs both identity files, within 128 KiB', () => {
    expect(validateStep(1, draft({ soul: '  \n' }), choices)).toEqual({ soul: 'SOUL.md cannot be empty' });
    expect(validateStep(1, draft({ identity: 'x'.repeat(131_073) }), choices)).toEqual({ identity: 'IDENTITY.md is limited to 128 KiB' });
  });

  it('checks the model the way Magnus does', () => {
    expect(validateStep(2, draft({ alias: '' }), choices).alias).toBeDefined();
    expect(validateStep(2, draft({ alias: 'qwen3:32b/q4' }), choices)).toEqual({});
    const llama = { modelKind: 'llamacpp' as const, model: 'local' };
    expect(validateStep(2, draft({ ...llama, baseUrl: 'http://192.0.2.20:8080/v1' }), choices)).toEqual({});
    expect(validateStep(2, draft({ ...llama, baseUrl: 'http://user:secret@192.0.2.20:8080' }), choices).baseUrl).toMatch(/without credentials/);
    expect(validateStep(2, draft({ ...llama, baseUrl: 'ftp://192.0.2.20' }), choices).baseUrl).toBeDefined();
    expect(validateStep(2, draft({ ...llama, baseUrl: 'http://192.0.2.20', model: ' ' }), choices).model).toBeDefined();
  });

  it('merges chosen and typed skills and rejects bad names', () => {
    expect(skillList({ skills: ['research'], extraSkills: ' summaries, research ,,' })).toEqual(['research', 'summaries']);
    expect(validateStep(2, draft({ extraSkills: 'ok, not ok' }), choices).skills).toMatch(/not ok/);
  });
});

describe('the New Agent request', () => {
  it('carries the draft with HiveMem on and the chosen artifact limit', () => {
    expect(buildRequest(draft({ skills: ['research'], extraSkills: 'notes' }))).toEqual({
      nodeId: 'node-1', profile: 'scout', apiPort: 9911, soul_md: emptyDraft().soul, identity_md: starterIdentity(''),
      model: { emberpath_alias: 'general' }, skills: ['research', 'notes'], hivemem: true, artifacts_max_bytes: 64 * 1024 * 1024,
    });
    expect(buildRequest(draft({ modelKind: 'llamacpp', baseUrl: 'http://192.0.2.20:8080/v1', model: 'local' })).model).toEqual({ base_url: 'http://192.0.2.20:8080/v1', model: 'local' });
  });

  it('names the agent in the starter identity', () => {
    expect(starterIdentity('scout')).toContain('You are scout,');
  });
});

describe('operation receipts', () => {
  it('read as one line per step and never show a stored plan', () => {
    expect(receiptSummary(step({ name: 'profile-create', receipt: { apiPort: 9911, version: '2.2.0' } }))).toBe('API port 9911 · Ardent 2.2.0');
    expect(receiptSummary(step({ name: 'hivemem-enroll', receipt: { plan: { key: 'k' }, agentId: 'ardent-node-1-scout', workspaceId: 'ws-1', action: 'enroll' } }))).toBe('Agent ardent-node-1-scout · workspace ws-1');
    expect(receiptSummary(step({ name: 'skill-set', receipt: { enabled: ['notes'], alreadyEnabled: ['research'] } }))).toBe('Enabled notes · already enabled: research');
    expect(receiptSummary(step({ name: 'config-save', receipt: { revision: 'abcdef0123456789', notes: ['artifacts.max_bytes needs Ardent 2.2.0 or later'] } }))).toBe('Revision abcdef012345 · artifacts.max_bytes needs Ardent 2.2.0 or later');
    expect(receiptSummary(step({ name: 'identity-soul', status: 'skipped', receipt: { revision: 'r', unchanged: true } }))).toBe('Already as requested');
    expect(receiptSummary(step({ name: 'ready-probe', receipt: { attempts: 2, memory: 'ready', version: '2.2.0' } }))).toBe('HiveMem ready · after 2 checks · Ardent 2.2.0');
    expect(receiptSummary(step({ name: 'service-start', status: 'failed', error: 'unit failed' }))).toBe('unit failed');
    expect(receiptSummary(step({ name: 'service-restart', status: 'running' }))).toBe('Working…');
    expect(receiptSummary(step({ name: 'service-restart', status: 'pending' }))).toBe('');
  });

  it('label the configuration step by what the operation writes', () => {
    expect(stepLabel('config-save', 'deploy')).toBe('Configure model, memory and artifacts');
    expect(stepLabel('config-save', 'hivemem')).toBe('Configure memory');
  });

  it('name the step a failed operation stopped at', () => {
    const failed = checklistSteps(null, DEPLOY_STEPS).map((item) => (item.name === 'hivemem-enroll' ? { ...item, status: 'failed' as const, error: 'unavailable' } : item));
    expect(stoppedAt({ kind: 'deploy', steps: failed, error: 'hivemem-enroll: unavailable' } as AgentOperation)).toBe('Stopped at "Enroll the HiveMem identity".');
    expect(stoppedAt(null)).toBe('The operation stopped.');
  });

  it('list the planned steps, pending, until the operation reports', () => {
    expect(checklistSteps(null, DEPLOY_STEPS).map((item) => [item.name, item.status])).toEqual(DEPLOY_STEPS.map((name) => [name, 'pending']));
  });
});
