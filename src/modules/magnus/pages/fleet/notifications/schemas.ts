// /notifications has no entry in the browser contract yet. Shapes from
// services/control-api/src/routes/notifications.ts and services/notification-service.ts.
import { z } from 'zod';

export const notificationPreferenceSchema = z.object({
  channel: z.string(),
  category: z.string(),
  enabled: z.boolean(),
  minSeverity: z.string(),
});
export const notificationPreferencesResponseSchema = z.object({ success: z.literal(true), data: z.array(notificationPreferenceSchema) });

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.string(),
  title: z.string(),
  message: z.string(),
  nodeName: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string(),
});
export const notificationListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ notifications: z.array(notificationSchema), total: z.number() }),
});
export const notificationUnreadResponseSchema = z.object({ success: z.literal(true), data: z.object({ count: z.number() }) });
export const notificationMarkedResponseSchema = z.object({ success: z.literal(true), data: z.object({ marked: z.number() }) });

export type NotificationPreference = z.output<typeof notificationPreferenceSchema>;
export type NotificationItem = z.output<typeof notificationSchema>;
