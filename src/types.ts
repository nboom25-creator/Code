export type Priority = 'low' | 'medium' | 'high';

export type TimeEntrySource = 'focus' | 'timer' | 'manual';

/** How a task repeats after it is completed. */
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly';

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Once',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
};

export interface Task {
  id: string;
  title: string;
  notes?: string;
  priority: Priority;
  completed: boolean;
  createdAt: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  /** ISO datetime the task is due; powers reminders. */
  dueDate?: string;
  /** How the task repeats once completed. */
  recurrence: Recurrence;
  /** id of the scheduled local notification, so it can be cancelled. */
  notificationId?: string;
  /** ISO datetime the task is scheduled to start (calendar) */
  scheduledStart?: string;
  /** ISO datetime the task is scheduled to end (calendar) */
  scheduledEnd?: string;
  estimatedMinutes?: number;
}

export interface TimeEntry {
  id: string;
  /** Optional link to the task this time was spent on */
  taskId?: string;
  label: string;
  startedAt: string; // ISO timestamp
  endedAt: string; // ISO timestamp
  durationSeconds: number;
  source: TimeEntrySource;
}

/** A currently-running time tracker, persisted so it survives an app reload. */
export interface ActiveTimer {
  taskId?: string;
  label: string;
  startedAt: string; // ISO timestamp
  source: Exclude<TimeEntrySource, 'manual'>;
}

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsBeforeLongBreak: number;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};
