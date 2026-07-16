// Typed mirrors of the FastAPI response shapes (see docs/api.md and backend/app/api/*.py).

export interface Capabilities {
  app: string;
  version: string;
  environment: string;
  fea_available: boolean;
  ccx_available: boolean;
  gmsh_available: boolean;
  boolean_engine: string;
  ai_provider: string;
  max_upload_bytes: number;
  max_triangles: number;
  step_export: boolean;
  step_export_note: string;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in';

export interface Project {
  id: string;
  name: string;
  description: string;
  unit: string | null;
  unit_confirmed: boolean;
  is_demo: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface UnitSuggestion {
  suggestion: string | null;
  reason: string;
  estimate?: boolean;
  note?: string;
}

export interface MeshVersion {
  id: string;
  project_id: string;
  parent_mesh_id: string | null;
  kind: 'original' | 'repaired' | 'variant';
  label: string;
  triangle_count: number;
  vertex_count: number;
  watertight: boolean;
  sha256: string | null;
  status: string;
  params: Record<string, unknown>;
  created_at: string | null;
}

export interface UploadResponse {
  asset: { id: string; filename: string; size_bytes: number; format: string; sha256: string };
  mesh_version: MeshVersion;
  unit_suggestion: UnitSuggestion;
}

export interface ScalarField {
  field: string;
  values: number[];
  note: string;
}

export type RepairOp =
  | 'remove_duplicate_faces'
  | 'remove_degenerate_faces'
  | 'merge_vertices'
  | 'fix_winding'
  | 'fix_normals'
  | 'fill_holes'
  | 'remove_small_components'
  | 'watertight_reconstruction';

export interface RepairHealthCounts {
  watertight: boolean;
  boundary_edge_count: number;
  non_manifold_edge_count: number;
  duplicate_face_count: number;
  degenerate_face_count: number;
  connected_components: number;
}

export interface RepairPreview {
  operations: string[];
  log: string[];
  before: RepairHealthCounts;
  after: RepairHealthCounts;
  triangle_count_before: number;
  triangle_count_after: number;
  note: string;
}

export interface RepairCommitResponse {
  mesh_version: MeshVersion;
  log: string[];
}

// ---------------------------------------------------------------- materials

export interface MaterialProperties {
  density?: number | null; // kg/m3
  elastic_modulus?: number | null; // Pa
  poisson_ratio?: number | null;
  yield_strength?: number | null; // Pa
  ultimate_tensile_strength?: number | null;
  compressive_strength?: number | null;
  shear_strength?: number | null;
  fatigue_data?: string | null;
  max_service_temp_c?: number | null;
  thermal_expansion?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface Material {
  id: string;
  key: string;
  name: string;
  category: string;
  isotropic: boolean;
  is_builtin: boolean;
  properties: MaterialProperties;
  source: string;
  notes: string;
  critical_properties: string[];
  values_are_estimates: boolean;
}

export type EffectiveProperties = MaterialProperties & {
  _adjustments?: string[];
};

export interface ProjectMaterial {
  material: Material;
  overrides: Record<string, number>;
  confirmed: boolean;
  effective_properties: EffectiveProperties;
}

export interface ManufacturingProfile {
  method: 'fdm' | 'sla' | 'sls' | 'cnc' | 'casting' | 'sheet' | 'unspecified';
  params: Record<string, unknown>;
}

export interface Preset {
  label: string;
  suggested_flags: string[];
  prompts: string[];
}

export interface PresetsResponse {
  presets: Record<string, Preset>;
  questionnaire: { key: string; label: string; type: string }[];
}

export interface UseCase {
  preset: string | null;
  free_text: string;
  answers: Record<string, unknown>;
  note?: string;
}

// ---------------------------------------------------------------- regions

export interface Region {
  id: string;
  project_id: string;
  mesh_version_id: string;
  name: string;
  kind: string;
  triangle_indices: number[];
  meta: Record<string, unknown>;
  color: string;
  protected: boolean;
  protect_reason: string | null;
}

// ---------------------------------------------------------------- load cases

export type BCType =
  | 'fixed'
  | 'pinned'
  | 'roller'
  | 'force'
  | 'pressure'
  | 'bearing'
  | 'torque'
  | 'gravity'
  | 'rotation'
  | 'symmetry';

export interface BCParams {
  distribution?: string;
  direction?: number[];
  axis_point?: number[];
  axis_direction?: number[];
  magnitude?: number;
  magnitude_si?: number;
  units?: string;
  omega_rad_s?: number;
  rpm?: number;
  [key: string]: unknown;
}

export interface BoundaryCondition {
  id: string;
  load_case_id: string;
  region_id: string | null;
  bc_type: BCType;
  params: BCParams;
  description: string;
}

export interface LoadCase {
  id: string;
  project_id: string;
  name: string;
  description: string;
  active: boolean;
  boundary_conditions: BoundaryCondition[];
}

export interface BCInput {
  bc_type: BCType;
  region_id?: string | null;
  description?: string;
  magnitude?: number | null;
  units?: string | null;
  direction?: number[] | null;
  distribution?: string;
  axis_point?: number[] | null;
  axis_direction?: number[] | null;
  rpm?: number | null;
  g?: number | null;
}

export interface LoadCaseValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------- jobs

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  project_id: string;
  kind: 'geometry_analysis' | 'fea' | 'variant_generation' | 'report';
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  result_ref: string | null;
  cancelled: boolean;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// ---------------------------------------------------------------- geometry analysis

export interface HealthIssue {
  code: string;
  severity: string;
  message: string;
}

export interface GeometryMetrics {
  triangle_count: number;
  vertex_count: number;
  bounding_box_mesh_units: { min: number[]; max: number[]; extents: number[] };
  surface_area_mesh_units2: number;
  watertight: boolean;
  volume_mesh_units3: number | null;
  volume_note: string | null;
  center_of_mass_mesh_units: number[];
  center_of_mass_note: string | null;
  principal_axes: number[][];
  unit: string | null;
  bounding_box_m?: number[];
  surface_area_m2?: number;
  volume_m3?: number;
  estimated_mass_kg?: number;
  mass_note?: string;
}

export interface GeometryHealth {
  watertight: boolean;
  winding_consistent: boolean;
  broken_face_count: number;
  boundary_edge_count: number;
  non_manifold_edge_count: number;
  duplicate_face_count: number;
  degenerate_face_count: number;
  skewed_triangle_count: number;
  connected_components: number;
  component_face_counts: number[];
  self_intersection: { checked: boolean; suspected?: boolean; status?: string; note?: string };
  issues: HealthIssue[];
}

export interface ThicknessStats {
  ok: boolean;
  sampled_faces?: number;
  valid_rays?: number;
  min_wall_estimate?: number;
  absolute_min?: number;
  max_wall_estimate?: number;
  median_wall?: number;
  method?: string;
  note?: string;
}

export interface OverhangStats {
  ok: boolean;
  build_direction?: number[];
  threshold_deg?: number;
  overhang_area?: number;
  overhang_fraction?: number;
  overhang_face_count?: number;
  unsupported_islands?: { face_count: number; area: number; centroid: number[] }[];
  trapped_volumes?: { component_index: number; approx_volume: number | null; centroid: number[] }[];
  note?: string;
}

export interface HoleCandidate {
  center: number[];
  axis: number[];
  radius: number;
  fit_error: number;
  fit_error_ratio: number;
  [key: string]: unknown;
}

export interface GeometryFeatures {
  planar_faces?: unknown[];
  hole_candidates?: HoleCandidate[];
  symmetry_planes?: unknown[];
  thickness?: ThicknessStats;
  overhang?: OverhangStats;
  note?: string;
}

export interface GeometryAnalysis {
  id: string;
  mesh_version_id: string;
  metrics: GeometryMetrics;
  health: GeometryHealth;
  features: GeometryFeatures;
  warnings: HealthIssue[];
  created_at: string | null;
}

// ---------------------------------------------------------------- FEA results

export interface ValidityGate {
  ok: boolean;
  detail: string;
}

export interface FeaSummary {
  element_type: string;
  node_count: number;
  element_count: number;
  mesh_quality: Record<string, number>;
  mesh_warnings: string[];
  converged: boolean;
  max_displacement_m: number | null;
  max_von_mises_pa: number | null;
  p95_von_mises_pa: number | null;
  p99_von_mises_pa: number | null;
  max_principal_stress_pa: number | null;
  min_principal_stress_pa: number | null;
  max_strain: number | null;
  max_vm_location_mesh_units: number[] | null;
  reactions_n: Record<string, number[] | number>;
  applied_loads: Record<string, unknown>;
  factor_of_safety_yield: number | null;
  factor_of_safety_p95: number | null;
  fos_valid: boolean;
  fos_note: string;
  singularity_suspected: boolean;
  validity_gates: Record<string, ValidityGate>;
  load_case_warnings: string[];
}

export interface SimulationResult {
  id: string;
  job_id: string;
  project_id: string;
  mesh_version_id: string;
  load_case_id: string;
  summary: FeaSummary;
  assumptions: string[];
  is_mock: boolean;
  created_at: string | null;
}

export interface ResultFields {
  positions: number[]; // flattened xyz, mesh units
  triangles: number[]; // flattened indices
  displacement_m: number[]; // flattened xyz, metres
  von_mises_pa: number[];
  s1_pa: number[];
  s3_pa: number[];
  unit_scale_to_m: number;
  note: string;
}

// ---------------------------------------------------------------- recommendations

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Recommendation {
  id: string;
  project_id: string;
  mesh_version_id: string;
  rule_id: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: 'low' | 'medium' | 'high';
  problem: string;
  evidence: Record<string, unknown>;
  location: { centroid?: number[]; triangle_indices?: number[]; [key: string]: unknown };
  rationale: string;
  proposed_change: string;
  expected_benefit: string;
  possible_downside: string;
  manufacturing_impact: string;
  validation_required: string;
  auto_generatable: boolean;
  assumptions: string[];
  state: 'open' | 'accepted' | 'dismissed';
}

// ---------------------------------------------------------------- variants

export interface VariantOperation {
  seq: number;
  op_type: string;
  status: 'applied' | 'failed' | 'rejected' | string;
  error: string | null;
  reason: string;
  recommendation_id: string | null;
  params: Record<string, unknown>;
}

export interface VariantMetrics {
  metrics?: GeometryMetrics;
  health?: Record<string, unknown>;
  issue_count?: number;
  min_wall_estimate?: number | null;
}

export interface DesignVariant {
  id: string;
  project_id: string;
  base_mesh_id: string;
  result_mesh_id: string | null;
  strategy: 'conservative' | 'balanced' | 'performance';
  name: string;
  status: string;
  error: string | null;
  score: number | null;
  metrics: VariantMetrics;
  approval: 'pending' | 'approved' | 'rejected';
  strategy_description: string;
  operations: VariantOperation[];
  created_at: string | null;
}

export interface VariantRecipe {
  variant_id: string;
  strategy: string;
  base_mesh_id: string;
  software: { app: string; version: string };
  coordinate_system: string;
  operations: unknown[];
}

// ---------------------------------------------------------------- comparison

export interface ComparisonRow {
  name: string;
  mass_kg: number | null;
  volume_m3: number | null;
  triangle_count: number | null;
  min_wall_estimate: number | null;
  max_displacement_m: number | null;
  max_von_mises_pa: number | null;
  p95_von_mises_pa: number | null;
  fos_yield: number | null;
  fos_valid: boolean | null;
  geometry_warning_count: number | null;
  overhang_fraction: number | null;
  deltas?: Record<string, number>;
  confidence?: string;
  score?: number | null;
}

export interface ComparisonResponse {
  baseline_mesh: MeshVersion;
  variants: { variant_id: string; result_mesh_id: string; strategy: string; approval: string }[];
  rows: ComparisonRow[];
  score_explanation: string;
}

// ---------------------------------------------------------------- reports / AI / demo

export interface ReportEntry {
  id: string;
  created_at: string | null;
  sha256: string | null;
}

export interface AIExplainResponse {
  provider: string;
  text: string;
  note: string;
}

export interface ProposedBC {
  bc_type: string;
  description: string;
  magnitude: number | null;
  units: string | null;
  direction: number[] | null;
  region_hint: string;
}

export interface LoadCaseProposal {
  name: string;
  rationale: string;
  boundary_conditions: ProposedBC[];
  open_questions: string[];
}

export interface AIProposeResponse {
  provider: string;
  proposal: LoadCaseProposal;
  note: string;
}

export interface DemoResponse {
  project: { id: string; name: string };
  jobs: { id: string; kind: string; status: string }[];
  note: string;
}

export interface SnapshotResponse {
  id: string;
  label: string;
}
