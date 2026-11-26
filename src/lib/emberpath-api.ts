import {z} from 'zod';
import * as contracts from '@contracts/emberpath-model-admin.generated';
import {parseAnswer} from './api-error';

// The vendored contract (Emberpath 2.6.0) describes the adaptive routing request but neither answer
// below, so these follow Emberpath's own `POST /api/providers/:id/discover` and
// `GET|PUT /api/routing/adaptive` handlers and are read leniently.
const modelNames = z.array(z.string().max(500)).max(5000);
export const providerDiscoverySchema = contracts.dataSchema(z.object({
  provider: contracts.providerReadSchema.nullable(),
  discovered: z.array(z.object({model: z.string().max(500), displayName: z.string().max(500).optional()}).passthrough()).max(5000),
  created: modelNames,
  updated: modelNames,
  unchanged: modelNames,
  stale: modelNames,
}));
const adaptiveConfigSchema = z.object({
  enabled: z.boolean(),
  weight: z.number(),
  windowMinutes: z.number(),
  minSamples: z.number(),
  latencyTargetMs: z.number(),
});
export const adaptiveRoutingStateSchema = contracts.dataSchema(z.object({
  config: adaptiveConfigSchema,
  providers: z.array(z.object({
    providerId: z.string(),
    slug: z.string().nullable(),
    name: z.string().nullable(),
    samples: z.number(),
    successRate: z.number(),
    avgLatencyMs: z.number(),
    avgTotalTokens: z.number(),
    scoreAdjustment: z.number(),
  })).max(1000),
}));
const adaptiveSavedSchema = contracts.dataSchema(z.object({config: contracts.adaptiveRoutingSchema}));
export type AdaptiveRoutingState = z.infer<typeof adaptiveRoutingStateSchema>['data'];
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>['data'];

// The transport supplies authentication and errors; all model-plane payloads are owned by Emberpath.
export function createEmberpathApi(request: (path: string, options?: {method?: string; body?: object}) => Promise<unknown>) {
  const id = encodeURIComponent;
  const read = async <T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: object): Promise<T> =>
    parseAnswer(schema, await request(path, {method, ...(body === undefined ? {} : {body})}), 'Emberpath', method !== 'GET');
  const schema = contracts.modelConsoleSchemas;
  return {
    emberpathMe: () => read('/api/auth/me', contracts.adminMeSchema),
    docsIndex: () => read('/api/docs/index', contracts.docsIndexSchema),
    providers: () => read('/api/providers', contracts.dataSchema(z.array(contracts.providerReadSchema))),
    createProvider: (body: contracts.ProviderWriteRequest) => read('/api/providers', contracts.dataSchema(contracts.providerReadSchema), 'POST', contracts.providerSchema.parse(body)),
    updateProvider: (key: string, body: contracts.ProviderWriteRequest) => read('/api/providers/' + id(key), contracts.dataSchema(contracts.providerReadSchema), 'PUT', contracts.providerSchema.parse(body)),
    deleteProvider: (key: string) => read('/api/providers/' + id(key), contracts.okSchema, 'DELETE'),
    /** Asks the provider for its live model list and reconciles it into Emberpath; operator overrides are kept. */
    discoverProviderModels: (key: string) => read('/api/providers/' + id(key) + '/discover', providerDiscoverySchema, 'POST'),
    adaptiveRouting: () => read('/api/routing/adaptive', adaptiveRoutingStateSchema),
    updateAdaptiveRouting: (body: z.input<typeof contracts.adaptiveRoutingSchema>) => read('/api/routing/adaptive', adaptiveSavedSchema, 'PUT', contracts.adaptiveRoutingSchema.parse(body)),
    aliases: () => read('/api/model-aliases', contracts.dataSchema(z.array(contracts.modelAliasReadSchema))),
    createAlias: (body: contracts.ModelAliasWriteRequest) => read('/api/model-aliases', contracts.dataSchema(contracts.modelAliasReadSchema), 'POST', contracts.modelAliasSchema.parse(body)),
    updateAlias: (key: string, body: contracts.ModelAliasWriteRequest) => read('/api/model-aliases/' + id(key), contracts.dataSchema(contracts.modelAliasReadSchema), 'PUT', contracts.modelAliasSchema.parse(body)),
    deleteAlias: (key: string) => read('/api/model-aliases/' + id(key), contracts.okSchema, 'DELETE'),
    codexOAuthStatus: () => read('/api/providers/codex-oauth/status', schema.codexOAuthStatus),
    startCodexOAuth: () => read('/api/providers/codex-oauth/start', schema.codexOAuthStart, 'POST'),
    checkCodexOAuth: (loginId: string) => read('/api/providers/codex-oauth/check', schema.codexOAuthCheck, 'POST', contracts.codexOAuthCheckSchema.parse({loginId})),
    routeRules: () => read('/api/route-rules', schema.routeRules),
    createRouteRule: (body: contracts.RouteRuleWriteRequest) => read('/api/route-rules', schema.routeRule, 'POST', contracts.routeRuleSchema.parse(body)),
    updateRouteRule: (key: string, body: contracts.RouteRuleWriteRequest) => read('/api/route-rules/' + id(key), schema.routeRule, 'PUT', contracts.routeRuleSchema.parse(body)),
    deleteRouteRule: (key: string) => read('/api/route-rules/' + id(key), contracts.okSchema, 'DELETE'),
    heuristics: () => read('/api/heuristics', schema.heuristics),
    createHeuristic: (body: contracts.HeuristicWriteRequest) => read('/api/heuristics', schema.heuristic, 'POST', contracts.heuristicSchema.parse(body)),
    updateHeuristic: (key: string, body: contracts.HeuristicWriteRequest) => read('/api/heuristics/' + id(key), schema.heuristic, 'PUT', contracts.heuristicSchema.parse(body)),
    deleteHeuristic: (key: string) => read('/api/heuristics/' + id(key), contracts.okSchema, 'DELETE'),
    clientKeys: () => read('/api/client-keys', schema.clientKeys),
    createClientKey: (body: contracts.ClientKeyCreateRequest) => read('/api/client-keys', schema.createdClientKey, 'POST', contracts.clientKeySchema.parse(body)),
    updateClientKey: (key: string, body: contracts.ClientKeyUpdateRequest) => read('/api/client-keys/' + id(key), schema.clientKey, 'PUT', contracts.clientKeyUpdateSchema.parse(body)),
    rotateClientKey: (key: string) => read('/api/client-keys/' + id(key) + '/rotate', schema.rotatedClientKey, 'POST'),
    deleteClientKey: (key: string) => read('/api/client-keys/' + id(key), contracts.okSchema, 'DELETE'),
    clientKeyUsage: (key: string) => read('/api/client-keys/' + id(key) + '/usage', schema.clientKeyUsage),
    telemetry: () => read('/api/telemetry', schema.telemetry), traces: () => read('/api/traces', schema.traces),
    audit: () => read('/api/audit', schema.audit), runtimeSettings: () => read('/api/runtime-settings', schema.runtimeSettings),
    routingObjective: () => read('/api/routing/objective', schema.routingObjective),
    updateRoutingObjective: (body: contracts.RoutingObjectiveConfig) => read('/api/routing/objective', schema.routingObjective, 'PUT', contracts.routingObjectiveSchema.parse(body)),
    runRoutingTest: (body: contracts.RoutingTestRequest) => read('/api/testing/run', schema.routingTest, 'POST', contracts.routingTestRequestSchema.parse(body)),
    routingRevisions: () => read('/api/routing/revisions', schema.routingRevisions),
    applyRoutingRevision: (baseRevision: string, patch: unknown) => read('/api/routing/revisions', schema.routingApplied, 'POST', contracts.routingApplyRequestSchema.parse({baseRevision, patch})),
    rollbackRoutingRevision: (revision: string, baseRevision: string) => read('/api/routing/revisions/' + id(revision) + '/rollback', schema.routingSnapshot, 'POST', contracts.routingRollbackRequestSchema.parse({baseRevision})),
    previewRouting: (body: unknown) => read('/api/testing/preview', schema.routingPreview, 'POST', contracts.routingPreviewRequestSchema.parse(body)),
    exportConfig: () => read('/api/config/export', contracts.configExportSchema),
    importConfig: (body: contracts.ConfigImportRequest) => read('/api/config/import', contracts.configImportResultSchema, 'POST', contracts.configImportSchema.parse(body)),
  };
}
