"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isSupabaseConfigured } from "@/lib/config";
import { LocalUserDataRepository } from "@/lib/repository/local";
import { SupabaseUserDataRepository } from "@/lib/repository/supabase";
import {
  emptySnapshot,
  type UserDataRepository,
  type UserDataSnapshot,
} from "@/lib/repository/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";
import { PROJECT_BY_ID } from "@/lib/seed/projects";
import {
  initialStepProgress,
  toggleStep as applyToggleStep,
} from "@/lib/progress";
import { buildProjectShoppingItems } from "@/lib/shopping";
import type {
  Project,
  ShoppingListItem,
  UserNote,
  UserProject,
} from "@/lib/types";
import { createId } from "@/lib/utils";

const GUEST_USER_ID = "guest";
const RECENT_LIMIT = 8;

/** Return the existing shopping list or a fresh empty one for the user. */
function ensureShoppingList(prev: UserDataSnapshot, userId: string) {
  return (
    prev.shoppingList ?? {
      id: createId("list"),
      userId,
      items: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

interface AuthState {
  userId: string;
  email: string | null;
  isGuest: boolean;
}

interface AppStoreValue {
  hydrated: boolean;
  auth: AuthState;
  data: UserDataSnapshot;
  supabaseEnabled: boolean;
  // project progress
  getUserProject: (projectId: string) => UserProject | undefined;
  startProject: (project: Project) => UserProject;
  setStepCompleted: (projectId: string, stepId: string, completed: boolean) => void;
  setCurrentStep: (projectId: string, index: number) => void;
  acknowledgeWarning: (projectId: string, warningId: string) => void;
  // saved
  isSaved: (projectId: string) => boolean;
  toggleSaved: (projectId: string) => void;
  // notes
  addNote: (projectId: string, body: string) => void;
  updateNote: (noteId: string, body: string) => void;
  deleteNote: (noteId: string) => void;
  // tool inventory
  toggleToolOwned: (toolId: string) => void;
  isToolOwned: (toolId: string) => boolean;
  // shopping list
  addProjectToShoppingList: (
    project: Project,
    ownedMaterialIds: Set<string>,
  ) => number;
  addCustomShoppingItem: (item: Omit<ShoppingListItem, "id">) => void;
  updateShoppingItem: (itemId: string, patch: Partial<ShoppingListItem>) => void;
  removeShoppingItem: (itemId: string) => void;
  clearPurchasedShoppingItems: () => void;
  // recently viewed
  recordView: (projectId: string) => void;
  // settings
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAllData: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [auth, setAuth] = useState<AuthState>({
    userId: GUEST_USER_ID,
    email: null,
    isGuest: true,
  });
  const [data, setData] = useState<UserDataSnapshot>(() =>
    emptySnapshot(DEFAULT_SETTINGS),
  );

  const repoRef = useRef<UserDataRepository>(new LocalUserDataRepository());
  const localRepo = useRef<UserDataRepository>(new LocalUserDataRepository());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve auth + repository, then hydrate from storage. Runs once on mount so
  // the server render (empty snapshot) matches the first client paint.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      let nextAuth: AuthState = {
        userId: GUEST_USER_ID,
        email: null,
        isGuest: true,
      };
      let repo: UserDataRepository = localRepo.current;

      if (isSupabaseConfigured) {
        const client = getSupabaseBrowserClient();
        const { data: sessionData } = (await client?.auth.getUser()) ?? {
          data: { user: null },
        };
        const user = sessionData.user;
        if (client && user) {
          nextAuth = { userId: user.id, email: user.email ?? null, isGuest: false };
          repo = new SupabaseUserDataRepository(client);
        }
      }

      repoRef.current = repo;
      const snapshot = await repo.load(nextAuth.userId);
      if (cancelled) return;
      setAuth(nextAuth);
      setData(snapshot);
      setHydrated(true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence whenever data changes after hydration.
  const persist = useCallback(
    (snapshot: UserDataSnapshot) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void repoRef.current.save(auth.userId, snapshot);
        // Mirror to local storage as an offline cache when signed in.
        if (repoRef.current.requiresAuth) {
          void localRepo.current.save(auth.userId, snapshot);
        }
      }, 300);
    },
    [auth.userId],
  );

  const update = useCallback(
    (updater: (prev: UserDataSnapshot) => UserDataSnapshot) => {
      setData((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const now = () => new Date().toISOString();

  const getUserProject = useCallback(
    (projectId: string) => data.userProjects.find((p) => p.projectId === projectId),
    [data.userProjects],
  );

  const startProject = useCallback(
    (project: Project): UserProject => {
      const existing = data.userProjects.find((p) => p.projectId === project.id);
      if (existing) return existing;
      const ts = now();
      const userProject: UserProject = {
        id: createId("up"),
        userId: auth.userId,
        projectId: project.id,
        status: "in_progress",
        currentStepIndex: 0,
        steps: initialStepProgress(project),
        acknowledgedWarnings: [],
        startedAt: ts,
        completedAt: null,
        updatedAt: ts,
      };
      update((prev) => ({
        ...prev,
        userProjects: [...prev.userProjects, userProject],
      }));
      return userProject;
    },
    [auth.userId, data.userProjects, update],
  );

  const setStepCompleted = useCallback(
    (projectId: string, stepId: string, completed: boolean) => {
      update((prev) => ({
        ...prev,
        userProjects: prev.userProjects.map((up) =>
          up.projectId === projectId
            ? applyToggleStep(up, stepId, completed, now())
            : up,
        ),
      }));
    },
    [update],
  );

  const setCurrentStep = useCallback(
    (projectId: string, index: number) => {
      update((prev) => ({
        ...prev,
        userProjects: prev.userProjects.map((up) =>
          up.projectId === projectId
            ? { ...up, currentStepIndex: index, updatedAt: now() }
            : up,
        ),
      }));
    },
    [update],
  );

  const acknowledgeWarning = useCallback(
    (projectId: string, warningId: string) => {
      update((prev) => ({
        ...prev,
        userProjects: prev.userProjects.map((up) =>
          up.projectId === projectId && !up.acknowledgedWarnings.includes(warningId)
            ? {
                ...up,
                acknowledgedWarnings: [...up.acknowledgedWarnings, warningId],
                updatedAt: now(),
              }
            : up,
        ),
      }));
    },
    [update],
  );

  const isSaved = useCallback(
    (projectId: string) => data.savedProjects.some((s) => s.projectId === projectId),
    [data.savedProjects],
  );

  const toggleSaved = useCallback(
    (projectId: string) => {
      update((prev) => {
        const exists = prev.savedProjects.some((s) => s.projectId === projectId);
        return {
          ...prev,
          savedProjects: exists
            ? prev.savedProjects.filter((s) => s.projectId !== projectId)
            : [
                ...prev.savedProjects,
                {
                  id: createId("save"),
                  userId: auth.userId,
                  projectId,
                  savedAt: now(),
                },
              ],
        };
      });
    },
    [auth.userId, update],
  );

  const addNote = useCallback(
    (projectId: string, body: string) => {
      const ts = now();
      const note: UserNote = {
        id: createId("note"),
        userId: auth.userId,
        projectId,
        body,
        createdAt: ts,
        updatedAt: ts,
      };
      update((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
    },
    [auth.userId, update],
  );

  const updateNote = useCallback(
    (noteId: string, body: string) => {
      update((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId ? { ...n, body, updatedAt: now() } : n,
        ),
      }));
    },
    [update],
  );

  const deleteNote = useCallback(
    (noteId: string) => {
      update((prev) => ({
        ...prev,
        notes: prev.notes.filter((n) => n.id !== noteId),
      }));
    },
    [update],
  );

  const isToolOwned = useCallback(
    (toolId: string) => data.toolInventory.some((t) => t.toolId === toolId),
    [data.toolInventory],
  );

  const toggleToolOwned = useCallback(
    (toolId: string) => {
      update((prev) => {
        const exists = prev.toolInventory.some((t) => t.toolId === toolId);
        return {
          ...prev,
          toolInventory: exists
            ? prev.toolInventory.filter((t) => t.toolId !== toolId)
            : [
                ...prev.toolInventory,
                { userId: auth.userId, toolId, ownedAt: now() },
              ],
        };
      });
    },
    [auth.userId, update],
  );

  const addProjectToShoppingList = useCallback(
    (project: Project, ownedMaterialIds: Set<string>): number => {
      const ownedTools = new Set(data.toolInventory.map((t) => t.toolId));
      const newItems = buildProjectShoppingItems(
        project,
        ownedTools,
        ownedMaterialIds,
      );
      update((prev) => {
        const list = ensureShoppingList(prev, auth.userId);
        // Avoid duplicating items already present for this project.
        const existingRefs = new Set(
          list.items
            .filter((i) => i.projectId === project.id)
            .map((i) => i.refId),
        );
        const merged = [
          ...list.items,
          ...newItems.filter((i) => !existingRefs.has(i.refId)),
        ];
        return {
          ...prev,
          shoppingList: { ...list, items: merged, updatedAt: now() },
        };
      });
      return newItems.length;
    },
    [auth.userId, data.toolInventory, update],
  );

  const addCustomShoppingItem = useCallback(
    (item: Omit<ShoppingListItem, "id">) => {
      update((prev) => {
        const list = ensureShoppingList(prev, auth.userId);
        return {
          ...prev,
          shoppingList: {
            ...list,
            items: [...list.items, { ...item, id: createId("sli") }],
            updatedAt: now(),
          },
        };
      });
    },
    [auth.userId, update],
  );

  const updateShoppingItem = useCallback(
    (itemId: string, patch: Partial<ShoppingListItem>) => {
      update((prev) => {
        if (!prev.shoppingList) return prev;
        return {
          ...prev,
          shoppingList: {
            ...prev.shoppingList,
            items: prev.shoppingList.items.map((i) =>
              i.id === itemId ? { ...i, ...patch } : i,
            ),
            updatedAt: now(),
          },
        };
      });
    },
    [update],
  );

  const removeShoppingItem = useCallback(
    (itemId: string) => {
      update((prev) => {
        if (!prev.shoppingList) return prev;
        return {
          ...prev,
          shoppingList: {
            ...prev.shoppingList,
            items: prev.shoppingList.items.filter((i) => i.id !== itemId),
            updatedAt: now(),
          },
        };
      });
    },
    [update],
  );

  const clearPurchasedShoppingItems = useCallback(() => {
    update((prev) => {
      if (!prev.shoppingList) return prev;
      return {
        ...prev,
        shoppingList: {
          ...prev.shoppingList,
          items: prev.shoppingList.items.filter((i) => !i.purchased),
          updatedAt: now(),
        },
      };
    });
  }, [update]);

  const recordView = useCallback(
    (projectId: string) => {
      if (!PROJECT_BY_ID[projectId]) return;
      update((prev) => {
        const next = [projectId, ...prev.recentlyViewed.filter((id) => id !== projectId)].slice(
          0,
          RECENT_LIMIT,
        );
        if (
          next.length === prev.recentlyViewed.length &&
          next.every((id, i) => id === prev.recentlyViewed[i])
        ) {
          return prev; // no change, avoid redundant writes
        }
        return { ...prev, recentlyViewed: next };
      });
    },
    [update],
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      update((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    },
    [update],
  );

  const resetAllData = useCallback(() => {
    const fresh = emptySnapshot(DEFAULT_SETTINGS);
    setData(fresh);
    void repoRef.current.clear(auth.userId);
    void localRepo.current.clear(auth.userId);
  }, [auth.userId]);

  const value = useMemo<AppStoreValue>(
    () => ({
      hydrated,
      auth,
      data,
      supabaseEnabled: isSupabaseConfigured,
      getUserProject,
      startProject,
      setStepCompleted,
      setCurrentStep,
      acknowledgeWarning,
      isSaved,
      toggleSaved,
      addNote,
      updateNote,
      deleteNote,
      toggleToolOwned,
      isToolOwned,
      addProjectToShoppingList,
      addCustomShoppingItem,
      updateShoppingItem,
      removeShoppingItem,
      clearPurchasedShoppingItems,
      recordView,
      updateSettings,
      resetAllData,
    }),
    [
      hydrated,
      auth,
      data,
      getUserProject,
      startProject,
      setStepCompleted,
      setCurrentStep,
      acknowledgeWarning,
      isSaved,
      toggleSaved,
      addNote,
      updateNote,
      deleteNote,
      toggleToolOwned,
      isToolOwned,
      addProjectToShoppingList,
      addCustomShoppingItem,
      updateShoppingItem,
      removeShoppingItem,
      clearPurchasedShoppingItems,
      recordView,
      updateSettings,
      resetAllData,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}
