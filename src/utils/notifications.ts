import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Local notification helpers for task due-date reminders. Everything is wrapped
 * defensively so the app keeps working even where notifications aren't
 * available (e.g. certain Expo Go / web contexts).
 */

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    configure();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Task reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch (err) {
    console.warn('Notification permission check failed', err);
    return false;
  }
}

export async function getNotificationPermission(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return settings.granted;
  } catch {
    return false;
  }
}

/**
 * Schedules a reminder for the given time. Returns the notification id, or
 * undefined if it couldn't be scheduled (past time, no permission, etc.).
 */
export async function scheduleReminder(
  title: string,
  body: string,
  when: Date,
): Promise<string | undefined> {
  try {
    if (when.getTime() <= Date.now() + 1000) return undefined;
    const granted = await ensureNotificationPermission();
    if (!granted) return undefined;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: 'reminders',
      },
    });
    return id;
  } catch (err) {
    console.warn('Failed to schedule reminder', err);
    return undefined;
  }
}

export async function cancelReminder(id: string | undefined): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (err) {
    console.warn('Failed to cancel reminder', err);
  }
}
