import * as THREE from 'three';
import { colormap, NO_DATA_COLOR } from '../../lib/colormap';
import type { Region } from '../../api/types';
import type { MeshData } from './meshData';

export interface HeatmapResult {
  min: number;
  max: number;
  mode: 'per-vertex' | 'per-face';
  mismatch?: string;
}

const BASE: [number, number, number] = [0.72, 0.76, 0.82];
const SELECT: [number, number, number] = [0.22, 0.74, 0.97];
const HIGHLIGHT: [number, number, number] = [0.95, 0.35, 0.85];
const PROTECT_TINT: [number, number, number] = [0.96, 0.62, 0.2];

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * Recompute the soup geometry's color attribute from all active layers:
 * base -> heatmap -> saved regions -> live selection -> highlight.
 * Returns heatmap min/max for the legend (null when no heatmap active).
 */
export function applyColorLayers(
  data: MeshData,
  opts: {
    heatmapValues?: number[] | null;
    heatmapIsThickness?: boolean;
    regions?: Region[];
    selection?: Set<number>;
    highlight?: number[] | null;
  },
): HeatmapResult | null {
  const attr = data.soup.getAttribute('color') as THREE.BufferAttribute;
  const colors = attr.array as Float32Array;
  const F = data.faceCount;

  // --- base
  for (let i = 0; i < F * 9; i += 3) {
    colors[i] = BASE[0];
    colors[i + 1] = BASE[1];
    colors[i + 2] = BASE[2];
  }

  // --- heatmap
  let heat: HeatmapResult | null = null;
  const vals = opts.heatmapValues;
  if (vals && vals.length > 0) {
    const isThickness = !!opts.heatmapIsThickness;
    let min = Infinity;
    let max = -Infinity;
    for (const v of vals) {
      if ((isThickness && v < 0) || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const range = max - min || 1;

    const paintVertex = (soupVertex: number, v: number) => {
      const noData = isThickness && v < 0;
      const rgb = noData ? NO_DATA_COLOR : colormap((v - min) / range);
      colors[soupVertex * 3] = rgb[0];
      colors[soupVertex * 3 + 1] = rgb[1];
      colors[soupVertex * 3 + 2] = rgb[2];
    };

    if (vals.length === data.mergedVertexCount) {
      // per-vertex scalars in merged-vertex order (backend contract)
      for (let j = 0; j < F * 3; j++) paintVertex(j, vals[data.mergedIndex[j]]);
      heat = { min, max, mode: 'per-vertex' };
    } else if (vals.length === F) {
      // fall back: treat as per-face
      for (let f = 0; f < F; f++) {
        paintVertex(f * 3, vals[f]);
        paintVertex(f * 3 + 1, vals[f]);
        paintVertex(f * 3 + 2, vals[f]);
      }
      heat = {
        min,
        max,
        mode: 'per-face',
        mismatch: `Scalar count (${vals.length}) did not match merged vertex count (${data.mergedVertexCount}); used face-average fallback.`,
      };
    } else {
      heat = {
        min,
        max,
        mode: 'per-face',
        mismatch: `Scalar count (${vals.length}) matches neither merged vertices (${data.mergedVertexCount}) nor faces (${F}); heat map not applied.`,
      };
    }
  }

  const paintFace = (f: number, rgb: [number, number, number], blend = 1) => {
    if (f < 0 || f >= F) return;
    for (let k = 0; k < 3; k++) {
      const o = (f * 3 + k) * 3;
      colors[o] = colors[o] * (1 - blend) + rgb[0] * blend;
      colors[o + 1] = colors[o + 1] * (1 - blend) + rgb[1] * blend;
      colors[o + 2] = colors[o + 2] * (1 - blend) + rgb[2] * blend;
    }
  };

  // --- saved regions
  for (const region of opts.regions ?? []) {
    const rgb = hexToRgb(region.color || '#38bdf8');
    for (const t of region.triangle_indices) paintFace(t, rgb, 0.75);
    if (region.protected) {
      // hatched look approximation: tint every other triangle amber
      for (let i = 0; i < region.triangle_indices.length; i += 2) {
        paintFace(region.triangle_indices[i], PROTECT_TINT, 0.65);
      }
    }
  }

  // --- live selection
  if (opts.selection) {
    for (const f of opts.selection) paintFace(f, SELECT, 0.9);
  }

  // --- recommendation highlight
  if (opts.highlight) {
    for (const f of opts.highlight) paintFace(f, HIGHLIGHT, 0.9);
  }

  attr.needsUpdate = true;
  return heat;
}
