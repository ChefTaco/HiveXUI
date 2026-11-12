// Magnus's own read flags, through its existing notifications API. A Magnus HiveEvent names the
// notification behind it in `sourceRef`; the inbox treats a notification Magnus marks read as read.
// In its own chunk, so the Magnus client loads only when a Magnus feed is announced.
import { magnus } from '../magnus/api/client';
import { notificationListResponseSchema, notificationMarkedResponseSchema } from '../magnus/pages/fleet/notifications/schemas';
import type { MagnusReads } from './store';

/** The most recent notifications Magnus returns in one page. */
const PAGE_SIZE = 100;

export const magnusReads: MagnusReads = {
  async readFlags(signal) {
    const page = await magnus.get('/notifications', notificationListResponseSchema, { query: { pageSize: PAGE_SIZE }, signal });
    return new Map(page.data.notifications.map((item) => [item.id, item.isRead]));
  },
  async markAllRead() {
    await magnus.post('/notifications/read-all', notificationMarkedResponseSchema);
  },
};
