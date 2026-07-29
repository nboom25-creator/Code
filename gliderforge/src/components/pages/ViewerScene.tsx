"use client";

import React from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { parseSTL, parseOBJ } from "@/lib/geometry/parse";
import { convert } from "@/lib/units";
import type { ViewerComponent, ColorMode } from "./ViewerClient";

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SERIES[h % SERIES.length];
}

function colorFor(c: ViewerComponent, mode: ColorMode): string {
  if (mode === "verification") {
    if (c.verified) return "#0ca30c";
    if (c.hasMass) return "#fab219";
    return "#d03b3b";
  }
  if (mode === "displacement") {
    return { hull: "#2a78d6", external: "#1baf7a", internal: "#898781", flooded: "#eda100" }[c.displacementMode] ?? "#898781";
  }
  if (mode === "material") return c.material ? hashColor(c.material) : "#898781";
  return c.color ?? hashColor(c.category);
}

/** Default box size when a component has no recorded bounding dimensions. */
const FALLBACK = 0.02;

function ComponentMesh({
  component,
  opacity,
  mode,
  clippingPlanes,
  showCentroid,
}: {
  component: ViewerComponent;
  opacity: number;
  mode: ColorMode;
  clippingPlanes: THREE.Plane[];
  showCentroid: boolean;
}) {
  const [geometry, setGeometry] = React.useState<THREE.BufferGeometry | null>(null);
  const [meshError, setMeshError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!component.meshUrl) return;
    (async () => {
      try {
        const res = await fetch(component.meshUrl!);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const parsed =
          component.meshFormat === "obj" ? parseOBJ(new TextDecoder().decode(buffer)) : parseSTL(buffer);
        if (cancelled || parsed.mesh.triangleCount === 0) return;
        const scale = convert(1, component.meshUnit ?? "mm", "m");
        const positions = new Float32Array(parsed.mesh.positions.length);
        for (let i = 0; i < positions.length; i++) positions[i] = parsed.mesh.positions[i] * scale;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        g.computeVertexNormals();
        // Centre the mesh on its own bounding box so the component's recorded
        // position places it, rather than the arbitrary CAD origin.
        g.computeBoundingBox();
        const c = new THREE.Vector3();
        g.boundingBox!.getCenter(c);
        g.translate(-c.x, -c.y, -c.z);
        setGeometry(g);
      } catch (e) {
        if (!cancelled) setMeshError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [component.meshUrl, component.meshFormat, component.meshUnit]);

  const color = colorFor(component, mode);
  const size: [number, number, number] = [
    component.size[0] ?? FALLBACK,
    component.size[1] ?? FALLBACK,
    component.size[2] ?? FALLBACK,
  ];

  return (
    <group position={component.position}>
      {geometry ? (
        <mesh geometry={geometry}>
          <meshStandardMaterial color={color} transparent opacity={opacity} clippingPlanes={clippingPlanes} side={THREE.DoubleSide} roughness={0.6} />
        </mesh>
      ) : (
        <mesh>
          <boxGeometry args={size} />
          <meshStandardMaterial color={color} transparent opacity={opacity} clippingPlanes={clippingPlanes} roughness={0.7} />
        </mesh>
      )}
      {showCentroid && (
        <mesh>
          <sphereGeometry args={[0.004, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      {meshError && (
        <Html center distanceFactor={1.5}>
          <span className="whitespace-nowrap rounded bg-panel px-1 text-[9px] text-[#d03b3b]">mesh failed to load</span>
        </Html>
      )}
    </group>
  );
}

function Marker({
  position,
  label,
  color,
  wireframe,
}: {
  position: [number, number, number];
  label: string;
  color: string;
  wireframe?: boolean;
}) {
  if (!position.every((v) => Number.isFinite(v))) return null;
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.009, 20, 20]} />
        <meshBasicMaterial color={color} wireframe={wireframe} />
      </mesh>
      <Html center distanceFactor={1.2}>
        <span className="pointer-events-none whitespace-nowrap rounded px-1 text-[10px] font-bold" style={{ color, background: "rgba(0,0,0,0.35)" }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

function Axes({ length }: { length: number }) {
  return (
    <group>
      <Line points={[[0, 0, 0], [length, 0, 0]]} color="#e34948" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, length * 0.5, 0]]} color="#1baf7a" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, 0, length * 0.5]]} color="#2a78d6" lineWidth={2} />
      <Html position={[length, 0, 0]} center>
        <span className="text-[10px] font-bold" style={{ color: "#e34948" }}>
          +x fwd
        </span>
      </Html>
      <Html position={[0, length * 0.5, 0]} center>
        <span className="text-[10px] font-bold" style={{ color: "#1baf7a" }}>
          +y port
        </span>
      </Html>
      <Html position={[0, 0, length * 0.5]} center>
        <span className="text-[10px] font-bold" style={{ color: "#2a78d6" }}>
          +z up
        </span>
      </Html>
    </group>
  );
}

function BoundingBox({ components }: { components: ViewerComponent[] }) {
  const box = React.useMemo(() => {
    const b = new THREE.Box3();
    for (const c of components) {
      const half = new THREE.Vector3((c.size[0] ?? FALLBACK) / 2, (c.size[1] ?? FALLBACK) / 2, (c.size[2] ?? FALLBACK) / 2);
      const centre = new THREE.Vector3(...c.position);
      b.expandByPoint(centre.clone().sub(half));
      b.expandByPoint(centre.clone().add(half));
    }
    return b;
  }, [components]);

  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  return (
    <group position={centre.toArray()}>
      <mesh>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial color="#898781" wireframe transparent opacity={0.35} />
      </mesh>
      <Html position={[0, 0, size.z / 2 + 0.02]} center>
        <span className="whitespace-nowrap rounded bg-panel px-1 text-[10px] text-muted">
          {(size.x * 1000).toFixed(0)} × {(size.y * 1000).toFixed(0)} × {(size.z * 1000).toFixed(0)} mm
        </span>
      </Html>
    </group>
  );
}

function ClippingSetup({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  React.useEffect(() => {
    gl.localClippingEnabled = enabled;
  }, [gl, enabled]);
  return null;
}

export function ViewerScene({
  components,
  cg,
  cb,
  hullLength,
  hullDiameter,
  opacity,
  showAxes,
  showBBox,
  showCentroids,
  showGrid,
  colorMode,
  clipX,
  measureFrom,
  measureTo,
}: {
  components: ViewerComponent[];
  cg: { x: number; y: number; z: number };
  cb: { x: number; y: number; z: number };
  hullLength: number;
  hullDiameter: number;
  opacity: number;
  showAxes: boolean;
  showBBox: boolean;
  showCentroids: boolean;
  showGrid: boolean;
  colorMode: ColorMode;
  clipX: number | null;
  measureFrom: ViewerComponent | null;
  measureTo: ViewerComponent | null;
}) {
  const clippingPlanes = React.useMemo(
    () => (clipX === null ? [] : [new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipX)]),
    [clipX],
  );

  const span = Math.max(hullLength, 0.3);

  return (
    <div className="h-[520px] overflow-hidden rounded-lg border bg-panel">
      <Canvas
        camera={{ position: [span * 1.1, -span * 1.1, span * 0.7], fov: 45, up: [0, 0, 1], near: 0.005, far: 100 }}
        gl={{ antialias: true }}
      >
        <ClippingSetup enabled={clipX !== null} />
        <color attach="background" args={["#111214"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[1, -1, 2]} intensity={1.1} />
        <directionalLight position={[-1, 1, -1]} intensity={0.4} />

        {showGrid && (
          <Grid
            args={[2, 2]}
            cellSize={0.05}
            sectionSize={0.25}
            cellColor="#2c2c2a"
            sectionColor="#4a4a46"
            position={[span / 2, 0, -hullDiameter]}
            rotation={[Math.PI / 2, 0, 0]}
            infiniteGrid
            fadeDistance={4}
          />
        )}

        {showAxes && <Axes length={span * 0.35} />}
        {showBBox && <BoundingBox components={components} />}

        {components.map((c) => (
          <ComponentMesh key={c.id} component={c} opacity={opacity} mode={colorMode} clippingPlanes={clippingPlanes} showCentroid={showCentroids} />
        ))}

        <Marker position={[cg.x, cg.y, cg.z]} label="CG" color="#eb6834" />
        <Marker position={[cb.x, cb.y, cb.z]} label="CB" color="#2a78d6" wireframe />

        {Number.isFinite(cg.x) && Number.isFinite(cb.x) && (
          <Line points={[[cg.x, cg.y, cg.z], [cb.x, cb.y, cb.z]]} color="#fab219" lineWidth={2} dashed dashSize={0.006} gapSize={0.004} />
        )}

        {measureFrom && measureTo && (
          <Line points={[measureFrom.position, measureTo.position]} color="#e87ba4" lineWidth={2} />
        )}

        <OrbitControls makeDefault target={[span / 2, 0, 0]} enableDamping dampingFactor={0.12} />
      </Canvas>
    </div>
  );
}
