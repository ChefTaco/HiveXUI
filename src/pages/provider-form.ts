import { z } from 'zod';
import type { Provider, ProviderModel, ProviderModelWriteRequest, ProviderWriteRequest } from '../lib/types';
import { formatJson, parseJsonObject } from '../lib/format';

function parseStringRecord(value: string): Record<string, string> {
  const parsed = parseJsonObject(value);
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== 'string') {
      throw new Error('Header ' + key + ' must be a string');
    }
  }
  return parsed as Record<string, string>;
}

const modelWriteSchema = z.object({
  model: z.string().min(1),
  displayName: z.string().optional(),
  enabled: z.boolean().optional(),
  maxContextWindow: z.number().int().positive().optional(),
  capabilityJson: z.record(z.string(), z.unknown()).optional(),
}).strict();

export function parseProviderModels(value: string): ProviderModelWriteRequest[] {
  return z.array(z.unknown()).parse(JSON.parse(value) as unknown).map(validateModelWrite);
}

function validateModelWrite(value: unknown): ProviderModelWriteRequest {
  const parsed = modelWriteSchema.parse(value);
  return {model: parsed.model,
    ...(parsed.displayName !== undefined ? {displayName: parsed.displayName} : {}),
    ...(parsed.enabled !== undefined ? {enabled: parsed.enabled} : {}),
    ...(parsed.maxContextWindow !== undefined ? {maxContextWindow: parsed.maxContextWindow} : {}),
    ...(parsed.capabilityJson !== undefined ? {capabilityJson: parsed.capabilityJson} : {}),
  };
}

/** Read DTO rows contain persistence metadata and JSON text; writes do not. */
export function providerModelForWrite(model: ProviderModel): ProviderModelWriteRequest {
  let capabilities: Record<string, unknown> | undefined;
  if (model.capabilityJson !== undefined) {
    try { capabilities = parseJsonObject(model.capabilityJson); }
    catch { throw new Error('Model "' + model.model + '" has invalid capability JSON; repair it before editing this provider.'); }
  }
  return validateModelWrite({
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

export function providerFormForWrite(form: ProviderForm): ProviderWriteRequest {
  return {
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
  };
}
