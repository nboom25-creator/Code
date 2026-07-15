import { STORAGE_PREFIX } from "@/lib/config";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  emptySnapshot,
  type UserDataRepository,
  type UserDataSnapshot,
} from "@/lib/repository/types";

/**
 * localStorage-backed repository. Used for guest/demo users and as an offline
 * cache. All reads are SSR-safe (they no-op without `window`), which keeps
 * server rendering free of hydration mismatches.
 */
export class LocalUserDataRepository implements UserDataRepository {
  readonly requiresAuth = false;

  private key(userId: string): string {
    return `${STORAGE_PREFIX}.user.${userId}`;
  }

  async load(userId: string): Promise<UserDataSnapshot> {
    if (typeof window === "undefined") return emptySnapshot(DEFAULT_SETTINGS);
    try {
      const raw = window.localStorage.getItem(this.key(userId));
      if (!raw) return emptySnapshot(DEFAULT_SETTINGS);
      const parsed = JSON.parse(raw) as Partial<UserDataSnapshot>;
      return {
        ...emptySnapshot(DEFAULT_SETTINGS),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    } catch {
      // Corrupt data should never crash the app — start fresh.
      return emptySnapshot(DEFAULT_SETTINGS);
    }
  }

  async save(userId: string, snapshot: UserDataSnapshot): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.key(userId), JSON.stringify(snapshot));
    } catch {
      // Quota or privacy-mode errors are non-fatal; the in-memory state stands.
    }
  }

  async clear(userId: string): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(this.key(userId));
  }
}
