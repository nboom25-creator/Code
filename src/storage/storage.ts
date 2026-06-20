import AsyncStorage from '@react-native-async-storage/async-storage';

/** Thin typed wrapper around AsyncStorage with JSON (de)serialization. */
export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`Failed to load "${key}" from storage`, err);
    return fallback;
  }
}

export async function saveJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to save "${key}" to storage`, err);
  }
}

export const STORAGE_KEYS = {
  tasks: 'timeflow.tasks',
  timeEntries: 'timeflow.timeEntries',
  activeTimer: 'timeflow.activeTimer',
  pomodoro: 'timeflow.pomodoroSettings',
} as const;
