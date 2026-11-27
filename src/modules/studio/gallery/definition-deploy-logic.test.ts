import { describe, expect, it } from 'vitest';
import { StudioApiError } from '../api/client';
import { builtDefinition } from '../test-fixtures';
import { definitionNeeds, deployRefusal, deployRequests, preflightErrors, validateDeploy } from './definition-deploy-logic';

/** An obviously fake Emberpath client key. */
const KEY = 'fixture-emberpath-key-0011';
const alias = definitionNeeds(builtDefinition().definition);
const unbound = definitionNeeds(builtDefinition({ alias: null }).definition);
const codex = definitionNeeds(builtDefinition({ backend: 'codex', alias: null }).definition);
const form = { nodeId: 'node-1', profileId: 'archivist', alias: '' };

describe('Create agent from definition', () => {
  it('asks for the Emberpath key exactly when the model is an Emberpath alias, and for an alias when none is named', () => {
    expect(alias).toEqual({ emberpathKey: true, modelAlias: false, alias: 'research-large', required: ['hivemem'] });
    expect(unbound).toMatchObject({ emberpathKey: true, modelAlias: true, alias: null, required: ['hivemem', 'model'] });
    expect(codex).toMatchObject({ emberpathKey: false, modelAlias: true });
  });

  it('requires a valid key, profile and alias before anything is sent', () => {
    expect(validateDeploy(form, alias, '')).toEqual({ emberpathKey: 'Enter the Emberpath client key for this agent' });
    expect(validateDeploy(form, alias, 'has spaces in it 0001').emberpathKey).toMatch(/16 to 512 characters/);
    expect(validateDeploy(form, alias, KEY)).toEqual({});
    expect(validateDeploy({ nodeId: '', profileId: 'no spaces!', alias: 'bad alias' }, unbound, KEY)).toEqual({
      nodeId: expect.any(String), profileId: expect.any(String), alias: expect.any(String) });
    expect(validateDeploy(form, codex, '')).toEqual({ alias: expect.any(String) });
  });

  it('binds every required binding and carries the key only for an Emberpath alias', () => {
    expect(deployRequests(form, alias, KEY)).toEqual({
      check: { node_id: 'node-1', bindings: { hivemem: 'default' }, emberpath_client_key: KEY },
      deploy: { node_id: 'node-1', profile: 'archivist', bindings: { hivemem: 'default' }, emberpath_client_key: KEY },
    });
    expect(deployRequests({ ...form, alias: 'general' }, unbound, KEY).deploy.bindings).toEqual({ hivemem: 'default', model: 'general' });
    const plain = deployRequests({ ...form, alias: 'general' }, codex, KEY);
    expect(plain.check).not.toHaveProperty('emberpath_client_key');
    expect(plain.deploy).not.toHaveProperty('emberpath_client_key');
  });

  it('puts Magnus\'s Emberpath preflight problems beside their fields and lists the rest', () => {
    const problems = [
      { code: 'SECRET_UNBOUND', detail: 'Emberpath key missing: give emberpath_client_key, the client key created in Emberpath' },
      { code: 'SKILL_VERSION_UNAVAILABLE', detail: 'web-research 1.2.0 is not in the catalog' },
    ];
    expect(preflightErrors(problems, alias)).toEqual({ errors: { emberpathKey: expect.stringMatching(/^Emberpath key missing/) }, rest: [problems[1]] });
    expect(preflightErrors([{ code: 'SECRET_UNBOUND', detail: 'emberpath_client_key: Emberpath refused the client key (403)' }], alias).errors)
      .toEqual({ emberpathKey: 'Emberpath refused this key: Emberpath refused the client key (403)' });
    const model = { code: 'MISSING_BINDING', detail: 'model: the key may not use the alias general' };
    expect(preflightErrors([model], unbound)).toEqual({ errors: { alias: 'the key may not use the alias general' }, rest: [] });
    // Without the field on the form, the problem stays in the list.
    expect(preflightErrors([model], alias)).toEqual({ errors: {}, rest: [model] });
    expect(preflightErrors([{ code: 'SECRET_UNBOUND', detail: 'Emberpath key missing' }], codex).rest).toHaveLength(1);
  });

  it('maps refusals: PREFLIGHT_FAILED, Magnus\'s EMBERPATH_* codes and anything else', () => {
    const failed = new StudioApiError(409, 'The definition cannot be installed on this node: SECRET_UNBOUND', 'PREFLIGHT_FAILED', {
      problems: [{ code: 'SECRET_UNBOUND', detail: 'emberpath_client_key: Emberpath does not know the client key (401)' }, { code: 'MISSING_BINDING', detail: 'Bind hiveskills (hiveskills)' }] });
    expect(deployRefusal(failed, alias)).toEqual({ errors: { emberpathKey: expect.stringContaining('(401)') }, problems: [{ code: 'MISSING_BINDING', detail: 'Bind hiveskills (hiveskills)' }], message: null });
    expect(deployRefusal(new StudioApiError(422, 'x', 'EMBERPATH_KEY_INVALID'), alias)).toEqual({ errors: { emberpathKey: expect.stringMatching(/^Emberpath refused this key/) }, problems: [], message: null });
    expect(deployRefusal(new StudioApiError(400, 'x', 'EMBERPATH_KEY_REQUIRED'), alias).errors.emberpathKey).toMatch(/^Emberpath key missing/);
    expect(deployRefusal(new StudioApiError(422, 'x', 'EMBERPATH_ALIAS_UNAVAILABLE'), unbound).errors).toEqual({ alias: expect.stringMatching(/may not use the alias/) });
    expect(deployRefusal(new StudioApiError(422, 'x', 'EMBERPATH_ALIAS_UNAVAILABLE'), alias)).toMatchObject({ errors: {}, message: expect.stringMatching(/may not use the alias/) });
    expect(deployRefusal(new StudioApiError(409, 'x', 'EMBERPATH_NOT_EXPLICIT'), alias).message).toMatch(/MAGNUS_ARDENT_EMBERPATH_URL/);
    expect(deployRefusal(new StudioApiError(403, 'Magnus refused: not an ADMIN', 'ACTING_ADMIN_REQUIRED'), alias).message).toMatch(/Magnus ADMIN/);
    expect(deployRefusal(new StudioApiError(400, 'The request is invalid', 'VALIDATION_ERROR'), alias).message).toMatch(/release after 0\.7\.0/);
    expect(deployRefusal(new StudioApiError(409, 'This Magnus release has no agent definitions', 'MAGNUS_UPGRADE_REQUIRED'), alias).message).toBe('This Magnus release has no agent definitions');
  });
});
