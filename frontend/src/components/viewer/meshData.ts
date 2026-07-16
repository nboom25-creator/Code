import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Parsed mesh bundle.
 *
 * STL is a triangle soup: `soup` is the non-indexed geometry (3 vertices per
 * triangle, in STL triangle order) used for rendering with per-face colors.
 * `merged` is an indexed geometry produced by identical-coordinate vertex
 * merging — the backend's per-vertex scalar fields are in THIS vertex order,
 * and triangle order is preserved by mergeVertices, so backend triangle
 * indices == soup face indices == merged face indices.
 */
export interface MeshData {
  soup: THREE.BufferGeometry;
  merged: THREE.BufferGeometry;
  /** merged.index array: soup vertex j (0..3F-1) -> merged vertex id */
  mergedIndex: ArrayLike<number>;
  mergedVertexCount: number;
  faceCount: number;
  faceNormals: Float32Array; // 3 per face
  faceCentroids: Float32Array; // 3 per face
  /** face -> [n0,n1,n2] neighbor faces (-1 when boundary) */
  adjacency: Int32Array;
  bbox: THREE.Box3;
  boundingSphere: THREE.Sphere;
}

export function parseStl(buffer: ArrayBuffer): MeshData {
  const loader = new STLLoader();
  const soup = loader.parse(buffer);
  soup.deleteAttribute('normal'); // recompute smooth-ish normals below
  soup.computeVertexNormals();

  // Merge by coordinates only: strip every attribute except position so that
  // vertices at identical coordinates merge regardless of normals.
  const posOnly = new THREE.BufferGeometry();
  posOnly.setAttribute('position', soup.getAttribute('position').clone());
  const merged = mergeVertices(posOnly, 1e-6);
  const mergedIndex = merged.index ? merged.index.array : new Uint32Array(0);
  const mergedVertexCount = merged.getAttribute('position').count;

  const pos = soup.getAttribute('position').array as Float32Array;
  const faceCount = pos.length / 9;

  const faceNormals = new Float32Array(faceCount * 3);
  const faceCentroids = new Float32Array(faceCount * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    a.set(pos[o], pos[o + 1], pos[o + 2]);
    b.set(pos[o + 3], pos[o + 4], pos[o + 5]);
    c.set(pos[o + 6], pos[o + 7], pos[o + 8]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    ab.cross(ac).normalize();
    faceNormals[f * 3] = ab.x;
    faceNormals[f * 3 + 1] = ab.y;
    faceNormals[f * 3 + 2] = ab.z;
    faceCentroids[f * 3] = (a.x + b.x + c.x) / 3;
    faceCentroids[f * 3 + 1] = (a.y + b.y + c.y) / 3;
    faceCentroids[f * 3 + 2] = (a.z + b.z + c.z) / 3;
  }

  // Face adjacency from merged-vertex identity: edges shared by two faces.
  const adjacency = new Int32Array(faceCount * 3).fill(-1);
  const edgeMap = new Map<number, number>(); // edge key -> face*3+slot
  const V = mergedVertexCount + 1;
  for (let f = 0; f < faceCount; f++) {
    const v0 = mergedIndex[f * 3];
    const v1 = mergedIndex[f * 3 + 1];
    const v2 = mergedIndex[f * 3 + 2];
    const edges: [number, number][] = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];
    for (let e = 0; e < 3; e++) {
      const [x, y] = edges[e];
      const key = x < y ? x * V + y : y * V + x;
      const prev = edgeMap.get(key);
      if (prev === undefined) {
        edgeMap.set(key, f * 3 + e);
      } else {
        const pf = Math.floor(prev / 3);
        // fill first free slot on both faces
        for (let s = 0; s < 3; s++) {
          if (adjacency[f * 3 + s] === -1) {
            adjacency[f * 3 + s] = pf;
            break;
          }
        }
        for (let s = 0; s < 3; s++) {
          if (adjacency[pf * 3 + s] === -1) {
            adjacency[pf * 3 + s] = f;
            break;
          }
        }
        edgeMap.delete(key);
      }
    }
  }

  soup.computeBoundingBox();
  soup.computeBoundingSphere();

  // color attribute for heatmaps / selection / regions
  const colors = new Float32Array(pos.length).fill(1);
  soup.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return {
    soup,
    merged,
    mergedIndex,
    mergedVertexCount,
    faceCount,
    faceNormals,
    faceCentroids,
    adjacency,
    bbox: soup.boundingBox!.clone(),
    boundingSphere: soup.boundingSphere!.clone(),
  };
}

/** Flood-fill from a seed face across adjacency, limited by deviation of face
 * normals from the SEED face's normal. */
export function floodFillSelect(
  data: MeshData,
  seedFace: number,
  angleThresholdDeg: number,
): Set<number> {
  const { adjacency, faceNormals } = data;
  const cosLimit = Math.cos((angleThresholdDeg * Math.PI) / 180);
  const nx = faceNormals[seedFace * 3];
  const ny = faceNormals[seedFace * 3 + 1];
  const nz = faceNormals[seedFace * 3 + 2];
  const out = new Set<number>([seedFace]);
  const stack = [seedFace];
  while (stack.length) {
    const f = stack.pop()!;
    for (let s = 0; s < 3; s++) {
      const nb = adjacency[f * 3 + s];
      if (nb < 0 || out.has(nb)) continue;
      const dot =
        faceNormals[nb * 3] * nx + faceNormals[nb * 3 + 1] * ny + faceNormals[nb * 3 + 2] * nz;
      if (dot >= cosLimit) {
        out.add(nb);
        stack.push(nb);
      }
    }
  }
  return out;
}

/** Faces whose centroid lies within `radius` of `point`. */
export function brushSelect(data: MeshData, point: THREE.Vector3, radius: number): number[] {
  const { faceCentroids, faceCount } = data;
  const r2 = radius * radius;
  const out: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    const dx = faceCentroids[f * 3] - point.x;
    const dy = faceCentroids[f * 3 + 1] - point.y;
    const dz = faceCentroids[f * 3 + 2] - point.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(f);
  }
  return out;
}

export function regionCentroid(data: MeshData, triangleIndices: number[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  let n = 0;
  for (const t of triangleIndices) {
    if (t < 0 || t >= data.faceCount) continue;
    c.x += data.faceCentroids[t * 3];
    c.y += data.faceCentroids[t * 3 + 1];
    c.z += data.faceCentroids[t * 3 + 2];
    n++;
  }
  if (n > 0) c.divideScalar(n);
  return c;
}

export function averageNormal(data: MeshData, triangleIndices: number[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (const t of triangleIndices) {
    if (t < 0 || t >= data.faceCount) continue;
    n.x += data.faceNormals[t * 3];
    n.y += data.faceNormals[t * 3 + 1];
    n.z += data.faceNormals[t * 3 + 2];
  }
  if (n.lengthSq() > 0) n.normalize();
  else n.set(0, 0, 1);
  return n;
}
