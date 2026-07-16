import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { BoundaryCondition, Region } from '../../api/types';
import { averageNormal, regionCentroid, type MeshData } from './meshData';

export const BC_COLORS: Record<string, string> = {
  fixed: '#f59e0b',
  pinned: '#f59e0b',
  roller: '#f59e0b',
  symmetry: '#f59e0b',
  force: '#ef4444',
  bearing: '#ef4444',
  pressure: '#a855f7',
  torque: '#22d3ee',
  rotation: '#22d3ee',
  gravity: '#ef4444',
};

function Arrow({
  origin,
  dir,
  length,
  color,
}: {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  color: string;
}) {
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return q;
  }, [dir]);
  const shaft = length * 0.7;
  const head = length * 0.3;
  const r = length * 0.04;
  return (
    <group position={origin} quaternion={quat}>
      <mesh position={[0, shaft / 2, 0]}>
        <cylinderGeometry args={[r, r, shaft, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, shaft + head / 2, 0]}>
        <coneGeometry args={[r * 2.6, head, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function AnchorGlyph({ pos, size, color }: { pos: THREE.Vector3; size: number; color: string }) {
  return (
    <group position={pos}>
      <mesh>
        <boxGeometry args={[size * 0.5, size * 0.5, size * 0.5]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * size * 0.35, -size * 0.45, Math.sin(a) * size * 0.35]}
            rotation={[Math.PI, 0, 0]}
          >
            <coneGeometry args={[size * 0.12, size * 0.4, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

function TorqueGlyph({
  pos,
  axis,
  size,
  color,
}: {
  pos: THREE.Vector3;
  axis: THREE.Vector3;
  size: number;
  color: string;
}) {
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
    return q;
  }, [axis]);
  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <torusGeometry args={[size * 0.5, size * 0.045, 8, 32, Math.PI * 1.6]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[size * 0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[size * 0.12, size * 0.3, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Renders one glyph per boundary condition at the centroid of its region. */
export default function BCGlyphs({
  bcs,
  regions,
  data,
}: {
  bcs: BoundaryCondition[];
  regions: Region[];
  data: MeshData;
}) {
  const modelSize = data.boundingSphere.radius * 2;
  const glyphSize = modelSize * 0.12;
  const center = data.boundingSphere.center;

  return (
    <group>
      {bcs.map((bc) => {
        const color = BC_COLORS[bc.bc_type] ?? '#94a3b8';
        const region = regions.find((r) => r.id === bc.region_id);
        const label = `${bc.bc_type}${bc.description ? `: ${bc.description}` : ''}`;

        if (bc.bc_type === 'gravity') {
          const d = bc.params.direction ?? [0, 0, -1];
          const dir = new THREE.Vector3(d[0] ?? 0, d[1] ?? 0, d[2] ?? -1);
          return (
            <group key={bc.id}>
              <Arrow origin={center.clone()} dir={dir} length={glyphSize * 1.4} color={color} />
              <Html position={center.toArray()} className="pointer-events-none">
                <div className="rounded bg-slate-900/80 px-1 text-[10px] text-red-300">g</div>
              </Html>
            </group>
          );
        }

        if (!region) return null;
        const centroid = regionCentroid(data, region.triangle_indices);
        const normal = averageNormal(data, region.triangle_indices);

        if (bc.bc_type === 'rotation' || bc.bc_type === 'torque') {
          const ad = bc.params.axis_direction ?? normal.toArray();
          const axis = new THREE.Vector3(ad[0] ?? 0, ad[1] ?? 0, ad[2] ?? 1);
          return (
            <group key={bc.id}>
              <TorqueGlyph pos={centroid} axis={axis} size={glyphSize} color={color} />
              <GlyphLabel pos={centroid} text={label} color={color} />
            </group>
          );
        }

        if (bc.bc_type === 'force' || bc.bc_type === 'bearing') {
          const d = bc.params.direction ?? normal.toArray();
          const dir = new THREE.Vector3(d[0] ?? 0, d[1] ?? 0, d[2] ?? 1).normalize();
          // arrow points along load direction, tail at surface
          const origin = centroid.clone().sub(dir.clone().multiplyScalar(glyphSize));
          return (
            <group key={bc.id}>
              <Arrow origin={origin} dir={dir} length={glyphSize} color={color} />
              <GlyphLabel pos={centroid} text={label} color={color} />
            </group>
          );
        }

        if (bc.bc_type === 'pressure') {
          const inward = normal.clone().negate();
          const t = new THREE.Vector3(1, 0, 0);
          if (Math.abs(inward.dot(t)) > 0.9) t.set(0, 1, 0);
          const side = new THREE.Vector3().crossVectors(inward, t).normalize();
          const side2 = new THREE.Vector3().crossVectors(inward, side).normalize();
          const offsets = [
            new THREE.Vector3(0, 0, 0),
            side.clone().multiplyScalar(glyphSize * 0.4),
            side2.clone().multiplyScalar(glyphSize * 0.4),
          ];
          return (
            <group key={bc.id}>
              {offsets.map((o, i) => (
                <Arrow
                  key={i}
                  origin={centroid.clone().add(o).sub(inward.clone().multiplyScalar(glyphSize * 0.8))}
                  dir={inward}
                  length={glyphSize * 0.8}
                  color={color}
                />
              ))}
              <GlyphLabel pos={centroid} text={label} color={color} />
            </group>
          );
        }

        // fixed / pinned / roller / symmetry
        return (
          <group key={bc.id}>
            <AnchorGlyph pos={centroid} size={glyphSize * 0.8} color={color} />
            <GlyphLabel pos={centroid} text={label} color={color} />
          </group>
        );
      })}
    </group>
  );
}

function GlyphLabel({ pos, text, color }: { pos: THREE.Vector3; text: string; color: string }) {
  return (
    <Html position={pos.toArray()} className="pointer-events-none" zIndexRange={[10, 0]}>
      <div
        className="max-w-[160px] truncate rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px]"
        style={{ color }}
      >
        {text}
      </div>
    </Html>
  );
}
