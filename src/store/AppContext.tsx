import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActiveTimer,
  DEFAULT_POMODORO,
  PomodoroSettings,
  Priority,
  Recurrence,
  Task,
  TimeEntry,
  TimeEntrySource,
} from '../types';
import { loadJSON, saveJSON, STORAGE_KEYS } from '../storage/storage';
import { generateId, nextOccurrence } from '../utils/time';
import {
  cancelReminder,
  scheduleReminder,
} from '../utils/notifications';

interface NewTaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  dueDate?: string;
  recurrence?: Recurrence;
  scheduledStart?: string;
  scheduledEnd?: string;
  estimatedMinutes?: number;
}

export interface ExportData {
  app: 'timeflow';
  version: number;
  exportedAt: string;
  tasks: Task[];
  timeEntries: TimeEntry[];
  pomodoro: PomodoroSettings;
}

interface AppContextValue {
  ready: boolean;
  // Tasks
  tasks: Task[];
  addTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  // Time tracking
  timeEntries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  startTimer: (input: { taskId?: string; label: string; source?: 'focus' | 'timer' }) => void;
  stopTimer: () => TimeEntry | null;
  cancelTimer: () => void;
  addManualEntry: (input: {
    taskId?: string;
    label: string;
    startedAt: string;
    endedAt: string;
    source?: TimeEntrySource;
  }) => void;
  deleteEntry: (id: string) => void;
  // Pomodoro
  pomodoro: PomodoroSettings;
  updatePomodoro: (patch: Partial<PomodoroSettings>) => void;
  // Data management
  exportData: () => ExportData;
  importData: (data: ExportData) => void;
  clearAllData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Backfills fields for tasks saved by older versions of the app. */
function normalizeTask(t: Partial<Task>): Task {
  return {
    id: t.id ?? generateId(),
    title: t.title ?? 'Untitled',
    notes: t.notes,
    priority: t.priority ?? 'medium',
    completed: t.completed ?? false,
    createdAt: t.createdAt ?? new Date().toISOString(),
    completedAt: t.completedAt,
    dueDate: t.dueDate,
    recurrence: t.recurrence ?? 'none',
    notificationId: t.notificationId,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    estimatedMinutes: t.estimatedMinutes,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroSettings>(DEFAULT_POMODORO);

  // Mirror of tasks for reading the latest state inside callbacks.
  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Hydrate from storage once on mount.
  useEffect(() => {
    (async () => {
      const [storedTasks, storedEntries, storedTimer, storedPomodoro] =
        await Promise.all([
          loadJSON<Partial<Task>[]>(STORAGE_KEYS.tasks, []),
          loadJSON<TimeEntry[]>(STORAGE_KEYS.timeEntries, []),
          loadJSON<ActiveTimer | null>(STORAGE_KEYS.activeTimer, null),
          loadJSON<PomodoroSettings>(STORAGE_KEYS.pomodoro, DEFAULT_POMODORO),
        ]);
      setTasks(storedTasks.map(normalizeTask));
      setTimeEntries(storedEntries);
      setActiveTimer(storedTimer);
      setPomodoro(storedPomodoro);
      setReady(true);
    })();
  }, []);

  // Persist each slice when it changes (after hydration).
  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.tasks, tasks);
  }, [tasks, ready]);
  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.timeEntries, timeEntries);
  }, [timeEntries, ready]);
  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.activeTimer, activeTimer);
  }, [activeTimer, ready]);
  useEffect(() => {
    if (ready) saveJSON(STORAGE_KEYS.pomodoro, pomodoro);
  }, [pomodoro, ready]);

  /** Cancels any existing reminder for a task and schedules a fresh one. */
  const applyReminder = useCallback(async (task: Task) => {
    await cancelReminder(task.notificationId);
    let notificationId: string | undefined;
    if (task.dueDate && !task.completed) {
      notificationId = await scheduleReminder(
        'Task due',
        task.title,
        new Date(task.dueDate),
      );
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, notificationId } : t)),
    );
  }, []);

  const addTask = useCallback(
    (input: NewTaskInput): Task => {
      const task: Task = normalizeTask({
        id: generateId(),
        title: input.title.trim(),
        notes: input.notes?.trim() || undefined,
        priority: input.priority ?? 'medium',
        completed: false,
        createdAt: new Date().toISOString(),
        dueDate: input.dueDate,
        recurrence: input.recurrence ?? 'none',
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        estimatedMinutes: input.estimatedMinutes,
      });
      setTasks((prev) => [task, ...prev]);
      if (task.dueDate) applyReminder(task);
      return task;
    },
    [applyReminder],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      const existing = tasksRef.current.find((t) => t.id === id);
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      if (
        existing &&
        ('dueDate' in patch || 'completed' in patch || 'title' in patch)
      ) {
        applyReminder({ ...existing, ...patch });
      }
    },
    [applyReminder],
  );

  /** Creates the next instance of a recurring task. */
  const spawnNext = useCallback(
    (task: Task) => {
      const anchor = task.dueDate
        ? new Date(task.dueDate)
        : task.scheduledStart
          ? new Date(task.scheduledStart)
          : new Date();
      const nextDue = nextOccurrence(anchor, task.recurrence);
      if (!nextDue) return;

      let scheduledStart: string | undefined;
      let scheduledEnd: string | undefined;
      if (task.scheduledStart && task.scheduledEnd) {
        const ns = nextOccurrence(new Date(task.scheduledStart), task.recurrence);
        if (ns) {
          const duration =
            new Date(task.scheduledEnd).getTime() -
            new Date(task.scheduledStart).getTime();
          scheduledStart = ns.toISOString();
          scheduledEnd = new Date(ns.getTime() + duration).toISOString();
        }
      }

      const next: Task = {
        ...task,
        id: generateId(),
        completed: false,
        completedAt: undefined,
        createdAt: new Date().toISOString(),
        dueDate: task.dueDate ? nextDue.toISOString() : undefined,
        scheduledStart,
        scheduledEnd,
        notificationId: undefined,
      };
      setTasks((prev) => [next, ...prev]);
      if (next.dueDate) applyReminder(next);
    },
    [applyReminder],
  );

  const toggleTask = useCallback(
    (id: string) => {
      const existing = tasksRef.current.find((t) => t.id === id);
      if (!existing) return;
      const willComplete = !existing.completed;

      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                completed: willComplete,
                completedAt: willComplete ? new Date().toISOString() : undefined,
                notificationId: willComplete ? undefined : t.notificationId,
              }
            : t,
        ),
      );

      if (willComplete) {
        cancelReminder(existing.notificationId);
        if (existing.recurrence !== 'none') spawnNext(existing);
      } else {
        // Re-opened: restore the reminder if it's still in the future.
        applyReminder({ ...existing, completed: false, notificationId: undefined });
      }
    },
    [applyReminder, spawnNext],
  );

  const deleteTask = useCallback((id: string) => {
    const existing = tasksRef.current.find((t) => t.id === id);
    if (existing?.notificationId) cancelReminder(existing.notificationId);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startTimer = useCallback(
    (input: { taskId?: string; label: string; source?: 'focus' | 'timer' }) => {
      setActiveTimer({
        taskId: input.taskId,
        label: input.label,
        startedAt: new Date().toISOString(),
        source: input.source ?? 'timer',
      });
    },
    [],
  );

  const stopTimer = useCallback((): TimeEntry | null => {
    let created: TimeEntry | null = null;
    setActiveTimer((current) => {
      if (!current) return null;
      const endedAt = new Date();
      const startedAt = new Date(current.startedAt);
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      );
      if (durationSeconds >= 1) {
        created = {
          id: generateId(),
          taskId: current.taskId,
          label: current.label,
          startedAt: current.startedAt,
          endedAt: endedAt.toISOString(),
          durationSeconds,
          source: current.source,
        };
      }
      return null;
    });
    if (created) {
      setTimeEntries((prev) => [created as TimeEntry, ...prev]);
    }
    return created;
  }, []);

  const cancelTimer = useCallback(() => setActiveTimer(null), []);

  const addManualEntry = useCallback(
    (input: {
      taskId?: string;
      label: string;
      startedAt: string;
      endedAt: string;
      source?: TimeEntrySource;
    }) => {
      const startedAt = new Date(input.startedAt);
      const endedAt = new Date(input.endedAt);
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      );
      const entry: TimeEntry = {
        id: generateId(),
        taskId: input.taskId,
        label: input.label,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationSeconds,
        source: input.source ?? 'manual',
      };
      setTimeEntries((prev) => [entry, ...prev]);
    },
    [],
  );

  const deleteEntry = useCallback((id: string) => {
    setTimeEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updatePomodoro = useCallback((patch: Partial<PomodoroSettings>) => {
    setPomodoro((prev) => ({ ...prev, ...patch }));
  }, []);

  const exportData = useCallback(
    (): ExportData => ({
      app: 'timeflow',
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks,
      timeEntries,
      pomodoro,
    }),
    [tasks, timeEntries, pomodoro],
  );

  const importData = useCallback(
    (data: ExportData) => {
      // Drop reminders from current tasks before replacing them.
      tasksRef.current.forEach((t) => cancelReminder(t.notificationId));
      const imported = (data.tasks ?? []).map(normalizeTask).map((t) => ({
        ...t,
        notificationId: undefined,
      }));
      setTasks(imported);
      setTimeEntries(data.timeEntries ?? []);
      if (data.pomodoro) setPomodoro(data.pomodoro);
      // Reschedule reminders for imported, still-open, future tasks.
      imported.forEach((t) => {
        if (t.dueDate && !t.completed) applyReminder(t);
      });
    },
    [applyReminder],
  );

  const clearAllData = useCallback(() => {
    tasksRef.current.forEach((t) => cancelReminder(t.notificationId));
    setTasks([]);
    setTimeEntries([]);
    setActiveTimer(null);
    setPomodoro(DEFAULT_POMODORO);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      tasks,
      addTask,
      updateTask,
      toggleTask,
      deleteTask,
      timeEntries,
      activeTimer,
      startTimer,
      stopTimer,
      cancelTimer,
      addManualEntry,
      deleteEntry,
      pomodoro,
      updatePomodoro,
      exportData,
      importData,
      clearAllData,
    }),
    [
      ready,
      tasks,
      addTask,
      updateTask,
      toggleTask,
      deleteTask,
      timeEntries,
      activeTimer,
      startTimer,
      stopTimer,
      cancelTimer,
      addManualEntry,
      deleteEntry,
      pomodoro,
      updatePomodoro,
      exportData,
      importData,
      clearAllData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
