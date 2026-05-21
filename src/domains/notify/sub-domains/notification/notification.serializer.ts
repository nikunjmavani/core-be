export const NotificationSerializer = {
  one<T>(notification: T): T {
    return notification;
  },
  many<T>(notifications: T[]): T[] {
    return notifications;
  },
};
