import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { ResultFields } from '../../api/types';
import { colormap } from '../../lib/colormap';
import type { FeaField } from '../../stores/ui';

export interface FeaProbe {
  point: [number, number, number];
  vonMisesMPa: number;
  dispMm: number;
  nodeIndex: number;
}

export interface FeaLegend {
  min: number;
  max: number;
  label: string;
}

/**
 * FEA result surface mesh: vertex-colored by von Mises or displacement
 * magnitude, deformed by displacement * scale (converted from metres back to
 * mesh units via unit_scale_to_m).
 */
export default function FeaOverlay({
  fields,
  field,
  scale,
  showGhost,
  probeEnabled,
  clippingPlanes,
  onLegend,
  onProbe,
}: {
  fields: ResultFields;
  field: FeaField;
  scale: number;
  showGhost: boolean;
  probeEnabled: boolean;
  clippingPlanes: THREE.Plane[];
  onLegend: (l: FeaLegend) => void;
  onProbe: (p: FeaProbe | null) => void;
}) {
  const base = useMemo(() => new Float32Array(fields.positions), [fields]);
  const disp = useMemo(() => new Float32Array(fields.displacement_m), [fields]);
  const index = useMemo(() => new Uint32Array(fields.triangles), [fields]);
  const vm = useMemo(() => new Float32Array(fields.von_mises_pa), [fields]);
  const dispMag = useMemo(() => {
    const n = base.length / 3;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]);
    }
    return out;
  }, [base, disp]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(base.length), 3));
    g.computeVertexNormals();
    return g;
  }, [base, index]);

  const ghostGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(base, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeVertexNormals();
    return g;
  }, [base, index]);

  useEffect(() => () => {
    geometry.dispose();
    ghostGeometry.dispose();
  }, [geometry, ghostGeometry]);

  // apply deformation whenever scale changes
  useEffect(() => {
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const k = scale / fields.unit_scale_to_m; // displacement m -> mesh units, times user factor
    for (let i = 0; i < arr.length; i++) arr[i] = base[i] + disp[i] * k;
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }, [geometry, base, disp, scale, fields.unit_scale_to_m]);

  // vertex colors + legend
  useEffect(() => {
    const values = field === 'von_mises' ? vm : dispMag;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const range = max - min || 1;
    const attr = geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < values.length; i++) {
      const [r, g, b] = colormap((values[i] - min) / range);
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    }
    attr.needsUpdate = true;
    onLegend(
      field === 'von_mises'
        ? { min: min / 1e6, max: max / 1e6, label: 'von Mises [MPa]' }
        : { min: min * 1000, max: max * 1000, label: 'Displacement [mm]' },
    );
  }, [geometry, field, vm, dispMag, onLegend]);

  const probeRef = useRef(onProbe);
  probeRef.current = onProbe;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!probeEnabled || e.delta > 5) return; // ignore orbit-drag clicks
    e.stopPropagation();
    if (e.faceIndex === undefined || e.faceIndex === null) return;
    const f = e.faceIndex;
    const nodes = [index[f * 3], index[f * 3 + 1], index[f * 3 + 2]];
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    let bestNode = nodes[0];
    let bestD = Infinity;
    for (const n of nodes) {
      const d = e.point.distanceToSquared(
        new THREE.Vector3(posAttr.getX(n), posAttr.getY(n), posAttr.getZ(n)),
      );
      if (d < bestD) {
        bestD = d;
        bestNode = n;
      }
    }
    probeRef.current({
      point: [posAttr.getX(bestNode), posAttr.getY(bestNode), posAttr.getZ(bestNode)],
      vonMisesMPa: vm[bestNode] / 1e6,
      dispMm: dispMag[bestNode] * 1000,
      nodeIndex: bestNode,
    });
  };

  return (
    <group>
      <mesh geometry={geometry} onClick={handleClick}>
        <meshStandardMaterial
          vertexColors
          roughness={0.6}
          metalness={0.05}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
        />
      </mesh>
      {showGhost && (
        <mesh geometry={ghostGeometry}>
          <meshStandardMaterial
            color="#94a3b8"
            transparent
            opacity={0.15}
            depthWrite={false}
            side={THREE.DoubleSide}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </group>
  );
}
