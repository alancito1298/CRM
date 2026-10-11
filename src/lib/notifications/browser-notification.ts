/**
 * Web Notifications API Helper
 *
 * Dispatches native OS desktop notifications when the CRM tab
 * is unfocused or minimized, so agents never miss an urgent lead or handoff.
 */

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isBrowserNotificationSupported()) return 'unsupported';

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.warn('[Notification API] Permission request failed:', err);
    return Notification.permission;
  }
}

interface SendNotificationOptions {
  title: string;
  body?: string;
  conversationId?: string;
  tag?: string;
  onClick?: () => void;
}

export function sendBrowserNotification(options: SendNotificationOptions): Notification | null {
  if (!isBrowserNotificationSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const notification = new Notification(options.title, {
      body: options.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: options.tag || options.conversationId || 'wacrm-notification',
    });

    notification.onclick = (e) => {
      e.preventDefault();
      window.focus();

      if (options.onClick) {
        options.onClick();
      } else if (options.conversationId) {
        window.location.href = `/inbox?c=${options.conversationId}`;
      }
      notification.close();
    };

    return notification;
  } catch (err) {
    console.warn('[Notification API] Failed to show notification:', err);
    return null;
  }
}
