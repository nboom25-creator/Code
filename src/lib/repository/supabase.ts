import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";
import {
  emptySnapshot,
  type UserDataRepository,
  type UserDataSnapshot,
} from "@/lib/repository/types";
import type {
  SavedProject,
  ShoppingList,
  ShoppingListItem,
  UserNote,
  UserProject,
  UserToolInventory,
} from "@/lib/types";

/**
 * Supabase-backed repository. Reads and writes are scoped to the signed-in user
 * and further protected by row-level security policies (see the migrations), so
 * a user can never touch another user's rows even if a bug omits the filter.
 *
 * The snapshot is spread across normalized, RLS-protected tables and reassembled
 * on load. Writes replace the user's rows transactionally-ish via upsert/delete.
 */
export class SupabaseUserDataRepository implements UserDataRepository {
  readonly requiresAuth = true;

  constructor(private readonly client: SupabaseClient) {}

  async load(userId: string): Promise<UserDataSnapshot> {
    const [
      userProjects,
      savedProjects,
      notes,
      shoppingItems,
      toolInventory,
      profile,
    ] = await Promise.all([
      this.client.from("user_projects").select("*").eq("user_id", userId),
      this.client.from("saved_projects").select("*").eq("user_id", userId),
      this.client.from("user_notes").select("*").eq("user_id", userId),
      this.client.from("shopping_list_items").select("*").eq("user_id", userId),
      this.client.from("user_tool_inventory").select("*").eq("user_id", userId),
      this.client.from("profiles").select("*").eq("id", userId).maybeSingle(),
    ]);

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...(readSettings(profile.data)),
    };

    const shoppingList: ShoppingList | null = shoppingItems.data
      ? {
          id: `list-${userId}`,
          userId,
          items: (shoppingItems.data as ShoppingItemRow[]).map(mapShoppingItem),
          updatedAt: new Date(0).toISOString(),
        }
      : null;

    return {
      ...emptySnapshot(settings),
      userProjects: (userProjects.data as UserProjectRow[] | null)?.map(mapUserProject) ?? [],
      savedProjects: (savedProjects.data as SavedRow[] | null)?.map(mapSaved) ?? [],
      notes: (notes.data as NoteRow[] | null)?.map(mapNote) ?? [],
      shoppingList,
      toolInventory:
        (toolInventory.data as ToolInvRow[] | null)?.map(mapToolInv) ?? [],
      recentlyViewed: readRecentlyViewed(profile.data),
      settings,
    };
  }

  async save(userId: string, snapshot: UserDataSnapshot): Promise<void> {
    // Upsert profile-level settings + recently viewed.
    await this.client.from("profiles").upsert({
      id: userId,
      settings: snapshot.settings,
      recently_viewed: snapshot.recentlyViewed,
      updated_at: new Date().toISOString(),
    });

    await Promise.all([
      this.client.from("user_projects").upsert(
        snapshot.userProjects.map((p) => ({
          id: p.id,
          user_id: userId,
          project_id: p.projectId,
          status: p.status,
          current_step_index: p.currentStepIndex,
          steps: p.steps,
          acknowledged_warnings: p.acknowledgedWarnings,
          started_at: p.startedAt,
          completed_at: p.completedAt,
          updated_at: p.updatedAt,
        })),
      ),
      this.replaceCollection("saved_projects", userId, snapshot.savedProjects.map((s) => ({
        id: s.id,
        user_id: userId,
        project_id: s.projectId,
        saved_at: s.savedAt,
      }))),
      this.replaceCollection("user_notes", userId, snapshot.notes.map((n) => ({
        id: n.id,
        user_id: userId,
        project_id: n.projectId,
        body: n.body,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
      }))),
      this.replaceCollection(
        "shopping_list_items",
        userId,
        (snapshot.shoppingList?.items ?? []).map((i) => ({
          id: i.id,
          user_id: userId,
          project_id: i.projectId,
          ref_id: i.refId,
          name: i.name,
          department: i.department,
          quantity: i.quantity,
          estimated_unit_cost_cents: i.estimatedUnitCostCents,
          owned: i.owned,
          purchased: i.purchased,
        })),
      ),
      this.replaceCollection(
        "user_tool_inventory",
        userId,
        snapshot.toolInventory.map((t) => ({
          user_id: userId,
          tool_id: t.toolId,
          owned_at: t.ownedAt,
        })),
      ),
    ]);
  }

  async clear(userId: string): Promise<void> {
    await Promise.all(
      [
        "user_projects",
        "saved_projects",
        "user_notes",
        "shopping_list_items",
        "user_tool_inventory",
      ].map((table) => this.client.from(table).delete().eq("user_id", userId)),
    );
  }

  /** Delete-then-insert to keep a table in sync with the local collection. */
  private async replaceCollection(
    table: string,
    userId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    await this.client.from(table).delete().eq("user_id", userId);
    if (rows.length > 0) {
      await this.client.from(table).insert(rows);
    }
  }
}

/* ------------------------------ row mappers ------------------------------ */

interface UserProjectRow {
  id: string;
  project_id: string;
  status: UserProject["status"];
  current_step_index: number;
  steps: UserProject["steps"];
  acknowledged_warnings: string[];
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  user_id: string;
}
interface SavedRow { id: string; project_id: string; saved_at: string; user_id: string }
interface NoteRow { id: string; project_id: string; body: string; created_at: string; updated_at: string; user_id: string }
interface ToolInvRow { tool_id: string; owned_at: string; user_id: string }
interface ShoppingItemRow {
  id: string;
  project_id: string | null;
  ref_id: string | null;
  name: string;
  department: ShoppingListItem["department"];
  quantity: number;
  estimated_unit_cost_cents: number;
  owned: boolean;
  purchased: boolean;
}

function mapUserProject(r: UserProjectRow): UserProject {
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    status: r.status,
    currentStepIndex: r.current_step_index,
    steps: r.steps,
    acknowledgedWarnings: r.acknowledged_warnings ?? [],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    updatedAt: r.updated_at,
  };
}
function mapSaved(r: SavedRow): SavedProject {
  return { id: r.id, userId: r.user_id, projectId: r.project_id, savedAt: r.saved_at };
}
function mapNote(r: NoteRow): UserNote {
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapToolInv(r: ToolInvRow): UserToolInventory {
  return { userId: r.user_id, toolId: r.tool_id, ownedAt: r.owned_at };
}
function mapShoppingItem(r: ShoppingItemRow): ShoppingListItem {
  return {
    id: r.id,
    projectId: r.project_id,
    refId: r.ref_id,
    name: r.name,
    department: r.department,
    quantity: r.quantity,
    estimatedUnitCostCents: r.estimated_unit_cost_cents,
    owned: r.owned,
    purchased: r.purchased,
  };
}

interface ProfileRow {
  settings?: Partial<AppSettings> | null;
  recently_viewed?: string[] | null;
}
function readSettings(row: ProfileRow | null): Partial<AppSettings> {
  return row?.settings ?? {};
}
function readRecentlyViewed(row: ProfileRow | null): string[] {
  return row?.recently_viewed ?? [];
}
