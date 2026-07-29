-- GliderForge Assistant schema (SQLite).
-- All engineering quantities are stored in SI base units. Display units are a
-- presentation concern and live in project settings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  phase         TEXT NOT NULL DEFAULT 'concept',
  is_sample     INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirements (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  category            TEXT NOT NULL,
  target_value        REAL,
  target_unit         TEXT,
  tolerance           TEXT,
  comparator          TEXT NOT NULL DEFAULT '<=',
  priority            TEXT NOT NULL DEFAULT 'should',
  source              TEXT,
  rationale           TEXT,
  verification_method TEXT NOT NULL DEFAULT 'test',
  verification_status TEXT NOT NULL DEFAULT 'not-verified',
  evidence_json       TEXT NOT NULL DEFAULT '[]',
  links_json          TEXT NOT NULL DEFAULT '{}',
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id);

CREATE TABLE IF NOT EXISTS components (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  part_number         TEXT,
  version             TEXT DEFAULT 'A',
  category            TEXT NOT NULL DEFAULT 'structure',
  material_id         TEXT,
  material_name       TEXT,
  manufacturing_method TEXT,
  measured_mass_kg    REAL,
  estimated_mass_kg   REAL,
  cad_volume_m3       REAL,
  user_volume_m3      REAL,
  displaced_volume_m3 REAL,
  internal_flooded_m3 REAL,
  sealed_volume_m3    REAL,
  density_kg_m3       REAL,
  cost                REAL,
  supplier            TEXT,
  datasheet_url       TEXT,
  pos_x REAL NOT NULL DEFAULT 0, pos_y REAL NOT NULL DEFAULT 0, pos_z REAL NOT NULL DEFAULT 0,
  rot_x REAL NOT NULL DEFAULT 0, rot_y REAL NOT NULL DEFAULT 0, rot_z REAL NOT NULL DEFAULT 0,
  com_x REAL NOT NULL DEFAULT 0, com_y REAL NOT NULL DEFAULT 0, com_z REAL NOT NULL DEFAULT 0,
  bbox_x REAL, bbox_y REAL, bbox_z REAL,
  displacement_mode   TEXT NOT NULL DEFAULT 'internal',
  quantity            INTEGER NOT NULL DEFAULT 1,
  include_in_budget   INTEGER NOT NULL DEFAULT 1,
  movable             INTEGER NOT NULL DEFAULT 0,
  min_x REAL, max_x REAL,
  color               TEXT,
  notes               TEXT,
  assumptions         TEXT,
  confidence          TEXT NOT NULL DEFAULT 'medium',
  geometry_file_id    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comp_project ON components(project_id);

CREATE TABLE IF NOT EXISTS material_overrides (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id  TEXT,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  source      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geometry_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id TEXT,
  filename     TEXT NOT NULL,
  stored_name  TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  mime         TEXT,
  format       TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'mm',
  parse_json   TEXT NOT NULL DEFAULT '{}',
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_project ON geometry_files(project_id);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  mime        TEXT,
  description TEXT,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS syringe_configs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buoyancy_states (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  stroke_fraction REAL NOT NULL DEFAULT 0,
  mass_delta_kg   REAL NOT NULL DEFAULT 0,
  volume_delta_m3 REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS electronics (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  part_number TEXT,
  current_a   REAL,
  voltage_v   REAL,
  duty_cycle  REAL NOT NULL DEFAULT 1,
  regulator_efficiency REAL NOT NULL DEFAULT 1,
  provenance  TEXT NOT NULL DEFAULT 'estimated',
  specs_json  TEXT NOT NULL DEFAULT '{}',
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pin_assignments (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  controller   TEXT NOT NULL,
  pin          TEXT NOT NULL,
  signal       TEXT NOT NULL,
  direction    TEXT NOT NULL DEFAULT 'input',
  peripheral   TEXT,
  wire_color   TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL
);

-- Immutable calculation snapshots. Never updated, only inserted.
CREATE TABLE IF NOT EXISTS calculation_runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  calc_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  label         TEXT,
  inputs_json   TEXT NOT NULL,
  results_json  TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  steps_json    TEXT NOT NULL DEFAULT '[]',
  confidence    TEXT,
  engine_version TEXT NOT NULL DEFAULT '1',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calc_project ON calculation_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS simulations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  inputs_json  TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  samples_json TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assumptions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  basis        TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  criticality  TEXT NOT NULL DEFAULT 'medium',
  related_type TEXT,
  related_id   TEXT,
  resolution_note TEXT,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  statement         TEXT NOT NULL,
  context           TEXT,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  criteria_json     TEXT NOT NULL DEFAULT '[]',
  scores_json       TEXT NOT NULL DEFAULT '{}',
  chosen            TEXT,
  advantages        TEXT,
  disadvantages     TEXT,
  risks             TEXT,
  evidence_json     TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'proposed',
  decided_on        TEXT,
  revision_reason   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  description   TEXT NOT NULL,
  cause         TEXT,
  consequence   TEXT,
  likelihood    INTEGER NOT NULL DEFAULT 3,
  severity      INTEGER NOT NULL DEFAULT 3,
  detectability INTEGER NOT NULL DEFAULT 3,
  mitigation    TEXT,
  contingency   TEXT,
  owner         TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  reviewed      INTEGER NOT NULL DEFAULT 0,
  is_starter    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  title               TEXT NOT NULL,
  objective           TEXT,
  requirement_ids_json TEXT NOT NULL DEFAULT '[]',
  equipment           TEXT,
  setup               TEXT,
  variables_json      TEXT NOT NULL DEFAULT '[]',
  procedure           TEXT,
  safety              TEXT,
  raw_fields_json     TEXT NOT NULL DEFAULT '[]',
  expected_result     TEXT,
  pass_criteria       TEXT,
  uncertainty_sources TEXT,
  status              TEXT NOT NULL DEFAULT 'planned',
  category            TEXT NOT NULL DEFAULT 'other',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_id            TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  run_label          TEXT NOT NULL,
  performed_on       TEXT,
  operator           TEXT,
  conditions_json    TEXT NOT NULL DEFAULT '{}',
  raw_csv            TEXT,
  columns_json       TEXT NOT NULL DEFAULT '[]',
  transformations_json TEXT NOT NULL DEFAULT '[]',
  result_summary     TEXT,
  conclusion         TEXT,
  pass_fail          TEXT,
  follow_up          TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_test ON test_runs(test_id);

CREATE TABLE IF NOT EXISTS notebook_entries (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'note',
  title          TEXT NOT NULL,
  body           TEXT,
  tags           TEXT,
  subsystem      TEXT,
  requirement_id TEXT,
  author         TEXT,
  revisions_json TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_project ON notebook_entries(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refs (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  citation   TEXT NOT NULL,
  url        TEXT,
  kind       TEXT NOT NULL DEFAULT 'other',
  notes      TEXT,
  added_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  detail     TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  priority   TEXT NOT NULL DEFAULT 'medium',
  due_date   TEXT,
  phase      TEXT,
  source     TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_date   TEXT,
  status     TEXT NOT NULL DEFAULT 'upcoming',
  notes      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  format       TEXT NOT NULL DEFAULT 'markdown',
  content      TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context        TEXT,
  recommendation TEXT NOT NULL,
  rationale      TEXT,
  proposed_change_json TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  edited_text    TEXT,
  safety_flag    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS design_variants (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  config_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Change log supporting undo of editable project data.
CREATE TABLE IF NOT EXISTS revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  actor       TEXT NOT NULL DEFAULT 'user',
  undone      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_project ON revisions(project_id, id DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  provider   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_project ON assistant_messages(project_id, created_at);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
