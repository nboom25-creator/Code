-- ProjectPath — row-level security policies
--
-- Public content is world-readable but not writable by standard users.
-- Every per-user table is locked down so `auth.uid()` can only touch its own
-- rows for select/insert/update/delete.

-- ---------------------------------------------------------------------------
-- Public content: read-only for everyone (including anon), no client writes.
-- ---------------------------------------------------------------------------
alter table project_categories enable row level security;
alter table tools enable row level security;
alter table materials enable row level security;
alter table projects enable row level security;
alter table project_tools enable row level security;
alter table project_materials enable row level security;
alter table project_steps enable row level security;
alter table step_tools enable row level security;
alter table step_materials enable row level security;
alter table safety_warnings enable row level security;
alter table troubleshooting_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'project_categories','tools','materials','projects','project_tools',
    'project_materials','project_steps','step_tools','step_materials',
    'safety_warnings','troubleshooting_entries'
  ]
  loop
    execute format(
      'drop policy if exists %I on %I;', t || '_read', t
    );
    execute format(
      'create policy %I on %I for select using (true);', t || '_read', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles: a user can read/insert/update only their own profile row.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Per-user tables: full CRUD limited to the owner.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_projects','saved_projects','user_notes',
    'user_tool_inventory','shopping_list_items'
  ]
  loop
    execute format('alter table %I enable row level security;', t);

    execute format('drop policy if exists %I on %I;', t || '_select_own', t);
    execute format(
      'create policy %I on %I for select using (auth.uid() = user_id);',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on %I;', t || '_insert_own', t);
    execute format(
      'create policy %I on %I for insert with check (auth.uid() = user_id);',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on %I;', t || '_update_own', t);
    execute format(
      'create policy %I on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on %I;', t || '_delete_own', t);
    execute format(
      'create policy %I on %I for delete using (auth.uid() = user_id);',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auto-provision a profile row when a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
