// Create agent from definition: what an agent template version's definition needs from the person, the
// request ArdentStudio relays to Magnus, and where each refusal belongs. An Emberpath-alias definition needs
// the Emberpath client key, which is write-only: it lives in the form only until the requests that carry it
// are sent, and is never part of the draft.
import { emberpathKeyError, emberpathRefusal } from '../../magnus/pages/agents/ardent/profiles/new-agent-logic';
import { errorMessage } from '../../magnus/api/errors';
import { StudioApiError } from '../api/client';
import type { BuiltDefinition, DefinitionDeploy, DeployCheck, DeployCheckResult } from '../api/endpoints';

type Definition = BuiltDefinition['definition'];
export type PreflightProblem = DeployCheckResult['preflight']['problems'][number];

export interface DefinitionNeeds {
  /** The model is an Emberpath alias (a llamacpp agent), so the agent needs an Emberpath client key. */
  emberpathKey: boolean;
  /** The definition names no alias, so the person binds one. */
  modelAlias: boolean;
  /** The alias the definition names, if any. */
  alias: string | null;
  /** Every required binding key. */
  required: string[];
}

export function definitionNeeds(definition: Definition): DefinitionNeeds {
  const required = definition.requirements.bindings.filter((item) => item.required).map((item) => item.key);
  return {
    emberpathKey: definition.config.execution.backend === 'llamacpp',
    modelAlias: required.includes('model'),
    alias: definition.config.model.emberpath_alias ?? null,
    required,
  };
}

export interface DeployForm {
  nodeId: string;
  profileId: string;
  /** The Emberpath alias bound to `model` when the definition names none. */
  alias: string;
}
export type DeployField = 'nodeId' | 'profileId' | 'alias' | 'emberpathKey';
export type DeployErrors = Partial<Record<DeployField, string>>;

const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

export function validateDeploy(form: DeployForm, needs: DefinitionNeeds, emberpathKey: string): DeployErrors {
  const errors: DeployErrors = {};
  if (!form.nodeId) errors.nodeId = 'Choose the node the agent runs on';
  if (!PROFILE_ID.test(form.profileId)) errors.profileId = 'A profile ID is 1 to 64 letters, digits, hyphens or underscores';
  if (needs.modelAlias && !ALIAS.test(form.alias)) errors.alias = 'Enter the Emberpath alias the agent uses: letters, digits and ._:/-';
  if (needs.emberpathKey) {
    const keyError = emberpathKeyError(emberpathKey);
    if (keyError) errors.emberpathKey = keyError;
  }
  return errors;
}

/** Every required binding: HiveMem and HiveSkills to Magnus's own (`default`), the model to the alias given. */
export function deployBindings(form: DeployForm, needs: DefinitionNeeds): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const key of needs.required) {
    if (key === 'model') bindings.model = form.alias;
    else if (key === 'hivemem' || key === 'hiveskills') bindings[key] = 'default';
  }
  return bindings;
}

/** The deploy check and the deploy. Only an Emberpath-alias definition carries the key. */
export function deployRequests(form: DeployForm, needs: DefinitionNeeds, emberpathKey: string): { check: DeployCheck; deploy: DefinitionDeploy } {
  const bindings = deployBindings(form, needs);
  const key = needs.emberpathKey ? { emberpath_client_key: emberpathKey } : {};
  return {
    check: { node_id: form.nodeId, bindings, ...key },
    deploy: { node_id: form.nodeId, profile: form.profileId, bindings, ...key },
  };
}

const after = (detail: string, prefix: string) => detail.slice(prefix.length).trim();

/**
 * Magnus's preflight problems, the Emberpath ones beside their fields: SECRET_UNBOUND "Emberpath key missing"
 * or "emberpath_client_key: …" on the key, MISSING_BINDING "model: …" on the alias. The rest are listed.
 */
export function preflightErrors(problems: readonly PreflightProblem[], needs: DefinitionNeeds): { errors: DeployErrors; rest: PreflightProblem[] } {
  const errors: DeployErrors = {};
  const rest: PreflightProblem[] = [];
  for (const problem of problems) {
    if (problem.code === 'SECRET_UNBOUND' && problem.detail.startsWith('Emberpath key missing')) errors.emberpathKey ??= emberpathRefusal('EMBERPATH_KEY_REQUIRED')!.message;
    else if (problem.code === 'SECRET_UNBOUND' && problem.detail.startsWith('emberpath_client_key:')) errors.emberpathKey ??= `Emberpath refused this key: ${after(problem.detail, 'emberpath_client_key:')}`;
    else if (problem.code === 'MISSING_BINDING' && problem.detail.startsWith('model:') && needs.modelAlias) errors.alias ??= after(problem.detail, 'model:');
    else rest.push(problem);
  }
  // A field the form does not show keeps its problem in the list.
  if (errors.emberpathKey && !needs.emberpathKey) {
    rest.push({ code: 'SECRET_UNBOUND', detail: errors.emberpathKey });
    delete errors.emberpathKey;
  }
  return { errors, rest };
}

export interface DeployRefusal { errors: DeployErrors; problems: PreflightProblem[]; message: string | null }

const MESSAGES: Readonly<Record<string, string>> = {
  ACTING_ADMIN_REQUIRED: 'Creating an agent needs a Magnus ADMIN: link your account to a Magnus administrator.',
};

/** Where a refused check or deploy belongs: beside a field, as preflight problems, or as one message. */
export function deployRefusal(error: unknown, needs: DefinitionNeeds): DeployRefusal {
  const code = error instanceof StudioApiError ? error.code : undefined;
  if (code === 'PREFLIGHT_FAILED' && error instanceof StudioApiError) {
    const raw = (error.details as { problems?: unknown } | undefined)?.problems;
    const problems = Array.isArray(raw) ? raw.filter((item): item is PreflightProblem => typeof item?.code === 'string' && typeof item?.detail === 'string') : [];
    const { errors, rest } = preflightErrors(problems, needs);
    return { errors, problems: rest, message: problems.length ? null : errorMessage(error, 'The definition cannot be installed on this node') };
  }
  const refusal = emberpathRefusal(code);
  if (refusal?.field === 'emberpathKey' && needs.emberpathKey) return { errors: { emberpathKey: refusal.message }, problems: [], message: null };
  if (refusal?.field === 'alias' && needs.modelAlias) return { errors: { alias: refusal.message }, problems: [], message: null };
  if (refusal) return { errors: {}, problems: [], message: refusal.message };
  if (error instanceof StudioApiError && error.status === 400 && code === 'VALIDATION_ERROR') return { errors: {}, problems: [], message: 'Studio refused the request: check the fields, and that ArdentStudio takes Emberpath keys (the release after 0.7.0).' };
  return { errors: {}, problems: [], message: (code && MESSAGES[code]) ?? errorMessage(error, 'The agent could not be created') };
}
