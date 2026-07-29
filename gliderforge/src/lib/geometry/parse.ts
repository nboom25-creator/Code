import { analyzeMesh, type Mesh, type MeshAnalysis } from "./mesh";

/**
 * Geometry file parsing.
 *
 * Supported for full geometric analysis:  STL (binary and ASCII), OBJ.
 * Supported for metadata extraction only: STEP/STP, IGES/IGS.
 * Recognised but not parsed:              3MF and everything else.
 *
 * When a format cannot be parsed the file is still stored and the user is
 * told precisely what could and could not be extracted. The application never
 * claims to have read something it has not read.
 */

export type GeometryFormat = "stl" | "obj" | "step" | "iges" | "3mf" | "unknown";

export interface ParseResult {
  format: GeometryFormat;
  /** True when a triangle mesh was produced and analysed. */
  meshAvailable: boolean;
  mesh?: Mesh;
  analysis?: MeshAnalysis;
  /** Key/value metadata read from the file header, if any. */
  metadata: Record<string, string>;
  /** Things this parse definitely did NOT determine. */
  notExtracted: string[];
  warnings: string[];
  fallback?: string;
}

export function detectFormat(filename: string): GeometryFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "stl") return "stl";
  if (ext === "obj") return "obj";
  if (ext === "step" || ext === "stp") return "step";
  if (ext === "iges" || ext === "igs") return "iges";
  if (ext === "3mf") return "3mf";
  return "unknown";
}

const UNIVERSAL_NOT_EXTRACTED = [
  "Material and density — a geometry file does not carry them.",
  "Mass — cannot be derived without a density you supply.",
  "Tolerances and GD&T.",
  "Manufacturing intent (machined, printed, moulded) and process parameters.",
  "Internal pressure rating or any structural allowable.",
  "Assembly relationships, mates or joints between parts.",
];

/* ------------------------------------------------------------------ */
/* STL                                                                 */
/* ------------------------------------------------------------------ */

function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const expected = 84 + triangles * 50;
  if (expected === buffer.byteLength) return true;
  // Fall back to sniffing the header for the ASCII "solid" keyword.
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)));
  return !head.trimStart().toLowerCase().startsWith("solid");
}

export function parseSTL(buffer: ArrayBuffer): { mesh: Mesh; warnings: string[] } {
  const warnings: string[] = [];
  if (isBinarySTL(buffer)) {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const expected = 84 + count * 50;
    if (expected !== buffer.byteLength) {
      warnings.push(
        `Binary STL header declares ${count} triangles (${expected} bytes) but the file is ${buffer.byteLength} bytes. The file may be truncated; only complete triangles were read.`,
      );
    }
    const usable = Math.min(count, Math.floor((buffer.byteLength - 84) / 50));
    const positions = new Float32Array(usable * 9);
    let o = 84;
    for (let i = 0; i < usable; i++) {
      o += 12; // skip the stored normal; normals are recomputed from winding
      for (let v = 0; v < 9; v++) {
        positions[i * 9 + v] = view.getFloat32(o, true);
        o += 4;
      }
      o += 2; // attribute byte count
    }
    return { mesh: { positions, triangleCount: usable }, warnings };
  }

  // ASCII
  const text = new TextDecoder().decode(buffer);
  const nums: number[] = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    nums.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (nums.length % 9 !== 0) {
    warnings.push(`ASCII STL contains ${nums.length / 3} vertices, which is not a whole number of triangles. Trailing incomplete data was ignored.`);
  }
  const triangleCount = Math.floor(nums.length / 9);
  return {
    mesh: { positions: new Float32Array(nums.slice(0, triangleCount * 9)), triangleCount },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* OBJ                                                                 */
/* ------------------------------------------------------------------ */

export function parseOBJ(text: string): { mesh: Mesh; warnings: string[] } {
  const warnings: string[] = [];
  const verts: number[] = [];
  const tris: number[] = [];
  const lines = text.split(/\r?\n/);
  let quadCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const parts = trimmed.split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (trimmed.startsWith("f ")) {
      const parts = trimmed.split(/\s+/).slice(1);
      const idx = parts.map((p) => {
        const first = p.split("/")[0];
        const n = parseInt(first, 10);
        return n < 0 ? verts.length / 3 + n : n - 1;
      });
      if (idx.length > 3) quadCount++;
      // Fan-triangulate any polygon.
      for (let i = 1; i + 1 < idx.length; i++) {
        for (const j of [idx[0], idx[i], idx[i + 1]]) {
          tris.push(verts[j * 3], verts[j * 3 + 1], verts[j * 3 + 2]);
        }
      }
    }
  }
  if (quadCount > 0) {
    warnings.push(`${quadCount} face(s) had more than three vertices and were fan-triangulated. For a non-planar or concave polygon this changes the surface slightly.`);
  }
  const triangleCount = Math.floor(tris.length / 9);
  return { mesh: { positions: new Float32Array(tris), triangleCount }, warnings };
}

/* ------------------------------------------------------------------ */
/* STEP / IGES metadata only                                           */
/* ------------------------------------------------------------------ */

export function parseSTEPMetadata(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const nameMatch = text.match(/FILE_NAME\s*\(([\s\S]*?)\)\s*;/i);
  if (nameMatch) {
    const parts = nameMatch[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    if (parts[0]) meta["Declared file name"] = parts[0];
    if (parts[1]) meta["Timestamp"] = parts[1];
    if (parts[4]) meta["Originating system"] = parts[4].replace(/^\(|\)$/g, "");
  }
  const descMatch = text.match(/FILE_DESCRIPTION\s*\(\s*\(([\s\S]*?)\)/i);
  if (descMatch) meta["Description"] = descMatch[1].replace(/'/g, "").trim();
  const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  if (schema) meta["Schema"] = schema[1];
  const entities = (text.match(/^#\d+\s*=/gm) ?? []).length;
  meta["Entity count"] = String(entities);
  const solids = (text.match(/MANIFOLD_SOLID_BREP/gi) ?? []).length;
  if (solids) meta["MANIFOLD_SOLID_BREP entities"] = String(solids);
  const units = text.match(/SI_UNIT\s*\(\s*(\.\w+\.)?\s*,?\s*(\.\w+\.)/i);
  if (units) meta["Declared SI unit tokens"] = `${units[1] ?? ""} ${units[2] ?? ""}`.trim();
  return meta;
}

export function parseIGESMetadata(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const globalLines = text.split(/\r?\n/).filter((l) => l.length > 72 && l[72] === "G");
  if (globalLines.length > 0) {
    const g = globalLines.map((l) => l.slice(0, 72)).join("");
    meta["Global section"] = g.slice(0, 240).trim();
  }
  const counts = { D: 0, P: 0, S: 0 };
  for (const l of text.split(/\r?\n/)) {
    if (l.length > 72) {
      const c = l[72];
      if (c === "D") counts.D++;
      else if (c === "P") counts.P++;
      else if (c === "S") counts.S++;
    }
  }
  meta["Directory entries"] = String(counts.D);
  meta["Parameter data lines"] = String(counts.P);
  return meta;
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export async function parseGeometry(filename: string, buffer: ArrayBuffer): Promise<ParseResult> {
  const format = detectFormat(filename);
  const warnings: string[] = [];

  if (format === "stl" || format === "obj") {
    const { mesh, warnings: w } =
      format === "stl" ? parseSTL(buffer) : parseOBJ(new TextDecoder().decode(buffer));
    warnings.push(...w);
    if (mesh.triangleCount === 0) {
      return {
        format,
        meshAvailable: false,
        metadata: {},
        notExtracted: UNIVERSAL_NOT_EXTRACTED,
        warnings: [...warnings, "No triangles could be read from this file."],
        fallback:
          "The file was stored but no geometry was recovered. Re-export it from your CAD package, or enter the volume and bounding dimensions manually.",
      };
    }
    const analysis = analyzeMesh(mesh);
    return {
      format,
      meshAvailable: true,
      mesh,
      analysis,
      metadata: { "Triangle count": String(mesh.triangleCount) },
      notExtracted: [
        ...UNIVERSAL_NOT_EXTRACTED,
        "Units — neither STL nor OBJ records a unit. You must declare it on import.",
        "Which faces are internal versus external — a mesh has no notion of a sealed cavity.",
      ],
      warnings,
    };
  }

  if (format === "step") {
    const text = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 2_000_000)));
    return {
      format,
      meshAvailable: false,
      metadata: parseSTEPMetadata(text),
      notExtracted: [
        ...UNIVERSAL_NOT_EXTRACTED,
        "Volume, surface area, bounding box and centroid — evaluating a STEP B-rep requires a full geometry kernel, which this application does not embed.",
      ],
      warnings: [
        "STEP files are B-rep (exact surface) models. Only the header metadata was read; no geometry was evaluated. Nothing in the mass or buoyancy budget will use this file until you supply values yourself.",
      ],
      fallback:
        "To get volume and bounding dimensions from this part: export an STL from your CAD package with a fine chord tolerance and upload that alongside the STEP, or read the mass properties out of your CAD package and type them in, marking them as CAD-derived.",
    };
  }

  if (format === "iges") {
    const text = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 2_000_000)));
    return {
      format,
      meshAvailable: false,
      metadata: parseIGESMetadata(text),
      notExtracted: [
        ...UNIVERSAL_NOT_EXTRACTED,
        "Volume, surface area and centroid — IGES commonly carries surfaces without a closed solid, so a volume may not even be defined.",
      ],
      warnings: ["Only the IGES global/directory sections were read. No geometry was evaluated."],
      fallback: "Export an STL for geometric analysis, or enter volume and dimensions manually.",
    };
  }

  if (format === "3mf") {
    return {
      format,
      meshAvailable: false,
      metadata: {},
      notExtracted: [...UNIVERSAL_NOT_EXTRACTED, "Mesh geometry — 3MF is a ZIP container and is not unpacked by this application."],
      warnings: ["3MF files are recognised and stored but not parsed."],
      fallback: "Export the same part as STL and upload that for geometric analysis.",
    };
  }

  return {
    format: "unknown",
    meshAvailable: false,
    metadata: {},
    notExtracted: UNIVERSAL_NOT_EXTRACTED,
    warnings: [`The extension of "${filename}" is not a geometry format this application parses.`],
    fallback: "The file has been stored as an attachment. Enter any values you need from it manually.",
  };
}
