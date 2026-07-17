import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Grid,
  Html,
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Link } from 'react-router-dom';
import {
  useLoadCases,
  useMeshFile,
  useMeshScalars,
  useProject,
  useRegions,
  useResultFields,
  useUploadSnapshot,
} from '../../api/hooks';
import { errorMessage } from '../../api/client';
import { fmt, fmtLength } from '../../lib/format';
import { useUIStore, type Axis } from '../../stores/ui';
import { Badge, Button, cx, inputCls } from '../ui';
import BCGlyphs from './BCGlyphs';
import { applyColorLayers, type HeatmapResult } from './colors';
import FeaOverlay, { type FeaLegend, type FeaProbe } from './FeaOverlay';
import Legend from './Legend';
import { brushSelect, floodFillSelect, parseStl, type MeshData } from './meshData';

// ---------------------------------------------------------------- camera rig

const VIEW_DIRS: Record<string, [number, number, number]> = {
  front: [0, -1, 0.0001],
  top: [0, 0.0001, 1],
  right: [1, 0, 0.0001],
  iso: [1, -1, 0.8],
};

function CameraRig({
  data,
  controlsRef,
}: {
  data: MeshData | null;
  controlsRef: React.RefObject<OrbitControlsImpl>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const cameraCommand = useUIStore((s) => s.cameraCommand);
  const flyTo = useUIStore((s) => s.flyTo);
  const orthographic = useUIStore((s) => s.orthographic);
  const lastFit = useRef<string | null>(null);

  const applyView = useCallback(
    (cmd: 'fit' | 'front' | 'top' | 'right' | 'iso') => {
      if (!data) return;
      const center = data.boundingSphere.center;
      const r = Math.max(data.boundingSphere.radius, 1e-6);
      const dist = r * 2.6;
      let dir: THREE.Vector3;
      if (cmd === 'fit') {
        dir = camera.position.clone().sub(controlsRef.current?.target ?? center);
        if (dir.lengthSq() < 1e-12) dir.set(1, -1, 0.8);
        dir.normalize();
      } else {
        dir = new THREE.Vector3(...VIEW_DIRS[cmd]).normalize();
      }
      camera.up.set(0, 0, 1);
      camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
      camera.near = r / 100;
      camera.far = r * 200;
      if (camera instanceof THREE.OrthographicCamera) {
        camera.zoom = Math.min(size.width, size.height) / (2.6 * r);
      }
      camera.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      }
    },
    [data, camera, size, controlsRef],
  );

  // toolbar commands
  useEffect(() => {
    if (cameraCommand) applyView(cameraCommand.cmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraCommand?.seq]);

  // fit on new mesh (iso view) or projection change (keep direction)
  useEffect(() => {
    if (!data) return;
    const meshKey = `${data.faceCount}-${data.boundingSphere.radius.toFixed(6)}`;
    if (lastFit.current !== meshKey) {
      lastFit.current = meshKey;
      applyView('iso');
    } else {
      applyView('fit');
    }
  }, [data, orthographic, applyView]);

  // fly-to a recommendation location
  useEffect(() => {
    if (!flyTo || !data) return;
    const point = new THREE.Vector3(...flyTo.point);
    const r = Math.max(data.boundingSphere.radius, 1e-6);
    const dir = camera.position.clone().sub(point);
    if (dir.lengthSq() < 1e-12) dir.set(1, -1, 0.8);
    dir.normalize();
    camera.position.copy(point.clone().add(dir.multiplyScalar(r * 1.2)));
    if (controlsRef.current) {
      controlsRef.current.target.copy(point);
      controlsRef.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.seq]);

  return null;
}

// ---------------------------------------------------------------- main mesh

function MainMesh({
  data,
  clippingPlanes,
  onPickPoint,
}: {
  data: MeshData;
  clippingPlanes: THREE.Plane[];
  onPickPoint: (p: THREE.Vector3) => void;
}) {
  const displayMode = useUIStore((s) => s.displayMode);
  const selectionTool = useUIStore((s) => s.selectionTool);
  const angleThresholdDeg = useUIStore((s) => s.angleThresholdDeg);
  const brushRadius = useUIStore((s) => s.brushRadius);
  const selectedTriangles = useUIStore((s) => s.selectedTriangles);
  const setSelectedTriangles = useUIStore((s) => s.setSelectedTriangles);
  const brushing = useRef(false);

  const diag = data.bbox.getSize(new THREE.Vector3()).length();

  const applyBrush = useCallback(
    (point: THREE.Vector3, remove: boolean) => {
      const faces = brushSelect(data, point, brushRadius * diag);
      const next = new Set(useUIStore.getState().selectedTriangles);
      for (const f of faces) {
        if (remove) next.delete(f);
        else next.add(f);
      }
      setSelectedTriangles(next);
    },
    [data, brushRadius, diag, setSelectedTriangles],
  );

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return; // ignore clicks at the end of an orbit drag
    if (selectionTool === 'seed') {
      if (e.faceIndex === undefined || e.faceIndex === null) return;
      e.stopPropagation();
      const patch = floodFillSelect(data, e.faceIndex, angleThresholdDeg);
      let next: Set<number>;
      if (e.nativeEvent.altKey) {
        next = new Set(selectedTriangles);
        for (const f of patch) next.delete(f);
      } else if (e.nativeEvent.shiftKey) {
        next = new Set(selectedTriangles);
        for (const f of patch) next.add(f);
      } else {
        next = patch;
      }
      setSelectedTriangles(next);
    } else if (selectionTool === 'measure') {
      e.stopPropagation();
      onPickPoint(e.point.clone());
    }
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (selectionTool !== 'brush') return;
    e.stopPropagation();
    brushing.current = true;
    (e.target as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
      e.pointerId,
    );
    applyBrush(e.point, e.nativeEvent.altKey);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (selectionTool !== 'brush' || !brushing.current) return;
    applyBrush(e.point, e.nativeEvent.altKey);
  };

  const handlePointerUp = () => {
    brushing.current = false;
  };

  const xray = displayMode === 'xray';

  return (
    <group>
      <mesh
        geometry={data.soup}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {xray ? (
          <meshStandardMaterial
            vertexColors
            transparent
            opacity={0.32}
            depthWrite={false}
            side={THREE.DoubleSide}
            roughness={0.5}
            clippingPlanes={clippingPlanes}
          />
        ) : (
          <meshStandardMaterial
            vertexColors
            roughness={0.55}
            metalness={0.1}
            side={THREE.DoubleSide}
            clippingPlanes={clippingPlanes}
          />
        )}
      </mesh>
      {displayMode === 'wireframe' && (
        <mesh geometry={data.soup}>
          <meshBasicMaterial
            wireframe
            color="#38bdf8"
            transparent
            opacity={0.25}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
      {displayMode === 'edges' && <MeshEdges data={data} />}
    </group>
  );
}

function MeshEdges({ data }: { data: MeshData }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(data.merged, 25), [data]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial color="#7dd3fc" />
    </lineSegments>
  );
}

// ---------------------------------------------------------------- bbox

function BBoxDisplay({ data, unit }: { data: MeshData; unit: string | null }) {
  const size = data.bbox.getSize(new THREE.Vector3());
  const min = data.bbox.min;
  const helper = useMemo(
    () => new THREE.Box3Helper(data.bbox, new THREE.Color('#475569')),
    [data],
  );
  const label = (v: number) => fmtLength(v, unit, 2);
  return (
    <group>
      <primitive object={helper} />
      <Html
        position={[min.x + size.x / 2, min.y, min.z]}
        className="pointer-events-none"
        zIndexRange={[5, 0]}
      >
        <div className="whitespace-nowrap rounded bg-slate-900/80 px-1 text-[10px] text-slate-400">
          X {label(size.x)}
        </div>
      </Html>
      <Html
        position={[min.x, min.y + size.y / 2, min.z]}
        className="pointer-events-none"
        zIndexRange={[5, 0]}
      >
        <div className="whitespace-nowrap rounded bg-slate-900/80 px-1 text-[10px] text-slate-400">
          Y {label(size.y)}
        </div>
      </Html>
      <Html
        position={[min.x, min.y, min.z + size.z / 2]}
        className="pointer-events-none"
        zIndexRange={[5, 0]}
      >
        <div className="whitespace-nowrap rounded bg-slate-900/80 px-1 text-[10px] text-slate-400">
          Z {label(size.z)}
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------- Viewer3D

export default function Viewer3D({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId);
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const heatmapField = useUIStore((s) => s.heatmapField);
  const setHeatmapField = useUIStore((s) => s.setHeatmapField);
  const displayMode = useUIStore((s) => s.displayMode);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  const orthographic = useUIStore((s) => s.orthographic);
  const setOrthographic = useUIStore((s) => s.setOrthographic);
  const requestCamera = useUIStore((s) => s.requestCamera);
  const sectionEnabled = useUIStore((s) => s.sectionEnabled);
  const sectionAxis = useUIStore((s) => s.sectionAxis);
  const sectionOffset = useUIStore((s) => s.sectionOffset);
  const setSection = useUIStore((s) => s.setSection);
  const selectionTool = useUIStore((s) => s.selectionTool);
  const setSelectionTool = useUIStore((s) => s.setSelectionTool);
  const selectedTriangles = useUIStore((s) => s.selectedTriangles);
  const highlightTriangles = useUIStore((s) => s.highlightTriangles);
  const feaResultId = useUIStore((s) => s.feaResultId);
  const setFeaResultId = useUIStore((s) => s.setFeaResultId);
  const feaField = useUIStore((s) => s.feaField);
  const setFeaField = useUIStore((s) => s.setFeaField);
  const feaScale = useUIStore((s) => s.feaScale);
  const setFeaScale = useUIStore((s) => s.setFeaScale);
  const feaShowGhost = useUIStore((s) => s.feaShowGhost);
  const setFeaShowGhost = useUIStore((s) => s.setFeaShowGhost);
  const activeLoadCaseId = useUIStore((s) => s.activeLoadCaseId);
  const flyTo = useUIStore((s) => s.flyTo);

  const meshFileQuery = useMeshFile(selectedMeshId ?? undefined);
  const scalarsQuery = useMeshScalars(
    selectedMeshId ?? undefined,
    heatmapField !== 'none' ? heatmapField : null,
  );
  const { data: regions } = useRegions(projectId, selectedMeshId ?? undefined);
  const { data: loadCases } = useLoadCases(projectId);
  const fieldsQuery = useResultFields(feaResultId ?? undefined);
  const snapshotMutation = useUploadSnapshot(projectId);

  const [heatLegend, setHeatLegend] = useState<HeatmapResult | null>(null);
  const [feaLegend, setFeaLegend] = useState<FeaLegend | null>(null);
  const [probe, setProbe] = useState<FeaProbe | null>(null);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [showRegions, setShowRegions] = useState(true);
  const [showGlyphs, setShowGlyphs] = useState(true);
  const [showBBox, setShowBBox] = useState(true);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [shotLabel, setShotLabel] = useState('');
  const [shotMsg, setShotMsg] = useState<string | null>(null);

  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null!);

  const data = useMemo(() => {
    if (!meshFileQuery.data) return null;
    try {
      return parseStl(meshFileQuery.data);
    } catch {
      return null;
    }
  }, [meshFileQuery.data]);

  // dispose GPU buffers when mesh changes
  useEffect(
    () => () => {
      if (data) {
        data.soup.dispose();
        data.merged.dispose();
      }
    },
    [data],
  );

  // clear measurement when tool changes
  useEffect(() => {
    setMeasurePoints([]);
  }, [selectionTool, selectedMeshId]);

  useEffect(() => {
    setProbe(null);
  }, [feaResultId, selectedMeshId]);

  // color layers
  const scalarValues = heatmapField !== 'none' ? scalarsQuery.data?.values ?? null : null;
  useEffect(() => {
    if (!data) return;
    const heat = applyColorLayers(data, {
      heatmapValues: scalarValues,
      heatmapIsThickness: heatmapField === 'thickness',
      regions: showRegions ? regions ?? [] : [],
      selection: selectedTriangles,
      highlight: highlightTriangles,
    });
    setHeatLegend(heat);
  }, [data, scalarValues, heatmapField, regions, showRegions, selectedTriangles, highlightTriangles]);

  // clipping plane
  const clippingPlanes = useMemo(() => {
    if (!sectionEnabled || !data) return [];
    const n = new THREE.Vector3(
      sectionAxis === 'x' ? -1 : 0,
      sectionAxis === 'y' ? -1 : 0,
      sectionAxis === 'z' ? -1 : 0,
    );
    const center = data.bbox.getCenter(new THREE.Vector3());
    const size = data.bbox.getSize(new THREE.Vector3());
    const axisIdx = sectionAxis === 'x' ? 0 : sectionAxis === 'y' ? 1 : 2;
    const c =
      center.getComponent(axisIdx) + (sectionOffset * (size.getComponent(axisIdx) || 1)) / 2;
    return [new THREE.Plane(n, c)];
  }, [sectionEnabled, sectionAxis, sectionOffset, data]);

  const activeLoadCase =
    loadCases?.find((lc) => lc.id === activeLoadCaseId) ?? loadCases?.[0] ?? null;

  const unitLabel = project?.unit_confirmed ? project.unit : null;
  const diag = data ? data.bbox.getSize(new THREE.Vector3()).length() : 1;

  const takeScreenshot = () => {
    const gl = glRef.current;
    if (!gl) return;
    gl.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setShot({ blob, url });
      setShotLabel('');
      setShotMsg(null);
    }, 'image/png');
  };

  const feaActive = !!feaResultId && !!fieldsQuery.data;

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(900px 500px at 50% 108%, rgba(35,213,255,0.07), transparent 60%), ' +
          'radial-gradient(700px 420px at 85% -8%, rgba(139,92,255,0.05), transparent 60%), ' +
          'linear-gradient(180deg, var(--lab-bg-1) 0%, var(--lab-bg-0) 100%)',
      }}
    >
      {/* viewport frame ticks */}
      <span className="hud-corner tl" />
      <span className="hud-corner tr" />
      <span className="hud-corner bl" />
      <span className="hud-corner br" />
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          glRef.current = gl;
        }}
        className="h-full w-full"
      >
        {orthographic ? (
          <OrthographicCamera makeDefault position={[3, -3, 2]} up={[0, 0, 1]} zoom={50} />
        ) : (
          <PerspectiveCamera makeDefault position={[3, -3, 2]} up={[0, 0, 1]} fov={45} />
        )}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableRotate={selectionTool !== 'brush'}
          enableDamping={false}
        />
        <CameraRig data={data} controlsRef={controlsRef} />
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
          cellColor="#14283E"
          sectionColor="#1E4258"
        />
        <axesHelper args={[diag * 0.4]} />

        {data && !feaActive && (
          <MainMesh
            data={data}
            clippingPlanes={clippingPlanes}
            onPickPoint={(p) =>
              setMeasurePoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]))
            }
          />
        )}

        {data && showBBox && !feaActive && <BBoxDisplay data={data} unit={unitLabel ?? null} />}

        {data && showRegions && !feaActive && (
          <RegionLabels data={data} regions={regions ?? []} />
        )}

        {data && showGlyphs && !feaActive && activeLoadCase && (
          <BCGlyphs bcs={activeLoadCase.boundary_conditions} regions={regions ?? []} data={data} />
        )}

        {feaActive && fieldsQuery.data && (
          <FeaOverlay
            fields={fieldsQuery.data}
            field={feaField}
            scale={feaScale}
            showGhost={feaShowGhost}
            probeEnabled
            clippingPlanes={clippingPlanes}
            onLegend={setFeaLegend}
            onProbe={setProbe}
          />
        )}

        {probe && feaActive && (
          <Html position={probe.point} zIndexRange={[30, 0]}>
            <div className="hud-chip pointer-events-none w-max px-2 py-1 text-[11px] text-slate-200">
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">von Mises</span>
                <span className="value-mono">{fmt(probe.vonMisesMPa, 4)} MPa</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">displacement</span>
                <span className="value-mono">{fmt(probe.dispMm, 4)} mm</span>
              </div>
              <div className="font-mono text-[9px] text-slate-500">node #{probe.nodeIndex}</div>
            </div>
          </Html>
        )}

        {measurePoints.length === 2 && (
          <group>
            <Line
              points={[measurePoints[0].toArray(), measurePoints[1].toArray()]}
              color="#fbbf24"
              lineWidth={2}
            />
            <Html
              position={measurePoints[0].clone().add(measurePoints[1]).multiplyScalar(0.5).toArray()}
              zIndexRange={[30, 0]}
            >
              <div className="pointer-events-none w-max rounded bg-amber-500/90 px-1.5 py-0.5 text-[11px] font-medium text-slate-950">
                {fmtLength(measurePoints[0].distanceTo(measurePoints[1]), unitLabel, 3)}
              </div>
            </Html>
          </group>
        )}
        {measurePoints.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[diag * 0.004, 12, 12]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
        ))}

        {flyTo && !feaActive && (
          <mesh position={flyTo.point}>
            <sphereGeometry args={[diag * 0.008, 16, 16]} />
            <meshBasicMaterial color="#f472b6" transparent opacity={0.85} />
          </mesh>
        )}
      </Canvas>

      {/* ---------- overlays ---------- */}

      {/* top toolbar */}
      <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1.5 text-xs">
        <div className="hud-chip flex overflow-hidden">
          {(['front', 'top', 'right', 'iso', 'fit'] as const).map((v) => (
            <button
              key={v}
              onClick={() => requestCamera(v)}
              className="px-2 py-1 uppercase tracking-wider text-[10px] text-slate-400 transition-colors hover:bg-sky-500/10 hover:text-sky-200"
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOrthographic(!orthographic)}
          className="hud-chip px-2 py-1 text-slate-300 transition-colors hover:border-sky-500/40 hover:text-sky-200"
          title="Toggle perspective / orthographic projection"
        >
          {orthographic ? 'Ortho' : 'Persp'}
        </button>
        <select
          value={displayMode}
          onChange={(e) => setDisplayMode(e.target.value as typeof displayMode)}
          className="hud-chip px-1.5 py-1 text-slate-300"
          title="Display mode"
        >
          <option value="shaded">Shaded</option>
          <option value="wireframe">Wireframe</option>
          <option value="xray">X-ray</option>
          <option value="edges">Edges</option>
        </select>
        <select
          value={heatmapField}
          onChange={(e) => setHeatmapField(e.target.value as typeof heatmapField)}
          className="hud-chip px-1.5 py-1 text-slate-300"
          title="Heat map (requires geometry analysis)"
        >
          <option value="none">Heat map: none</option>
          <option value="thickness">Thickness</option>
          <option value="overhang">Overhang</option>
          <option value="sharpness">Sharpness</option>
        </select>
        <button
          onClick={() => setSelectionTool(selectionTool === 'measure' ? 'none' : 'measure')}
          className={cx(
            'hud-chip px-2 py-1 transition-colors',
            selectionTool === 'measure'
              ? '!border-amber-500/60 bg-amber-500/20 text-amber-200'
              : 'text-slate-300 hover:border-sky-500/40 hover:text-sky-200',
          )}
          title="Measure: click two points on the surface"
        >
          Measure
        </button>
        <button
          onClick={takeScreenshot}
          className="hud-chip px-2 py-1 text-slate-300 transition-colors hover:border-sky-500/40 hover:text-sky-200"
          title="Capture viewport as PNG"
        >
          Screenshot
        </button>
      </div>

      {/* second toolbar row: section plane + toggles */}
      <div className="absolute left-2 top-11 flex flex-wrap items-center gap-1.5 text-xs">
        <div className="hud-chip flex items-center gap-1.5 px-2 py-1">
          <label className="flex items-center gap-1 text-slate-300">
            <input
              type="checkbox"
              checked={sectionEnabled}
              onChange={(e) => setSection({ sectionEnabled: e.target.checked })}
            />
            Section
          </label>
          {sectionEnabled && (
            <>
              <select
                value={sectionAxis}
                onChange={(e) => setSection({ sectionAxis: e.target.value as Axis })}
                className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-300"
              >
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={sectionOffset}
                onChange={(e) => setSection({ sectionOffset: Number(e.target.value) })}
                className="w-28"
              />
            </>
          )}
        </div>
        {(['regions', 'glyphs', 'bbox'] as const).map((k) => {
          const val = k === 'regions' ? showRegions : k === 'glyphs' ? showGlyphs : showBBox;
          const setter =
            k === 'regions' ? setShowRegions : k === 'glyphs' ? setShowGlyphs : setShowBBox;
          return (
            <label
              key={k}
              className="hud-chip flex items-center gap-1 px-2 py-1 text-slate-300"
            >
              <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
              {k === 'bbox' ? 'BBox' : k[0].toUpperCase() + k.slice(1)}
            </label>
          );
        })}
      </div>

      {/* units badge / banner */}
      <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5">
        <Badge color={project?.unit_confirmed ? 'green' : 'amber'}>
          {project?.unit_confirmed ? `Units: ${project.unit}` : 'Units: mesh units (unconfirmed)'}
        </Badge>
        {selectionTool === 'seed' || selectionTool === 'brush' ? (
          <Badge color="sky">
            {selectionTool === 'seed'
              ? 'Select: click a face (shift adds, alt removes)'
              : 'Brush: drag over faces (alt removes)'}
          </Badge>
        ) : null}
      </div>

      {project && !project.unit_confirmed && (
        <div className="absolute left-1/2 top-2 -translate-x-1/2">
          <Link
            to={`/p/${projectId}/upload`}
            className="rounded border border-amber-500/60 bg-amber-950/80 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/80"
          >
            Units not confirmed — analysis is blocked. Confirm in step 1.
          </Link>
        </div>
      )}

      {/* FEA overlay controls */}
      {feaActive && (
        <div className="lab-panel absolute bottom-2 right-2 flex flex-col gap-1.5 p-2.5 text-xs text-slate-300">
          <div className="flex items-center justify-between gap-2">
            <span className="label-tech !text-sky-300">FEA overlay</span>
            <button className="text-slate-500 hover:text-slate-300" onClick={() => setFeaResultId(null)}>
              close
            </button>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setFeaField('von_mises')}
              className={cx(
                'rounded px-2 py-0.5',
                feaField === 'von_mises' ? 'bg-sky-500/30 text-sky-200' : 'bg-slate-800',
              )}
            >
              von Mises
            </button>
            <button
              onClick={() => setFeaField('displacement')}
              className={cx(
                'rounded px-2 py-0.5',
                feaField === 'displacement' ? 'bg-sky-500/30 text-sky-200' : 'bg-slate-800',
              )}
            >
              Displacement
            </button>
          </div>
          <label className="flex items-center gap-2">
            Deformation ×{fmt(feaScale, 1)}
            <input
              type="range"
              min={0}
              max={500}
              step={1}
              value={feaScale}
              onChange={(e) => setFeaScale(Number(e.target.value))}
              className="w-32"
            />
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={feaShowGhost}
              onChange={(e) => setFeaShowGhost(e.target.checked)}
            />
            Show undeformed ghost
          </label>
          <div className="text-[10px] text-slate-500">Click the surface to probe node values.</div>
        </div>
      )}

      {/* legends */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1.5">
        {feaActive && feaLegend && (
          <Legend label={feaLegend.label} min={feaLegend.min} max={feaLegend.max} />
        )}
        {!feaActive && heatmapField !== 'none' && heatLegend && (
          <Legend
            label={`${heatmapField}${heatmapField === 'thickness' ? ` [${unitLabel ?? 'mesh units'}] (−1 = no data, gray)` : heatmapField === 'overhang' ? ' [fraction]' : ' [0–1]'}`}
            min={heatLegend.min}
            max={heatLegend.max}
            note={heatLegend.mismatch}
          />
        )}
        {!feaActive && heatmapField !== 'none' && scalarsQuery.isError && (
          <div className="rounded border border-red-500/50 bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
            Heat map unavailable: {errorMessage(scalarsQuery.error)}
          </div>
        )}
      </div>

      {/* mesh loading / empty states */}
      {!selectedMeshId && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-slate-700 bg-slate-800/90 px-6 py-4 text-sm text-slate-400">
            No mesh selected — upload one in step 1.
          </div>
        </div>
      )}
      {selectedMeshId && meshFileQuery.isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg bg-slate-800/90 px-4 py-2 text-sm text-slate-300">
            Loading mesh…
          </div>
        </div>
      )}
      {meshFileQuery.isError && (
        <div className="absolute inset-x-0 top-16 mx-auto w-max rounded border border-red-500/50 bg-red-950/80 px-3 py-1.5 text-xs text-red-200">
          Failed to load mesh: {errorMessage(meshFileQuery.error)}
        </div>
      )}

      {/* screenshot dialog */}
      {shot && (
        <div className="absolute right-2 top-14 w-64 rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-slate-200">Screenshot</span>
            <button
              className="text-slate-500 hover:text-slate-300"
              onClick={() => {
                URL.revokeObjectURL(shot.url);
                setShot(null);
              }}
            >
              ✕
            </button>
          </div>
          <img src={shot.url} alt="viewport screenshot" className="mb-2 rounded border border-slate-700" />
          <div className="flex flex-col gap-1.5">
            <a
              href={shot.url}
              download="partforge_viewport.png"
              className="rounded bg-slate-700 px-2 py-1 text-center text-slate-100 hover:bg-slate-600"
            >
              Download PNG
            </a>
            <input
              value={shotLabel}
              onChange={(e) => setShotLabel(e.target.value)}
              placeholder="Label for the report…"
              className={inputCls}
            />
            <Button
              variant="primary"
              disabled={snapshotMutation.isPending}
              onClick={() =>
                snapshotMutation.mutate(
                  { blob: shot.blob, label: shotLabel },
                  {
                    onSuccess: () => setShotMsg('Attached — snapshots are embedded in future reports.'),
                    onError: (err) => setShotMsg(`Attach failed: ${errorMessage(err)}`),
                  },
                )
              }
            >
              Attach to report
            </Button>
            {shotMsg && <div className="text-[11px] text-slate-400">{shotMsg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function RegionLabels({ data, regions }: { data: MeshData; regions: { id: string; name: string; color: string; protected: boolean; triangle_indices: number[] }[] }) {
  return (
    <group>
      {regions.map((r) => {
        if (!r.triangle_indices.length) return null;
        const c = new THREE.Vector3();
        let n = 0;
        for (const t of r.triangle_indices) {
          if (t < 0 || t >= data.faceCount) continue;
          c.x += data.faceCentroids[t * 3];
          c.y += data.faceCentroids[t * 3 + 1];
          c.z += data.faceCentroids[t * 3 + 2];
          n++;
        }
        if (!n) return null;
        c.divideScalar(n);
        return (
          <Html key={r.id} position={c.toArray()} zIndexRange={[8, 0]} className="pointer-events-none">
            <div
              className="w-max max-w-[140px] truncate rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px]"
              style={{ color: r.protected ? '#fbbf24' : r.color }}
            >
              {r.protected ? '🔒 ' : ''}
              {r.name}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
