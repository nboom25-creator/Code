"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Card, Badge, Checkbox, SelectInput, Spinner, EmptyState } from "../ui";

/**
 * The 3D scene is loaded only in the browser: three.js and react-three-fiber
 * have no business in the server bundle, and a WebGL canvas cannot render
 * during SSR.
 */
const Scene = dynamic(() => import("./ViewerScene").then((m) => m.ViewerScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded border">
      <Spinner label="Loading 3D viewer…" />
    </div>
  ),
});

export interface ViewerComponent {
  id: string;
  name: string;
  category: string;
  material: string | null;
  displacementMode: string;
  confidence: string;
  color: string | null;
  position: [number, number, number];
  size: [number | null, number | null, number | null];
  massSI: number;
  volumeSI: number;
  hasMass: boolean;
  verified: boolean;
  includeInBudget: boolean;
  meshUrl: string | null;
  meshUnit: string | null;
  meshFormat: string | null;
  meshWatertight: boolean;
}

export type ColorMode = "subsystem" | "material" | "verification" | "displacement";

export function ViewerClient({
  components,
  cg,
  cb,
  hullLength,
  hullDiameter,
}: {
  components: ViewerComponent[];
  cg: { x: number; y: number; z: number };
  cb: { x: number; y: number; z: number };
  hullLength: number;
  hullDiameter: number;
}) {
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [opacity, setOpacity] = React.useState(0.75);
  const [showAxes, setShowAxes] = React.useState(true);
  const [showBBox, setShowBBox] = React.useState(true);
  const [showCentroids, setShowCentroids] = React.useState(false);
  const [showGrid, setShowGrid] = React.useState(true);
  const [clip, setClip] = React.useState(false);
  const [clipX, setClipX] = React.useState(0);
  const [colorMode, setColorMode] = React.useState<ColorMode>("subsystem");
  const [measureFrom, setMeasureFrom] = React.useState<string | null>(null);
  const [measureTo, setMeasureTo] = React.useState<string | null>(null);

  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const a = components.find((c) => c.id === measureFrom);
  const b = components.find((c) => c.id === measureTo);
  const distance =
    a && b
      ? Math.sqrt((a.position[0] - b.position[0]) ** 2 + (a.position[1] - b.position[1]) ** 2 + (a.position[2] - b.position[2]) ** 2)
      : null;

  if (components.length === 0) {
    return (
      <EmptyState
        title="Nothing to display"
        body="Add components with positions, and optionally bounding dimensions or an attached STL, to see the vehicle arrangement here."
        action={
          <a className="gf-btn gf-btn-primary" href="/components">
            Add components
          </a>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Scene
          components={components.filter((c) => !hidden.has(c.id))}
          cg={cg}
          cb={cb}
          hullLength={hullLength}
          hullDiameter={hullDiameter}
          opacity={opacity}
          showAxes={showAxes}
          showBBox={showBBox}
          showCentroids={showCentroids}
          showGrid={showGrid}
          colorMode={colorMode}
          clipX={clip ? clipX : null}
          measureFrom={a ?? null}
          measureTo={b ?? null}
        />
        <Card title="Reading the scene" dense>
          <div className="grid gap-2 p-3 text-[11px] leading-snug text-muted sm:grid-cols-2">
            <p>
              <strong className="text-ink">Rotate</strong> by dragging with the left mouse button, <strong className="text-ink">pan</strong>{" "}
              with the right button or two fingers, <strong className="text-ink">zoom</strong> with the wheel or a pinch.
            </p>
            <p>
              <strong className="text-ink">Frame:</strong> +x forward (towards the nose), +y to port, +z up. The origin is your datum. The
              red, green and blue axis lines are x, y and z respectively.
            </p>
            <p>
              <strong className="text-ink">CG marker</strong> is the filled sphere; <strong className="text-ink">CB marker</strong> is the
              wireframe sphere. For a stable submerged vehicle the wireframe sphere must sit above the filled one.
            </p>
            <p>
              Components with an attached STL or OBJ render as their real mesh, positioned at the component&apos;s coordinates. Others render
              as a bounding box, or a small placeholder cube if no bounding dimensions are recorded.
            </p>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        <Card title="Display" dense>
          <div className="space-y-3 p-3">
            <SelectInput
              label="Colour by"
              value={colorMode}
              onChange={(v) => setColorMode(v as ColorMode)}
              options={[
                { value: "subsystem", label: "Subsystem / category" },
                { value: "material", label: "Material" },
                { value: "verification", label: "Data confidence" },
                { value: "displacement", label: "Displacement mode" },
              ]}
            />
            <div>
              <label className="gf-label" htmlFor="opacity">
                Transparency ({(opacity * 100).toFixed(0)}% opaque)
              </label>
              <input
                id="opacity"
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="mt-1 w-full accent-[color:rgb(var(--accent))]"
              />
            </div>
            <Checkbox label="Coordinate axes" checked={showAxes} onChange={setShowAxes} />
            <Checkbox label="Overall bounding box" checked={showBBox} onChange={setShowBBox} />
            <Checkbox label="Component centroids" checked={showCentroids} onChange={setShowCentroids} />
            <Checkbox label="Ground grid" checked={showGrid} onChange={setShowGrid} />
            <Checkbox label="Section view (clip along x)" checked={clip} onChange={setClip} hint="Cuts the scene at a plane normal to the vehicle axis." />
            {clip && (
              <div>
                <label className="gf-label" htmlFor="clipx">
                  Clip plane at x = {(clipX * 1000).toFixed(0)} mm
                </label>
                <input
                  id="clipx"
                  type="range"
                  min={-0.1}
                  max={hullLength + 0.1}
                  step={0.005}
                  value={clipX}
                  onChange={(e) => setClipX(Number(e.target.value))}
                  className="mt-1 w-full accent-[color:rgb(var(--accent))]"
                />
              </div>
            )}
          </div>
        </Card>

        <Card title="Measure" dense>
          <div className="space-y-2 p-3">
            <SelectInput
              label="From component"
              value={measureFrom ?? ""}
              onChange={(v) => setMeasureFrom(v || null)}
              options={[{ value: "", label: "(none)" }, ...components.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <SelectInput
              label="To component"
              value={measureTo ?? ""}
              onChange={(v) => setMeasureTo(v || null)}
              options={[{ value: "", label: "(none)" }, ...components.map((c) => ({ value: c.id, label: c.name }))]}
            />
            {distance !== null && a && b && (
              <div className="rounded border p-2 text-xs">
                <div className="gf-num font-semibold">{(distance * 1000).toFixed(1)} mm</div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Δx {((b.position[0] - a.position[0]) * 1000).toFixed(1)}, Δy {((b.position[1] - a.position[1]) * 1000).toFixed(1)}, Δz{" "}
                  {((b.position[2] - a.position[2]) * 1000).toFixed(1)} mm
                </div>
                <div className="mt-1 text-[11px] text-muted">Between the component reference positions, not between their surfaces.</div>
              </div>
            )}
          </div>
        </Card>

        <Card title={`Components (${components.length})`} dense>
          <div className="max-h-96 overflow-y-auto p-2">
            <div className="mb-2 flex gap-1.5">
              <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setHidden(new Set())}>
                Show all
              </button>
              <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setHidden(new Set(components.map((c) => c.id)))}>
                Hide all
              </button>
            </div>
            <ul className="space-y-1">
              {components.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded p-1 text-[11px] hover:bg-surface">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[color:rgb(var(--accent))]"
                    checked={!hidden.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Show ${c.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-muted">
                      {c.category} · {(c.massSI * 1000).toFixed(0)} g
                      {c.meshUrl && <Badge tone="accent">{c.meshFormat?.toUpperCase()}</Badge>}
                      {!c.hasMass && <Badge tone="critical">no mass</Badge>}
                      {!c.includeInBudget && <Badge tone="neutral">excluded</Badge>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
