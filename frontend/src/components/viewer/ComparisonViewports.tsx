import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useComparison, useMeshFile, useVariants } from '../../api/hooks';
import { colormap } from '../../lib/colormap';
import { useUIStore } from '../../stores/ui';
import Legend from './Legend';
import { parseStl, type MeshData } from './meshData';

type Side = 'left' | 'right';

/** OrbitControls that mirror camera state through the zustand store so two
 * viewports stay synchronized (whichever the user drags becomes the leader). */
function SyncedControls({ side }: { side: Side }) {
  const camera = useThree((s) => s.camera);
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const setCameraSync = useUIStore((s) => s.setCameraSync);
  const cameraSync = useUIStore((s) => s.cameraSync);
  const applying = useRef(false);

  // follow the other viewport
  useEffect(() => {
    if (cameraSync.source === side || cameraSync.source === null) return;
    applying.current = true;
    camera.position.set(...cameraSync.position);
    camera.up.set(0, 0, 1);
    if (controlsRef.current) {
      controlsRef.current.target.set(...cameraSync.target);
      controlsRef.current.update();
    }
    applying.current = false;
  }, [cameraSync, camera, side]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={false}
      onChange={() => {
        if (applying.current || !controlsRef.current) return;
        const t = controlsRef.current.target;
        setCameraSync({
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [t.x, t.y, t.z],
          source: side,
          seq: useUIStore.getState().cameraSync.seq + 1,
        });
      }}
    />
  );
}

function useClipPlanes(bbox: THREE.Box3 | null): THREE.Plane[] {
  const sectionEnabled = useUIStore((s) => s.sectionEnabled);
  const sectionAxis = useUIStore((s) => s.sectionAxis);
  const sectionOffset = useUIStore((s) => s.sectionOffset);
  return useMemo(() => {
    if (!sectionEnabled || !bbox) return [];
    const n = new THREE.Vector3(
      sectionAxis === 'x' ? -1 : 0,
      sectionAxis === 'y' ? -1 : 0,
      sectionAxis === 'z' ? -1 : 0,
    );
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const i = sectionAxis === 'x' ? 0 : sectionAxis === 'y' ? 1 : 2;
    return [new THREE.Plane(n, center.getComponent(i) + (sectionOffset * (size.getComponent(i) || 1)) / 2)];
  }, [sectionEnabled, sectionAxis, sectionOffset, bbox]);
}

function SceneChrome({ data }: { data: MeshData | null }) {
  const diag = data ? data.bbox.getSize(new THREE.Vector3()).length() : 1;
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, -8, 10]} intensity={1.1} />
      <directionalLight position={[-6, 6, -4]} intensity={0.35} />
      <Grid
        position={data ? [0, 0, data.bbox.min.z] : [0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        infiniteGrid
        cellSize={diag / 20}
        sectionSize={diag / 4}
        fadeDistance={diag * 4}
        cellColor="#334155"
        sectionColor="#475569"
      />
    </>
  );
}

function FitOnce({ data }: { data: MeshData | null }) {
  const camera = useThree((s) => s.camera);
  const done = useRef(false);
  useEffect(() => {
    if (!data || done.current) return;
    done.current = true;
    const c = data.boundingSphere.center;
    const r = Math.max(data.boundingSphere.radius, 1e-6);
    camera.up.set(0, 0, 1);
    camera.position.set(c.x + r * 1.8, c.y - r * 1.8, c.z + r * 1.4);
    camera.near = r / 100;
    camera.far = r * 200;
    camera.lookAt(c);
    camera.updateProjectionMatrix();
  }, [data, camera]);
  return null;
}

/** Approximate distance from each variant vertex to the baseline surface via a
 * uniform grid hash over baseline vertices. Labeled approximate in the UI. */
function computeDeviation(variant: MeshData, baseline: MeshData): { values: Float32Array; max: number } {
  const basePos = baseline.merged.getAttribute('position').array as Float32Array;
  const varPos = variant.soup.getAttribute('position').array as Float32Array;
  const diag = baseline.bbox.getSize(new THREE.Vector3()).length() || 1;
  const cell = diag / 80;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < basePos.length; i += 3) {
    const k = key(basePos[i], basePos[i + 1], basePos[i + 2]);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }
  const n = varPos.length / 3;
  const values = new Float32Array(n);
  let max = 0;
  const fallback = cell * 3;
  for (let v = 0; v < n; v++) {
    const x = varPos[v * 3];
    const y = varPos[v * 3 + 1];
    const z = varPos[v * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const i of bucket) {
            const d2 =
              (basePos[i] - x) ** 2 + (basePos[i + 1] - y) ** 2 + (basePos[i + 2] - z) ** 2;
            if (d2 < best) best = d2;
          }
        }
      }
    }
    const d = Number.isFinite(best) ? Math.sqrt(best) : fallback;
    values[v] = d;
    if (d > max) max = d;
  }
  return { values, max };
}

function MeshView({
  data,
  color,
  ghost,
  vertexColors,
  clippingPlanes,
}: {
  data: MeshData;
  color?: string;
  ghost?: boolean;
  vertexColors?: boolean;
  clippingPlanes: THREE.Plane[];
}) {
  return (
    <mesh geometry={data.soup}>
      <meshStandardMaterial
        color={vertexColors ? undefined : color ?? '#b6bec9'}
        vertexColors={!!vertexColors}
        transparent={!!ghost}
        opacity={ghost ? 0.18 : 1}
        depthWrite={!ghost}
        roughness={0.55}
        metalness={0.1}
        side={THREE.DoubleSide}
        clippingPlanes={clippingPlanes}
      />
    </mesh>
  );
}

export default function ComparisonViewports({ projectId }: { projectId: string }) {
  const { data: comparison } = useComparison(projectId);
  const { data: variants } = useVariants(projectId);
  const comparisonVariantMeshId = useUIStore((s) => s.comparisonVariantMeshId);
  const setComparisonVariantMeshId = useUIStore((s) => s.setComparisonVariantMeshId);
  const mode = useUIStore((s) => s.comparisonMode);

  const baselineId = comparison?.baseline_mesh.id ?? null;
  const succeeded = (variants ?? []).filter((v) => v.status === 'succeeded' && v.result_mesh_id);

  // default variant
  useEffect(() => {
    const valid = comparisonVariantMeshId && succeeded.some((v) => v.result_mesh_id === comparisonVariantMeshId);
    if (!valid && succeeded.length) setComparisonVariantMeshId(succeeded[0].result_mesh_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [succeeded.length, comparisonVariantMeshId]);

  const baseFile = useMeshFile(baselineId ?? undefined);
  const varFile = useMeshFile(comparisonVariantMeshId ?? undefined);

  const baseData = useMemo(
    () => (baseFile.data ? parseStl(baseFile.data) : null),
    [baseFile.data],
  );
  const varData = useMemo(() => (varFile.data ? parseStl(varFile.data) : null), [varFile.data]);

  const [deviationMax, setDeviationMax] = useState<number | null>(null);

  // difference coloring on the variant
  useEffect(() => {
    if (mode !== 'difference' || !varData || !baseData) {
      setDeviationMax(null);
      return;
    }
    const { values, max } = computeDeviation(varData, baseData);
    const attr = varData.soup.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const range = max || 1;
    for (let i = 0; i < values.length; i++) {
      const [r, g, b] = colormap(values[i] / range);
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    }
    attr.needsUpdate = true;
    setDeviationMax(max);
  }, [mode, varData, baseData]);

  const clipBase = useClipPlanes(baseData?.bbox ?? null);

  const variantName =
    succeeded.find((v) => v.result_mesh_id === comparisonVariantMeshId)?.name ?? 'Variant';

  if (!baselineId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No baseline mesh — upload a mesh and generate variants first.
      </div>
    );
  }

  const single = mode !== 'side-by-side';

  return (
    <div className="relative flex h-full w-full">
      {/* left / single viewport */}
      <div className="relative h-full min-w-0 flex-1 border-r border-slate-700/70">
        <Canvas gl={{ antialias: true }} onCreated={({ gl }) => (gl.localClippingEnabled = true)}>
          <PerspectiveCamera makeDefault position={[3, -3, 2]} up={[0, 0, 1]} fov={45} />
          <SyncedControls side="left" />
          <FitOnce data={baseData} />
          <SceneChrome data={baseData} />
          {mode === 'side-by-side' && baseData && (
            <MeshView data={baseData} clippingPlanes={clipBase} />
          )}
          {mode === 'overlay' && (
            <>
              {baseData && <MeshView data={baseData} ghost clippingPlanes={clipBase} />}
              {varData && <MeshView data={varData} color="#38bdf8" clippingPlanes={clipBase} />}
            </>
          )}
          {mode === 'difference' && varData && (
            <MeshView data={varData} vertexColors clippingPlanes={clipBase} />
          )}
        </Canvas>
        <div className="absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-0.5 text-xs text-slate-300">
          {mode === 'side-by-side'
            ? `Baseline: ${comparison?.baseline_mesh.label || 'original'}`
            : mode === 'overlay'
              ? `Overlay: ${variantName} on ghosted baseline`
              : `Difference: ${variantName} vs baseline`}
        </div>
        {mode === 'difference' && deviationMax != null && (
          <div className="absolute bottom-2 left-2">
            <Legend
              label="Approximate surface deviation [mesh units]"
              min={0}
              max={deviationMax}
              note="Nearest-vertex distance via grid hash — approximate, not an exact surface distance."
            />
          </div>
        )}
      </div>

      {/* right viewport (side-by-side only) */}
      {!single && (
        <div className="relative h-full min-w-0 flex-1">
          <Canvas gl={{ antialias: true }} onCreated={({ gl }) => (gl.localClippingEnabled = true)}>
            <PerspectiveCamera makeDefault position={[3, -3, 2]} up={[0, 0, 1]} fov={45} />
            <SyncedControls side="right" />
            <FitOnce data={baseData ?? varData} />
            <SceneChrome data={varData ?? baseData} />
            {varData && <MeshView data={varData} color="#7dd3fc" clippingPlanes={clipBase} />}
          </Canvas>
          <div className="absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-0.5 text-xs text-sky-300">
            {variantName}
          </div>
          {!varData && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
              {succeeded.length ? 'Loading variant…' : 'No successful variant yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
