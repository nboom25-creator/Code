import type { AppSettings } from "@/lib/settings";
import type {
  SavedProject,
  ShoppingList,
  UserNote,
  UserProject,
  UserToolInventory,
} from "@/lib/types";

/**
 * The complete set of per-user data. In demo mode this is one localStorage
 * blob; with Supabase it is spread across RLS-protected tables and reassembled.
 */
export interface UserDataSnapshot {
  userProjects: UserProject[];
  savedProjects: SavedProject[];
  notes: UserNote[];
  shoppingList: ShoppingList | null;
  toolInventory: UserToolInventory[];
  recentlyViewed: string[];
  settings: AppSettings;
}

/**
 * Storage-agnostic contract for reading and writing a user's data. The store
 * depends only on this interface, so swapping localStorage for Supabase (or a
 * future backend) requires no UI changes.
 */
export interface UserDataRepository {
  /** True for cloud-backed repositories that require authentication. */
  readonly requiresAuth: boolean;
  load(userId: string): Promise<UserDataSnapshot>;
  save(userId: string, snapshot: UserDataSnapshot): Promise<void>;
  clear(userId: string): Promise<void>;
}

export function emptySnapshot(settings: AppSettings): UserDataSnapshot {
  return {
    userProjects: [],
    savedProjects: [],
    notes: [],
    shoppingList: null,
    toolInventory: [],
    recentlyViewed: [],
    settings,
  };
}
