/**
 * Identity serializer for notification rows — kept as an explicit pass-through so the
 * controller layer has a stable seam for future shape changes (e.g. dropping `data` blobs)
 * without touching every call site.
 */
export const NotificationSerializer = {
  one<T>(notification: T): T {
    return notification;
  },
  many<T>(notifications: T[]): T[] {
    return notifications;
  },
};
