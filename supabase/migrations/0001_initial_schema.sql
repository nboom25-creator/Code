-- ProjectPath — initial schema
--
-- Public content (projects, tools, materials, steps, ...) is stored as
-- read-only reference data. Per-user data (progress, notes, shopping lists,
-- inventory) is protected by row-level security so a user can only ever read
-- or write their own rows.
--
-- Note: the demo app ships its content as local seed data (src/lib/seed) and
-- does not require these tables to run. They are provided for teams who want
-- to move content and/or user data into Postgres.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type difficulty as enum ('beginner', 'intermediate', 'advanced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type safety_level as enum ('low', 'moderate', 'elevated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cost_band as enum ('under_25', '25_75', '75_200', '200_plus');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('not_started', 'in_progress', 'completed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users) — holds settings + recently viewed
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  recently_viewed text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Public content tables (read-only for standard users)
-- ---------------------------------------------------------------------------
create table if not exists project_categories (
  slug text primary key,
  name text not null,
  description text not null,
  icon text not null
);

create table if not exists tools (
  id text primary key,
  name text not null,
  description text not null,
  estimated_cost_cents integer not null default 0,
  department text not null
);

create table if not exists materials (
  id text primary key,
  name text not null,
  unit text not null,
  estimated_cost_cents integer not null default 0,
  department text not null
);

create table if not exists projects (
  id text primary key,
  slug text not null unique,
  title text not null,
  category text not null references project_categories (slug),
  summary text not null,
  description text not null,
  difficulty difficulty not null,
  safety_level safety_level not null,
  indoor boolean not null default true,
  renter_friendly boolean not null default false,
  requires_permit_or_pro boolean not null default false,
  permit_disclaimer text,
  active_minutes integer not null,
  total_minutes integer not null,
  cost_band cost_band not null,
  estimated_cost_low_cents integer not null,
  estimated_cost_high_cents integer not null,
  recommended_people integer not null default 1,
  skill_prerequisites text[] not null default '{}',
  preparation text[] not null default '{}',
  safety_equipment text[] not null default '{}',
  common_mistakes text[] not null default '{}',
  do_not_attempt_if text[] not null default '{}',
  call_professional_if text[] not null default '{}',
  image_alt text not null default '',
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists projects_category_idx on projects (category);
create index if not exists projects_difficulty_idx on projects (difficulty);
create index if not exists projects_featured_idx on projects (featured);

create table if not exists project_tools (
  project_id text not null references projects (id) on delete cascade,
  tool_id text not null references tools (id),
  optional boolean not null default false,
  note text,
  primary key (project_id, tool_id)
);

create table if not exists project_materials (
  project_id text not null references projects (id) on delete cascade,
  material_id text not null references materials (id),
  quantity integer not null default 1,
  note text,
  primary key (project_id, material_id)
);

create table if not exists project_steps (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  step_order integer not null,
  title text not null,
  instructions text not null,
  estimated_minutes integer not null,
  why_it_matters text not null default '',
  beginner_tip text not null default '',
  common_mistake text not null default '',
  image_alt text not null default ''
);
create index if not exists project_steps_project_idx on project_steps (project_id, step_order);

create table if not exists step_tools (
  step_id text not null references project_steps (id) on delete cascade,
  tool_id text not null references tools (id),
  primary key (step_id, tool_id)
);

create table if not exists step_materials (
  step_id text not null references project_steps (id) on delete cascade,
  material_id text not null references materials (id),
  quantity integer,
  primary key (step_id, material_id)
);

create table if not exists safety_warnings (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  step_id text references project_steps (id) on delete cascade,
  level safety_level not null,
  title text not null,
  detail text not null,
  requires_acknowledgment boolean not null default false
);

create table if not exists troubleshooting_entries (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  step_id text references project_steps (id) on delete cascade,
  keywords text[] not null default '{}',
  symptom text not null,
  likely_causes text[] not null default '{}',
  safe_checks text[] not null default '{}',
  corrective_actions text[] not null default '{}',
  stop_if text[] not null default '{}',
  call_professional_if text[] not null default '{}'
);
create index if not exists troubleshooting_project_idx on troubleshooting_entries (project_id);

-- ---------------------------------------------------------------------------
-- Per-user tables (RLS-protected)
-- ---------------------------------------------------------------------------
create table if not exists user_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  status project_status not null default 'in_progress',
  current_step_index integer not null default 0,
  steps jsonb not null default '[]'::jsonb,
  acknowledged_warnings text[] not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);
create index if not exists user_projects_user_idx on user_projects (user_id);

create table if not exists saved_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  saved_at timestamptz not null default now(),
  unique (user_id, project_id)
);
create index if not exists saved_projects_user_idx on saved_projects (user_id);

create table if not exists user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null references projects (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_notes_user_idx on user_notes (user_id);

create table if not exists user_tool_inventory (
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_id text not null references tools (id),
  owned_at timestamptz not null default now(),
  primary key (user_id, tool_id)
);

create table if not exists shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references projects (id) on delete set null,
  ref_id text,
  name text not null,
  department text not null default 'other',
  quantity integer not null default 1,
  estimated_unit_cost_cents integer not null default 0,
  owned boolean not null default false,
  purchased boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shopping_list_items_user_idx on shopping_list_items (user_id);
