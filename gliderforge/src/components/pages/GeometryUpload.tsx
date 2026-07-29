"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../client";
import { Card, Field, SelectInput, Badge, ErrorNotice, Spinner } from "../ui";
import { convert } from "@/lib/units";

interface ParseSummary {
  format: string;
  meshAvailable: boolean;
  metadata: Record<string, string>;
  notExtracted: string[];
  warnings: string[];
  fallback?: string;
  analysis?: {
    triangleCount: number;
    volume: number;
    surfaceArea: number;
    boundingBox: { size: [number, number, number] };
    volumeCentroid: [number, number, number];
    isWatertight: boolean;
    isManifold: boolean;
    boundaryEdgeCount: number;
    nonManifoldEdgeCount: number;
    degenerateTriangleCount: number;
    principalDimensions: [number, number, number];
    warnings: string[];
    notes: string[];
  };
}

const UNITS = [
  { value: "mm", label: "millimetres" },
  { value: "cm", label: "centimetres" },
  { value: "m", label: "metres" },
  { value: "in", label: "inches" },
];

export function GeometryUpload({
  projectId,
  componentId,
  componentName,
  onDone,
}: {
  projectId: string;
  componentId?: string;
  componentName?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [unit, setUnit] = React.useState("mm");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ parse: ParseSummary; filename: string } | null>(null);
  const [applied, setApplied] = React.useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied(false);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("unit", unit);
      if (componentId) form.append("componentId", componentId);
      const res = await api.upload(projectId, form);
      if (res.kind === "geometry") {
        setResult({ parse: res.parse as ParseSummary, filename: file.name });
      } else {
        setResult(null);
        onDone?.();
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Mesh units are whatever the file used; STL and OBJ record none, so the
  // user declares it and we convert to SI here.
  const scale = React.useMemo(() => convert(1, unit, "m"), [unit]);
  const analysis = result?.parse.analysis;
  const volumeSI = analysis ? analysis.volume * scale ** 3 : undefined;
  const areaSI = analysis ? analysis.surfaceArea * scale ** 2 : undefined;

  const applyToComponent = async () => {
    if (!componentId || volumeSI === undefined || !analysis) return;
    setBusy(true);
    setError(null);
    try {
      await api.update(projectId, "components", componentId, {
        cad_volume_m3: volumeSI,
        bbox_x: analysis.boundingBox.size[0] * scale,
        bbox_y: analysis.boundingBox.size[1] * scale,
        bbox_z: analysis.boundingBox.size[2] * scale,
      });
      setApplied(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={componentName ? `Attach geometry to "${componentName}"` : "Upload geometry"}>
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectInput
          label="Units used in the file"
          value={unit}
          onChange={setUnit}
          options={UNITS}
          hint="STL and OBJ record NO unit information. You must declare it — a mesh exported in millimetres and read as metres is off by a factor of a billion in volume."
        />
        <Field label="File" hint="STL and OBJ are analysed geometrically. STEP and IGES are stored and their headers read, but their geometry is not evaluated. Maximum 25 MB.">
          <input
            type="file"
            className="gf-input"
            accept=".stl,.obj,.step,.stp,.iges,.igs,.3mf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
        </Field>
      </div>

      {busy && (
        <div className="mt-3">
          <Spinner label="Uploading and analysing…" />
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{result.filename}</span>
            <Badge tone="accent">{result.parse.format.toUpperCase()}</Badge>
            {result.parse.meshAvailable ? (
              <Badge tone={analysis?.isWatertight ? "good" : "warning"}>{analysis?.isWatertight ? "closed and manifold" : "not a closed solid"}</Badge>
            ) : (
              <Badge tone="neutral">metadata only — no geometry evaluated</Badge>
            )}
          </div>

          {analysis && (
            <>
              <div className="gf-scroll-x">
                <table className="gf-table">
                  <tbody>
                    <tr>
                      <td className="font-medium">Enclosed volume</td>
                      <td>
                        {analysis.isWatertight ? (
                          <>
                            {(volumeSI! * 1e6).toFixed(2)} cm³
                            <span className="ml-2 text-[11px] text-muted">({analysis.volume.toPrecision(6)} {unit}³ in file units)</span>
                          </>
                        ) : (
                          <span className="text-[#d03b3b]">not meaningful — the surface is not closed</span>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium">Surface area</td>
                      <td>{(areaSI! * 1e4).toFixed(1)} cm²</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Bounding box</td>
                      <td>
                        {analysis.boundingBox.size.map((s) => (s * scale * 1000).toFixed(1)).join(" × ")} mm
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium">Principal dimensions</td>
                      <td>{analysis.principalDimensions.map((s) => (s * scale * 1000).toFixed(1)).join(" × ")} mm</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Approximate centroid</td>
                      <td>
                        {analysis.isWatertight
                          ? analysis.volumeCentroid.map((c) => (c * scale * 1000).toFixed(1)).join(", ") + " mm (volume centroid)"
                          : "volume centroid undefined for an open surface"}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium">Triangles</td>
                      <td>{analysis.triangleCount.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Watertight / manifold</td>
                      <td>
                        {analysis.isWatertight ? "yes" : "no"} / {analysis.isManifold ? "yes" : "no"}
                        {analysis.boundaryEdgeCount > 0 && <span className="ml-2 text-[11px] text-[#d03b3b]">{analysis.boundaryEdgeCount} boundary edges</span>}
                        {analysis.nonManifoldEdgeCount > 0 && <span className="ml-2 text-[11px] text-[#d03b3b]">{analysis.nonManifoldEdgeCount} non-manifold edges</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-medium">Degenerate triangles</td>
                      <td>{analysis.degenerateTriangleCount}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {componentId && analysis.isWatertight && (
                <div className="flex items-center gap-2">
                  <button className="gf-btn gf-btn-primary" onClick={applyToComponent} disabled={busy || applied}>
                    {applied ? "Applied" : "Copy volume and bounding box to this component"}
                  </button>
                  <span className="text-[11px] text-muted">
                    Writes the CAD volume and bounding dimensions. It does not touch the displaced volume used in the budget — decide that
                    yourself, because a solid mesh volume and an external envelope volume are not the same thing.
                  </span>
                </div>
              )}
            </>
          )}

          {(analysis?.warnings.length ?? 0) > 0 && (
            <div className="rounded border border-[#fab219] p-2.5">
              <h4 className="text-xs font-semibold text-[#fab219]">Geometry warnings</h4>
              <ul className="ml-4 mt-1 list-disc space-y-1 text-[11px] text-muted">
                {analysis!.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.parse.warnings.length > 0 && (
            <div className="rounded border p-2.5">
              <h4 className="text-xs font-semibold">Parser notes</h4>
              <ul className="ml-4 mt-1 list-disc space-y-1 text-[11px] text-muted">
                {result.parse.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.parse.fallback && (
            <div className="rounded border border-[color:rgb(var(--accent))] p-2.5 text-[11px] leading-snug text-muted">
              <strong className="text-ink">What to do instead: </strong>
              {result.parse.fallback}
            </div>
          )}

          {Object.keys(result.parse.metadata).length > 0 && (
            <details className="rounded border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted">File metadata read from the header</summary>
              <div className="border-t p-3">
                <table className="gf-table">
                  <tbody>
                    {Object.entries(result.parse.metadata).map(([k, v]) => (
                      <tr key={k}>
                        <td className="font-medium">{k}</td>
                        <td className="break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="rounded border p-2.5">
            <h4 className="text-xs font-semibold">What this file does NOT tell us</h4>
            <ul className="ml-4 mt-1 list-disc space-y-1 text-[11px] text-muted">
              {result.parse.notExtracted.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>

          {onDone && (
            <button className="gf-btn" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
