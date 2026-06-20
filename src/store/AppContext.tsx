import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActiveTimer,
  DEFAULT_POMODORO,
  PomodoroSettings,
  Priority,
  Task,
  TimeEntry,
  TimeEntrySource,
} from '../types';
import { loadJSON, saveJSON, STORAGE_KEYS } from '../storage/storage';
import { generateId } from '../utils/time';

interface NewTaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  scheduledStart?: string;
  scheduledEnd?: string;
  estimatedMinutes?: number;
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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroSettings>(DEFAULT_POMODORO);

  // Hydrate from storage once on mount.
  useEffect(() => {
    (async () => {
      const [storedTasks, storedEntries, storedTimer, storedPomodoro] =
        await Promise.all([
          loadJSON<Task[]>(STORAGE_KEYS.tasks, []),
          loadJSON<TimeEntry[]>(STORAGE_KEYS.timeEntries, []),
          loadJSON<ActiveTimer | null>(STORAGE_KEYS.activeTimer, null),
          loadJSON<PomodoroSettings>(STORAGE_KEYS.pomodoro, DEFAULT_POMODORO),
        ]);
      setTasks(storedTasks);
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

  const addTask = useCallback((input: NewTaskInput): Task => {
    const task: Task = {
      id: generateId(),
      title: input.title.trim(),
      notes: input.notes?.trim() || undefined,
      priority: input.priority ?? 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      estimatedMinutes: input.estimatedMinutes,
    };
    setTasks((prev) => [task, ...prev]);
    return task;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }, []);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              completed: !t.completed,
              completedAt: !t.completed ? new Date().toISOString() : undefined,
            }
          : t,
      ),
    );
  }, []);

  const deleteTask = useCallback((id: string) => {
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
      // Ignore accidental sub-second taps.
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
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
