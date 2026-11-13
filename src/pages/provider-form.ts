import { z } from 'zod';
import type { Provider, ProviderModel, ProviderModelWriteRequest } from '../lib/types';
import { formatJson, parseJsonObject } from '../lib/format';
import {providerSchema, providerModelSchema, providerRedactedValue, providerWriteErrorCodes} from '@contracts/emberpath-model-admin.generated';

function parseStringRecord(value: string): Record<string, string> {
  const parsed = parseJsonObject(value);
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== 'string') {
      throw new Error('Header ' + key + ' must be a string');
    }
  }
  return parsed as Record<string, string>;
}

export function parseProviderModels(value: string): ProviderModelWriteRequest[] {
  return z.array(providerModelSchema).parse(JSON.parse(value) as unknown);
}

/** Read DTO rows contain persistence metadata and JSON text; writes do not. */
export function providerModelForWrite(model: Pick<ProviderModel, 'model'> & Partial<Pick<ProviderModel, 'capabilityJson' | 'displayName' | 'enabled' | 'maxContextWindow'>>): ProviderModelWriteRequest {
  let capabilities: Record<string, unknown> | undefined;
  if (model.capabilityJson !== undefined && model.capabilityJson !== null) {
    try { capabilities = parseJsonObject(model.capabilityJson); }
    catch { throw new Error('Model "' + model.model + '" has invalid capability JSON; repair it before editing this provider.'); }
  }
  return providerModelSchema.parse({
    model: model.model,
    ...(model.displayName !== null && model.displayName !== undefined ? {displayName: model.displayName} : {}),
    ...(model.enabled !== undefined ? {enabled: model.enabled} : {}),
    ...(model.maxContextWindow !== null && model.maxContextWindow !== undefined ? {maxContextWindow: model.maxContextWindow} : {}),
    ...(capabilities !== undefined ? {capabilityJson: capabilities} : {}),
  });
}

export interface ProviderForm {
  slug: string;
  name: string;
  kind: string;
  baseUrl: string;
  authMode: string;
  authHeaderName: string;
  authSecret: string;
  defaultHeaders: string;
  capabilities: string;
  models: string;
  timeoutMs: string;
  maxRetries: string;
  concurrency: string;
  priority: string;
  weight: string;
  failoverGroup: string;
  enabled: boolean;
}

export function emptyForm(): ProviderForm {
  return {
    slug: '',
    name: '',
    kind: 'OPENAI_GENERIC',
    baseUrl: 'https://api.openai.com/v1',
    authMode: 'BEARER',
    authHeaderName: 'Authorization',
    authSecret: '',
    defaultHeaders: '{}',
    capabilities: '{}',
    models: '[]',
    timeoutMs: '120000',
    maxRetries: '1',
    concurrency: '16',
    priority: '100',
    weight: '100',
    failoverGroup: '',
    enabled: true,
  };
}

export function formFromProvider(provider: Provider): ProviderForm {
  return {
    slug: provider.slug,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    authMode: provider.authMode,
    authHeaderName: provider.authHeaderName,
    authSecret: '',
    defaultHeaders: formatJson(provider.defaultHeaders ?? {}),
    capabilities: formatJson(provider.capabilities ?? {}),
    models: formatJson((provider.models ?? []).map(providerModelForWrite)),
    timeoutMs: String(provider.timeoutMs),
    maxRetries: String(provider.maxRetries),
    concurrency: String(provider.concurrency),
    priority: String(provider.priority),
    weight: String(provider.weight),
    failoverGroup: provider.failoverGroup ?? '',
    enabled: provider.enabled,
  };
}

export function providerFormForWrite(form: ProviderForm): z.output<typeof providerSchema> {
  return providerSchema.parse({
    slug: form.slug.trim(),
    name: form.name.trim(),
    kind: form.kind,
    baseUrl: form.baseUrl.trim(),
    authMode: form.authMode,
    authHeaderName: form.authHeaderName.trim() || 'Authorization',
    ...(form.authSecret ? { authSecret: form.authSecret } : {}),
    defaultHeaders: parseStringRecord(form.defaultHeaders),
    capabilities: parseJsonObject(form.capabilities),
    models: parseProviderModels(form.models),
    timeoutMs: Number(form.timeoutMs),
    maxRetries: Number(form.maxRetries),
    concurrency: Number(form.concurrency),
    priority: Number(form.priority),
    weight: Number(form.weight),
    ...(form.failoverGroup.trim() ? { failoverGroup: form.failoverGroup.trim() } : {}),
    enabled: form.enabled,
  });
}

/** Scheme, host and port: the server a stored credential was entered for. */
export function providerOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Emberpath before `hasAuthSecret` only sent the masked secret. */
export function hasStoredSecret(provider: Pick<Provider, 'authSecretMasked' | 'hasAuthSecret'>): boolean {
  return provider.hasAuthSecret ?? provider.authSecretMasked !== null;
}

/** Header names in the form whose value is still the hidden stand-in. */
function standInHeaders(defaultHeaders: string): string[] {
  try {
    return Object.entries(parseJsonObject(defaultHeaders)).filter(([, value]) => value === providerRedactedValue).map(([name]) => name);
  } catch {
    return []; // Invalid JSON is reported when the form is saved.
  }
}

export interface ProviderCredentialProblem {
  /** What the operator has to do, in plain words. */
  message: string;
  /** The Auth Secret field is what needs attention. */
  secret: boolean;
  /** Default headers that need a real value. */
  headers: string[];
}

/**
 * Stored credentials stay with the server they were entered for. When the form points an existing
 * provider at another server, the secret and the hidden header values have to be typed again:
 * Emberpath refuses the save otherwise, and this says so before it is sent. Also catches a hidden
 * stand-in used where nothing is stored, which must never be saved as if it were a value.
 */
export function providerCredentialProblem(editing: Provider | null, form: ProviderForm): ProviderCredentialProblem | null {
  const hidden = standInHeaders(form.defaultHeaders);
  const storedHidden = new Set((editing?.redactedDefaultHeaders ?? []).map((name) => name.toLowerCase()));
  const notStored = hidden.filter((name) => !storedHidden.has(name.toLowerCase()));
  if (notStored.length > 0) {
    return {secret: false, headers: notStored,
      message: `"${providerRedactedValue}" only stands for a value Emberpath already stores. Enter the real value for ${quoteList(notStored)}, or remove ${notStored.length === 1 ? 'it' : 'them'}.`};
  }
  if (!editing) return null;
  const from = providerOrigin(editing.baseUrl), to = providerOrigin(form.baseUrl);
  // An address that is not a URL yet is reported by the save itself.
  if (to === null || from === to) return null;
  const secret = hasStoredSecret(editing) && !form.authSecret && form.authMode !== 'NONE';
  if (!secret && hidden.length === 0) return null;
  const moved = `The base URL now points to a different server (${to})${from ? ` than the one the stored credentials were entered for (${from})` : ''}. Stored credentials are not sent to a new server automatically.`;
  if (secret && editing.kind === 'CODEX') {
    return {secret: true, headers: hidden, message: `${moved} This provider signs in through OpenAI, so there is no secret to type again: use Authorize Codex, or delete the provider.`};
  }
  const steps = [
    ...(secret ? ['enter the auth secret again (or set Auth Mode to NONE to remove it)'] : []),
    ...(hidden.length > 0 ? [`replace ${providerRedactedValue} with the real value for ${quoteList(hidden)}, or remove ${hidden.length === 1 ? 'that header' : 'those headers'}`] : []),
  ];
  return {secret, headers: hidden, message: `${moved} To save, ${steps.join(', and ')}.`};
}

function quoteList(names: string[]): string {
  return names.map((name) => `"${name}"`).join(', ');
}

/** Emberpath's refusal codes for a provider save, in the words this page uses. Undefined: use the product's message. */
export function providerSaveRefusal(code: string | undefined): string | undefined {
  switch (code) {
    case providerWriteErrorCodes.originChangeRequiresSecret:
      return 'Emberpath did not save: the base URL points to a different server, and the stored secret or a hidden default header was not entered again. Enter them again and save, or set Auth Mode to NONE and remove the header.';
    case providerWriteErrorCodes.originChangeRequiresReauthorization:
      return 'Emberpath did not save: this provider signs in through OpenAI and cannot be pointed at another server. Use Authorize Codex, or delete the provider.';
    case providerWriteErrorCodes.redactedValueNotStored:
      return `Emberpath did not save: a default header was sent as "${providerRedactedValue}" but has no stored value. Enter its real value or remove it.`;
    case providerWriteErrorCodes.changedConcurrently:
      return 'Emberpath did not save: this provider was changed by someone else in the meantime. Close this form, open the provider again and repeat the change.';
    default:
      return undefined;
  }
}
