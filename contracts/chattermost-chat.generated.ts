// Product-owned browser-safe Mattermost-compatible wire schemas. Apache-2.0.
// No store records, server imports, credentials or ID generation in this module.
import { z } from 'zod';
export const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof jsonPrimitiveSchema>;
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;
export const jsonRecordSchema = z.record(z.string(), z.json());
export type JsonRecord = z.infer<typeof jsonRecordSchema>;
export const statusOKSchema = z.object({ status: z.literal('OK') });
export type StatusOK = z.infer<typeof statusOKSchema>;
export const mattermostAppErrorSchema = z.object({
  id: z.string(),
  message: z.string(),
  detailed_error: z.string(),
  request_id: z.string(),
  status_code: z.number()
});
export type MattermostAppError = z.infer<typeof mattermostAppErrorSchema>;
export const mattermostUserSchema = z.object({
  id: z.string(),
  create_at: z.number(),
  update_at: z.number(),
  delete_at: z.number(),
  username: z.string(),
  auth_data: z.literal(''),
  auth_service: z.string(),
  email: z.string(),
  nickname: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  position: z.string(),
  roles: z.string(),
  locale: z.string(),
  timezone: jsonRecordSchema,
  notify_props: jsonRecordSchema,
  last_picture_update: z.number(),
  is_bot: z.boolean(),
  bot_description: z.string()
});
export type MattermostUser = z.infer<typeof mattermostUserSchema>;
export const mattermostSessionSchema = z.object({
  id: z.string(),
  create_at: z.number(),
  expires_at: z.number(),
  user_id: z.string(),
  device_id: z.string()
});
export type MattermostSession = z.infer<typeof mattermostSessionSchema>;
export const mattermostTeamSchema = z.object({
  id: z.string(),
  create_at: z.number(),
  update_at: z.number(),
  delete_at: z.number(),
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  type: z.union([z.literal('O'), z.literal('I')]),
  company_name: z.string(),
  allowed_domains: z.string(),
  invite_id: z.string(),
  allow_open_invite: z.boolean(),
  scheme_id: z.union([z.string(), z.null()]),
  group_constrained: z.boolean()
});
export type MattermostTeam = z.infer<typeof mattermostTeamSchema>;
export const mattermostTeamMemberSchema = z.object({
  team_id: z.string(),
  user_id: z.string(),
  roles: z.string(),
  delete_at: z.number(),
  scheme_user: z.boolean(),
  scheme_admin: z.boolean()
});
export type MattermostTeamMember = z.infer<typeof mattermostTeamMemberSchema>;
export const mattermostChannelTypeSchema = z.union([
  z.literal('O'),
  z.literal('P'),
  z.literal('D'),
  z.literal('G')
]);
export type MattermostChannelType = z.infer<typeof mattermostChannelTypeSchema>;
export const mattermostChannelSchema = z.object({
  id: z.string(),
  create_at: z.number(),
  update_at: z.number(),
  delete_at: z.number(),
  team_id: z.string(),
  type: mattermostChannelTypeSchema,
  display_name: z.string(),
  name: z.string(),
  header: z.string(),
  purpose: z.string(),
  last_post_at: z.number(),
  total_msg_count: z.number(),
  extra_update_at: z.number(),
  creator_id: z.string()
});
export type MattermostChannel = z.infer<typeof mattermostChannelSchema>;
export const mattermostChannelMemberSchema = z.object({
  channel_id: z.string(),
  user_id: z.string(),
  roles: z.string(),
  last_viewed_at: z.number(),
  msg_count: z.number(),
  mention_count: z.number(),
  notify_props: jsonRecordSchema,
  last_update_at: z.number(),
  scheme_user: z.boolean(),
  scheme_admin: z.boolean()
});
export type MattermostChannelMember = z.infer<typeof mattermostChannelMemberSchema>;
export const mattermostPostSchema = z.object({
  id: z.string(),
  create_at: z.number(),
  update_at: z.number(),
  edit_at: z.number(),
  delete_at: z.number(),
  is_pinned: z.boolean(),
  user_id: z.string(),
  channel_id: z.string(),
  root_id: z.string(),
  original_id: z.string(),
  message: z.string(),
  type: z.string(),
  props: jsonRecordSchema,
  hashtags: z.string(),
  file_ids: z.array(z.string()),
  pending_post_id: z.string(),
  reply_count: z.number(),
  last_reply_at: z.number(),
  participants: z.array(mattermostUserSchema),
  metadata: jsonRecordSchema
});
export type MattermostPost = z.infer<typeof mattermostPostSchema>;
export const mattermostPostListSchema = z.object({
  order: z.array(z.string()),
  posts: z.record(z.string(), mattermostPostSchema),
  next_post_id: z.string(),
  prev_post_id: z.string()
});
export type MattermostPostList = z.infer<typeof mattermostPostListSchema>;
export const mattermostReactionSchema = z.object({
  user_id: z.string(),
  post_id: z.string(),
  emoji_name: z.string(),
  create_at: z.number()
});
export type MattermostReaction = z.infer<typeof mattermostReactionSchema>;
export const mattermostCommandSchema = z.object({
  id: z.string(),
  token: z.literal(''),
  create_at: z.number(),
  update_at: z.number(),
  delete_at: z.number(),
  creator_id: z.string(),
  team_id: z.string(),
  trigger: z.string(),
  method: z.string(),
  username: z.string(),
  icon_url: z.string(),
  auto_complete: z.boolean(),
  auto_complete_desc: z.string(),
  auto_complete_hint: z.string(),
  display_name: z.string(),
  description: z.string(),
  url: z.string(),
  plugin_id: z.string()
});
export type MattermostCommand = z.infer<typeof mattermostCommandSchema>;
export const mattermostCommandResponseSchema = z.object({
  response_type: z.literal('in_channel'),
  text: z.string(),
  post_id: z.string(),
  create_at: z.number()
});
export type MattermostCommandResponse = z.infer<typeof mattermostCommandResponseSchema>;
export const mattermostAutocompleteSuggestionSchema = z.object({
  Complete: z.string(),
  Suggestion: z.string(),
  Hint: z.string(),
  Description: z.string(),
  IconData: z.string()
});
export type MattermostAutocompleteSuggestion = z.infer<
  typeof mattermostAutocompleteSuggestionSchema
>;
export const mattermostFileInfoSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  post_id: z.string(),
  channel_id: z.string(),
  create_at: z.number(),
  update_at: z.number(),
  delete_at: z.number(),
  name: z.string(),
  extension: z.string(),
  size: z.number(),
  mime_type: z.string(),
  width: z.number(),
  height: z.number(),
  has_preview_image: z.boolean()
});
export type MattermostFileInfo = z.infer<typeof mattermostFileInfoSchema>;
export const mattermostPreferenceSchema = z.object({
  user_id: z.string(),
  category: z.string(),
  name: z.string(),
  value: z.string()
});
export type MattermostPreference = z.infer<typeof mattermostPreferenceSchema>;
export const mattermostUserStatusSchema = z.object({
  user_id: z.string(),
  status: z.union([z.literal('online'), z.literal('away'), z.literal('offline'), z.literal('dnd')]),
  manual: z.boolean(),
  last_activity_at: z.number()
});
export type MattermostUserStatus = z.infer<typeof mattermostUserStatusSchema>;
export const webSocketResponseFrameSchema = z.object({
  status: z.union([z.literal('OK'), z.literal('FAIL')]),
  seq_reply: z.number(),
  data: jsonValueSchema.optional(),
  error: mattermostAppErrorSchema.optional()
});
export type WebSocketResponseFrame = z.infer<typeof webSocketResponseFrameSchema>;
export const webSocketBroadcastSchema = z.object({
  user_id: z.string().optional(),
  user_ids: z.array(z.string()).optional(),
  channel_id: z.string().optional(),
  team_id: z.string().optional(),
  omit_users: z.array(z.string()).optional()
});
export type WebSocketBroadcast = z.infer<typeof webSocketBroadcastSchema>;
export const webSocketEventEnvelopeSchema = z.object({
  event: z.string(),
  data: jsonRecordSchema,
  broadcast: webSocketBroadcastSchema,
  seq: z.number()
});
export type WebSocketEventEnvelope = z.infer<typeof webSocketEventEnvelopeSchema>;

export const browserPatchUserSchema = z.object({
  nickname: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  position: z.string().optional(),
  locale: z.string().optional()
});
export const browserChannelCreateSchema = z.object({
  team_id: z.string().default(''),
  name: z.string().min(1),
  display_name: z.string().min(1),
  type: z.enum(['O', 'P', 'D', 'G']).default('O'),
  header: z.string().optional().default(''),
  purpose: z.string().optional().default('')
});
export const browserChannelPatchSchema = z.object({
  display_name: z.string().optional(),
  header: z.string().optional(),
  purpose: z.string().optional(),
  retention_days: z.number().int().positive().nullable().optional()
});
export const browserDirectSchema = z.array(z.string().min(1)).min(1);
export const browserPostCreateSchema = z.object({
  channel_id: z.string().min(1),
  message: z
    .string()
    .max(16_383)
    .nullish()
    .transform((value) => value ?? ''),
  root_id: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  file_ids: z
    .array(z.string())
    .max(10)
    .nullish()
    .transform((value) => value ?? []),
  pending_post_id: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  props: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? {})
});
export const browserPostPatchSchema = z.object({
  message: z.string().max(16_383).optional(),
  is_pinned: z.boolean().optional(),
  file_ids: z.array(z.string()).optional()
});
export const browserPostSearchSchema = z.object({ terms: z.string().optional().default('') });
export const browserReactionSchema = z.object({
  post_id: z.string().min(1),
  emoji_name: z.string().min(1)
});
export const browserChatContractVersion = 1;
const emoji = z.object({ id: z.string(), name: z.string(), emoji: z.string() });
const upload = z.object({
  file_infos: z.array(mattermostFileInfoSchema),
  client_ids: z.array(z.string()).optional()
});
const reactions = z.record(z.string(), z.array(mattermostReactionSchema));
/** Exact browser-consumed native routes; binary resources use native cookies. */
export const chatBrowserRoutes: {
  method: string;
  path: string;
  response: z.ZodType;
  request?: z.ZodType;
}[] = [
  { method: 'GET', path: '/users/me', response: mattermostUserSchema },
  { method: 'GET', path: '/users/me/teams', response: z.array(mattermostTeamSchema) },
  { method: 'GET', path: '/users/me/channels', response: z.array(mattermostChannelSchema) },
  {
    method: 'GET',
    path: '/users/me/teams/{team_id}/channels',
    response: z.array(mattermostChannelSchema)
  },
  { method: 'POST', path: '/users/search', response: z.array(mattermostUserSchema) },
  { method: 'PUT', path: '/users/{user_id}/patch', response: mattermostUserSchema },
  {
    method: 'POST',
    path: '/users/{user_id}/image',
    response: z.object({ id: z.string(), update_at: z.number() })
  },
  { method: 'DELETE', path: '/users/{user_id}/image', response: statusOKSchema },
  { method: 'GET', path: '/teams/{team_id}/channels', response: z.array(mattermostChannelSchema) },
  ...['/channels', '/channels/direct', '/channels/group'].map((path) => ({
    method: 'POST',
    path,
    response: mattermostChannelSchema
  })),
  { method: 'PUT', path: '/channels/{channel_id}/patch', response: mattermostChannelSchema },
  { method: 'DELETE', path: '/channels/{channel_id}', response: mattermostChannelSchema },
  ...['posts', 'pinned'].map((suffix) => ({
    method: 'GET',
    path: '/channels/{channel_id}/' + suffix,
    response: mattermostPostListSchema
  })),
  {
    method: 'GET',
    path: '/channels/{channel_id}/members',
    response: z.array(mattermostChannelMemberSchema)
  },
  {
    method: 'POST',
    path: '/channels/{channel_id}/members',
    response: mattermostChannelMemberSchema
  },
  { method: 'DELETE', path: '/channels/{channel_id}/members/{user_id}', response: statusOKSchema },
  ...['GET', 'PUT'].map((method) => ({
    method,
    path: '/channels/{channel_id}/agent-policy',
    response: jsonRecordSchema
  })),
  { method: 'POST', path: '/channels/members/{user_id}/view', response: statusOKSchema },
  { method: 'GET', path: '/posts/{post_id}/thread', response: mattermostPostListSchema },
  { method: 'POST', path: '/posts/search', response: mattermostPostListSchema },
  { method: 'POST', path: '/posts', response: mattermostPostSchema },
  { method: 'PUT', path: '/posts/{post_id}/patch', response: mattermostPostSchema },
  { method: 'DELETE', path: '/posts/{post_id}', response: mattermostPostSchema },
  ...['pin', 'unpin'].map((suffix) => ({
    method: 'POST',
    path: '/posts/{post_id}/' + suffix,
    response: mattermostPostSchema
  })),
  { method: 'POST', path: '/reactions', response: mattermostReactionSchema },
  { method: 'POST', path: '/posts/ids/reactions', response: reactions },
  {
    method: 'DELETE',
    path: '/users/{user_id}/posts/{post_id}/reactions/{emoji_name}',
    response: statusOKSchema
  },
  { method: 'GET', path: '/commands', response: z.array(mattermostCommandSchema) },
  { method: 'POST', path: '/commands/execute', response: mattermostCommandResponseSchema },
  { method: 'GET', path: '/emoji', response: z.array(emoji) },
  { method: 'POST', path: '/files', response: upload },
  { method: 'GET', path: '/files/{file_id}/info', response: mattermostFileInfoSchema }
];
const chatRequests: Record<string, z.ZodType> = {
  'PUT /users/{user_id}/patch': browserPatchUserSchema,
  'POST /users/search': z.object({ term: z.string() }),
  'POST /channels': browserChannelCreateSchema,
  'PUT /channels/{channel_id}/patch': browserChannelPatchSchema,
  'POST /channels/direct': browserDirectSchema,
  'POST /channels/group': browserDirectSchema,
  'POST /channels/{channel_id}/members': z.object({ user_id: z.string() }),
  'PUT /channels/{channel_id}/agent-policy': jsonRecordSchema,
  'POST /channels/members/{user_id}/view': z.object({ channel_id: z.string() }),
  'POST /posts': browserPostCreateSchema,
  'PUT /posts/{post_id}/patch': browserPostPatchSchema,
  'POST /posts/search': browserPostSearchSchema,
  'POST /reactions': browserReactionSchema,
  'POST /posts/ids/reactions': z.array(z.string()),
  'POST /commands/execute': z.object({ channel_id: z.string(), command: z.string() })
};
for (const route of chatBrowserRoutes) {
  const request = chatRequests[route.method + ' ' + route.path];
  if (request) route.request = request;
}
export function chatBrowserRequestSchema(path: string, method: string): z.ZodType | undefined {
  const response = chatBrowserResponseSchema(path, method);
  return chatBrowserRoutes.find(
    (route) =>
      route.method === method.toUpperCase() &&
      route.response === response &&
      new RegExp('^' + route.path.replace(/\{[^}]+\}/gu, '[^/]+') + '$', 'u').test(
        path.split('?')[0] ?? ''
      )
  )?.request;
}
export function chatBrowserResponseSchema(path: string, method = 'GET'): z.ZodType {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/u.test(path) || path.includes('..'))
    throw Error('Invalid native chat path');
  const pathname = path.split('?')[0] ?? '';
  const route = chatBrowserRoutes.find(
    (value) =>
      value.method === method.toUpperCase() &&
      new RegExp('^' + value.path.replace(/\{[^}]+\}/gu, '[^/]+') + '$', 'u').test(pathname)
  );
  if (!route) throw Error('Native chat browser route has no released contract');
  return route.response;
}
export function buildBrowserChatOpenApi(): object {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of chatBrowserRoutes)
    (paths['/api/v4' + route.path] ??= {})[route.method.toLowerCase()] = {
      security: [{ nativeSession: [] }],
      ...(route.request
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(route.request, { io: 'input' }) }
              }
            }
          }
        : {}),
      responses: {
        200: {
          description: 'Browser-consumed Mattermost-compatible response',
          content: { 'application/json': { schema: z.toJSONSchema(route.response) } }
        }
      }
    };
  return {
    openapi: '3.1.0',
    info: { title: 'ChatterMost browser native API', version: '1' },
    components: {
      securitySchemes: { nativeSession: { type: 'apiKey', in: 'cookie', name: 'MMSID' } }
    },
    paths
  };
}
