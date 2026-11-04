// Browser DTO snapshot from ChatterMost; Apache-2.0. No server implementation is included.


export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;


export type StatusOK = {
  status: 'OK';
};


export type MattermostAppError = {
  id: string;
  message: string;
  detailed_error: string;
  request_id: string;
  status_code: number;
};


export type MattermostUser = {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  username: string;
  auth_data: string;
  auth_service: string;
  email: string;
  nickname: string;
  first_name: string;
  last_name: string;
  position: string;
  roles: string;
  locale: string;
  timezone: JsonRecord;
  notify_props: JsonRecord;
  last_picture_update: number;
  is_bot: boolean;
  bot_description: string;
};


export type MattermostSession = {
  id: string;
  create_at: number;
  expires_at: number;
  user_id: string;
  device_id: string;
};


export type MattermostTeam = {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  name: string;
  display_name: string;
  description: string;
  type: 'O' | 'I';
  company_name: string;
  allowed_domains: string;
  invite_id: string;
  allow_open_invite: boolean;
  scheme_id: string | null;
  group_constrained: boolean;
};


export type MattermostTeamMember = {
  team_id: string;
  user_id: string;
  roles: string;
  delete_at: number;
  scheme_user: boolean;
  scheme_admin: boolean;
};


export type MattermostChannelType = 'O' | 'P' | 'D' | 'G';


export type MattermostChannel = {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  team_id: string;
  type: MattermostChannelType;
  display_name: string;
  name: string;
  header: string;
  purpose: string;
  last_post_at: number;
  total_msg_count: number;
  extra_update_at: number;
  creator_id: string;
};


export type MattermostChannelMember = {
  channel_id: string;
  user_id: string;
  roles: string;
  last_viewed_at: number;
  msg_count: number;
  mention_count: number;
  notify_props: JsonRecord;
  last_update_at: number;
  scheme_user: boolean;
  scheme_admin: boolean;
};


export type MattermostPost = {
  id: string;
  create_at: number;
  update_at: number;
  edit_at: number;
  delete_at: number;
  is_pinned: boolean;
  user_id: string;
  channel_id: string;
  root_id: string;
  original_id: string;
  message: string;
  type: string;
  props: JsonRecord;
  hashtags: string;
  file_ids: string[];
  pending_post_id: string;
  reply_count: number;
  last_reply_at: number;
  participants: MattermostUser[];
  metadata: JsonRecord;
};


export type MattermostPostList = {
  order: string[];
  posts: Record<string, MattermostPost>;
  next_post_id: string;
  prev_post_id: string;
};


export type MattermostReaction = {
  user_id: string;
  post_id: string;
  emoji_name: string;
  create_at: number;
};


export type MattermostCommand = {
  id: string;
  token: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  creator_id: string;
  team_id: string;
  trigger: string;
  method: string;
  username: string;
  icon_url: string;
  auto_complete: boolean;
  auto_complete_desc: string;
  auto_complete_hint: string;
  display_name: string;
  description: string;
  url: string;
  plugin_id: string;
};


export type MattermostCommandResponse = {
  response_type: 'in_channel';
  text: string;
  post_id: string;
  create_at: number;
};


export type MattermostAutocompleteSuggestion = {
  Complete: string;
  Suggestion: string;
  Hint: string;
  Description: string;
  IconData: string;
};


export type MattermostFileInfo = {
  id: string;
  user_id: string;
  post_id: string;
  channel_id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
  width: number;
  height: number;
  has_preview_image: boolean;
};


export type MattermostPreference = {
  user_id: string;
  category: string;
  name: string;
  value: string;
};


export type MattermostUserStatus = {
  user_id: string;
  status: 'online' | 'away' | 'offline' | 'dnd';
  manual: boolean;
  last_activity_at: number;
};


export type WebSocketResponseFrame = {
  status: 'OK' | 'FAIL';
  seq_reply: number;
  data?: JsonValue;
  error?: MattermostAppError;
};


export type WebSocketBroadcast = {
  user_id?: string;
  user_ids?: string[];
  channel_id?: string;
  team_id?: string;
  omit_users?: string[];
};


export type WebSocketEventEnvelope = {
  event: string;
  data: JsonRecord;
  broadcast: WebSocketBroadcast;
  seq: number;
};
