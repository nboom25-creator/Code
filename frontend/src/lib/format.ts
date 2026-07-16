// Formatting helpers — every numeric display carries its unit.

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(digits - 1);
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** Length in mesh/project units, e.g. "12.4 mm" or "12.4 mesh units". */
export function fmtLength(v: number | null | undefined, unit: string | null, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${fmt(v, digits)} ${unit ?? 'mesh units'}`;
}

/** Stress: Pa -> MPa. */
export function fmtStressMPa(pa: number | null | undefined): string {
  if (pa === null || pa === undefined || Number.isNaN(pa)) return '—';
  return `${fmt(pa / 1e6, 4)} MPa`;
}

/** Displacement: metres -> mm. */
export function fmtDispMm(m: number | null | undefined): string {
  if (m === null || m === undefined || Number.isNaN(m)) return '—';
  return `${fmt(m * 1000, 4)} mm`;
}

/** Mass: kg, or g below 0.1 kg. */
export function fmtMass(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '—';
  if (Math.abs(kg) < 0.1) return `${fmt(kg * 1000, 3)} g`;
  return `${fmt(kg, 3)} kg`;
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtVec(v: number[] | null | undefined, digits = 2): string {
  if (!v) return '—';
  return `(${v.map((x) => fmt(x, digits)).join(', ')})`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 10) : '—';
}

/** GPa/MPa/kg-m3 display of SI material properties. */
export function fmtMaterialProp(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  const v = value as number;
  switch (key) {
    case 'density':
      return `${fmt(v, 4)} kg/m³`;
    case 'elastic_modulus':
      return `${fmt(v / 1e9, 4)} GPa`;
    case 'yield_strength':
    case 'ultimate_tensile_strength':
    case 'compressive_strength':
    case 'shear_strength':
      return `${fmt(v / 1e6, 4)} MPa`;
    case 'poisson_ratio':
      return fmt(v, 3);
    case 'max_service_temp_c':
      return `${fmt(v, 1)} °C`;
    case 'thermal_expansion':
      return `${v.toExponential(2)} 1/K`;
    default:
      return fmt(v, 4);
  }
}

export const TERM_TOOLTIPS: Record<string, string> = {
  von_mises:
    'von Mises stress: a scalar combination of all stress components used to predict yielding of ductile materials.',
  fos: 'Factor of safety: material yield strength divided by the computed stress. Values below ~1.5-2 usually need attention.',
  watertight:
    'Watertight: the surface mesh is fully closed (no boundary edges), which is required for volume, mass and FEA meshing.',
  manifold:
    'Manifold: every edge is shared by exactly two faces. Non-manifold geometry cannot be meshed for simulation.',
  singularity:
    'Stress singularity: at sharp re-entrant corners or point constraints the theoretical stress is infinite, so the peak value grows with mesh refinement and is not physically meaningful.',
  p95: '95th percentile: 95% of nodal values lie below this. More robust than the raw peak, which can be dominated by a singularity.',
  layer_adhesion:
    'Layer adhesion factor: printed parts are weaker across layers (Z). Strengths are multiplied by this factor to model the worst-case direction.',
};
