/**
 * Triangle-mesh geometry analysis.
 *
 * What a triangle mesh CAN tell us: enclosed volume, surface area, bounding
 * box, volume centroid, triangle count, whether the surface is closed and
 * manifold, and whether any triangles are degenerate.
 *
 * What a triangle mesh CANNOT tell us, and what this module therefore never
 * reports: material, density, mass, wall thickness intent, tolerances,
 * manufacturing process, pressure rating, or how the part is assembled to
 * anything else. Those must come from the user or a datasheet.
 */

export interface Mesh {
  /** Flat array of vertex coordinates, 9 numbers per triangle. */
  positions: Float32Array;
  triangleCount: number;
  /** Units the file is expressed in, if the format declares them. */
  declaredUnit?: string;
}

export interface MeshAnalysis {
  triangleCount: number;
  /** Signed volume of the closed surface, in file units^3. */
  volume: number;
  surfaceArea: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
  /** Centroid of the enclosed volume (valid only if watertight). */
  volumeCentroid: [number, number, number];
  /** Area-weighted centroid of the surface — always computable. */
  surfaceCentroid: [number, number, number];
  vertexCount: number;
  uniqueVertexCount: number;
  edgeCount: number;
  /** Every edge shared by exactly two triangles. */
  isManifold: boolean;
  /** Manifold and consistently oriented, so the enclosed volume is meaningful. */
  isWatertight: boolean;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  /** Negative volume means the triangle winding is inverted. */
  invertedWinding: boolean;
  /** Principal dimensions of the bounding box, largest first. */
  principalDimensions: [number, number, number];
  warnings: string[];
  notes: string[];
}

const KEY = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export function analyzeMesh(mesh: Mesh, tolerance = 1e-9): MeshAnalysis {
  const warnings: string[] = [];
  const notes: string[] = [];
  const pos = mesh.positions;
  const triCount = mesh.triangleCount;

  let volume = 0;
  let area = 0;
  let degenerate = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  // Volume centroid accumulator: sum over tets of (centroid * signedVolume).
  const cVol: [number, number, number] = [0, 0, 0];
  const cSurf: [number, number, number] = [0, 0, 0];

  // Vertex welding for topology.
  const vertexMap = new Map<string, number>();
  const indices: number[] = [];
  const quant = (v: number) => Math.round(v / Math.max(tolerance, 1e-12)) * Math.max(tolerance, 1e-12);

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];

    for (const [x, y, z] of [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ] as [number, number, number][]) {
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
      const k = `${quant(x)},${quant(y)},${quant(z)}`;
      let idx = vertexMap.get(k);
      if (idx === undefined) {
        idx = vertexMap.size;
        vertexMap.set(k, idx);
      }
      indices.push(idx);
    }

    // Signed volume of the tetrahedron (origin, a, b, c) = a . (b x c) / 6
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    volume += v;
    cVol[0] += ((ax + bx + cx) / 4) * v;
    cVol[1] += ((ay + by + cy) / 4) * v;
    cVol[2] += ((az + bz + cz) / 4) * v;

    // Triangle area from half the cross product magnitude.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const triArea = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(triArea > tolerance)) degenerate++;
    area += triArea;
    cSurf[0] += ((ax + bx + cx) / 3) * triArea;
    cSurf[1] += ((ay + by + cy) / 3) * triArea;
    cSurf[2] += ((az + bz + cz) / 3) * triArea;
  }

  // Edge topology
  const edgeUse = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    for (const [a, b] of [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ]) {
      const k = KEY(a, b);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const count of edgeUse.values()) {
    if (count === 1) boundary++;
    else if (count > 2) nonManifold++;
  }
  const manifold = boundary === 0 && nonManifold === 0;
  const inverted = volume < 0;
  const absVolume = Math.abs(volume);
  const watertight = manifold && absVolume > 0;

  if (triCount === 0) warnings.push("The file contains no triangles.");
  if (boundary > 0) {
    warnings.push(
      `The mesh has ${boundary} boundary edge(s) — it is NOT closed. The enclosed volume reported below is meaningless for an open surface. Repair the mesh in your CAD or slicer before using it for a displacement estimate.`,
    );
  }
  if (nonManifold > 0) {
    warnings.push(
      `${nonManifold} edge(s) are shared by more than two triangles (non-manifold). The volume calculation assumes a clean two-manifold surface.`,
    );
  }
  if (degenerate > 0) {
    warnings.push(`${degenerate} degenerate (zero-area) triangle(s) found. They do not affect the volume but often indicate an export problem.`);
  }
  if (inverted && manifold) {
    warnings.push("The computed volume is negative, meaning the triangle winding is inverted. The magnitude has been used; check the mesh normals.");
  }
  notes.push(
    "Volume, area and bounding box are in whatever length unit the file uses. STL and OBJ files carry NO unit information — you must state the unit when importing.",
  );
  notes.push(
    "A mesh describes a surface only. It cannot tell you the part's material, density, mass, wall-thickness intent, tolerances, manufacturing process or pressure rating.",
  );
  if (watertight) {
    notes.push("The surface is closed and manifold, so the enclosed volume and volume centroid are geometrically valid.");
  }

  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const principal = ([...size] as number[]).sort((a, b) => b - a) as [number, number, number];

  return {
    triangleCount: triCount,
    volume: absVolume,
    surfaceArea: area,
    boundingBox: {
      min: triCount ? min : [0, 0, 0],
      max: triCount ? max : [0, 0, 0],
      size: triCount ? size : [0, 0, 0],
    },
    volumeCentroid: absVolume > 0 ? [cVol[0] / volume, cVol[1] / volume, cVol[2] / volume] : [NaN, NaN, NaN],
    surfaceCentroid: area > 0 ? [cSurf[0] / area, cSurf[1] / area, cSurf[2] / area] : [NaN, NaN, NaN],
    vertexCount: triCount * 3,
    uniqueVertexCount: vertexMap.size,
    edgeCount: edgeUse.size,
    isManifold: manifold,
    isWatertight: watertight,
    boundaryEdgeCount: boundary,
    nonManifoldEdgeCount: nonManifold,
    degenerateTriangleCount: degenerate,
    invertedWinding: inverted,
    principalDimensions: principal,
    warnings,
    notes,
  };
}
