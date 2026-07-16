import { create } from 'zustand';

export type DisplayMode = 'shaded' | 'wireframe' | 'xray' | 'edges';
export type HeatmapField = 'none' | 'thickness' | 'overhang' | 'sharpness';
export type SelectionTool = 'none' | 'seed' | 'brush' | 'measure' | 'probe';
export type FeaField = 'von_mises' | 'displacement';
export type Axis = 'x' | 'y' | 'z';

export interface CameraSync {
  position: [number, number, number];
  target: [number, number, number];
  source: 'left' | 'right' | null;
  seq: number;
}

interface UIState {
  // active mesh version shown in the viewer
  selectedMeshId: string | null;
  setSelectedMeshId: (id: string | null) => void;

  // viewer display
  displayMode: DisplayMode;
  setDisplayMode: (m: DisplayMode) => void;
  orthographic: boolean;
  setOrthographic: (v: boolean) => void;
  heatmapField: HeatmapField;
  setHeatmapField: (f: HeatmapField) => void;

  // section plane
  sectionEnabled: boolean;
  sectionAxis: Axis;
  sectionOffset: number; // -1..1 of bbox extent
  setSection: (p: Partial<{ sectionEnabled: boolean; sectionAxis: Axis; sectionOffset: number }>) => void;

  // selection
  selectionTool: SelectionTool;
  setSelectionTool: (t: SelectionTool) => void;
  angleThresholdDeg: number;
  setAngleThresholdDeg: (v: number) => void;
  brushRadius: number; // fraction of bbox diagonal
  setBrushRadius: (v: number) => void;
  selectedTriangles: Set<number>;
  setSelectedTriangles: (s: Set<number>) => void;
  clearSelection: () => void;

  // FEA overlay
  feaResultId: string | null;
  setFeaResultId: (id: string | null) => void;
  feaField: FeaField;
  setFeaField: (f: FeaField) => void;
  feaScale: number; // deformation scale 0..500
  setFeaScale: (v: number) => void;
  feaShowGhost: boolean;
  setFeaShowGhost: (v: boolean) => void;

  // fly-to marker (recommendation locations)
  flyTo: { point: [number, number, number]; seq: number } | null;
  requestFlyTo: (point: [number, number, number]) => void;
  highlightTriangles: number[] | null;
  setHighlightTriangles: (t: number[] | null) => void;

  // camera command (fit / standard views)
  cameraCommand: { cmd: 'fit' | 'front' | 'top' | 'right' | 'iso'; seq: number } | null;
  requestCamera: (cmd: 'fit' | 'front' | 'top' | 'right' | 'iso') => void;

  // BC draft prefill (from AI proposal, step 2 -> step 3)
  bcDraft: {
    bc_type: string;
    magnitude: number | null;
    units: string | null;
    direction: number[] | null;
    description: string;
  } | null;
  setBcDraft: (d: UIState['bcDraft']) => void;

  // active load case whose BCs are drawn as glyphs
  activeLoadCaseId: string | null;
  setActiveLoadCaseId: (id: string | null) => void;

  // comparison synchronized camera
  cameraSync: CameraSync;
  setCameraSync: (s: CameraSync) => void;
  comparisonVariantMeshId: string | null;
  setComparisonVariantMeshId: (id: string | null) => void;
  comparisonMode: 'side-by-side' | 'overlay' | 'difference';
  setComparisonMode: (m: 'side-by-side' | 'overlay' | 'difference') => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedMeshId: null,
  setSelectedMeshId: (id) =>
    set({ selectedMeshId: id, selectedTriangles: new Set(), highlightTriangles: null }),

  displayMode: 'shaded',
  setDisplayMode: (m) => set({ displayMode: m }),
  orthographic: false,
  setOrthographic: (v) => set({ orthographic: v }),
  heatmapField: 'none',
  setHeatmapField: (f) => set({ heatmapField: f }),

  sectionEnabled: false,
  sectionAxis: 'x',
  sectionOffset: 0,
  setSection: (p) => set(p),

  selectionTool: 'none',
  setSelectionTool: (t) => set({ selectionTool: t }),
  angleThresholdDeg: 30,
  setAngleThresholdDeg: (v) => set({ angleThresholdDeg: v }),
  brushRadius: 0.05,
  setBrushRadius: (v) => set({ brushRadius: v }),
  selectedTriangles: new Set<number>(),
  setSelectedTriangles: (s) => set({ selectedTriangles: s }),
  clearSelection: () => set({ selectedTriangles: new Set() }),

  feaResultId: null,
  setFeaResultId: (id) => set({ feaResultId: id }),
  feaField: 'von_mises',
  setFeaField: (f) => set({ feaField: f }),
  feaScale: 50,
  setFeaScale: (v) => set({ feaScale: v }),
  feaShowGhost: true,
  setFeaShowGhost: (v) => set({ feaShowGhost: v }),

  flyTo: null,
  requestFlyTo: (point) =>
    set((s) => ({ flyTo: { point, seq: (s.flyTo?.seq ?? 0) + 1 } })),
  highlightTriangles: null,
  setHighlightTriangles: (t) => set({ highlightTriangles: t }),

  cameraCommand: null,
  requestCamera: (cmd) =>
    set((s) => ({ cameraCommand: { cmd, seq: (s.cameraCommand?.seq ?? 0) + 1 } })),

  bcDraft: null,
  setBcDraft: (d) => set({ bcDraft: d }),

  activeLoadCaseId: null,
  setActiveLoadCaseId: (id) => set({ activeLoadCaseId: id }),

  cameraSync: { position: [3, 2, 3], target: [0, 0, 0], source: null, seq: 0 },
  setCameraSync: (s) => set({ cameraSync: s }),
  comparisonVariantMeshId: null,
  setComparisonVariantMeshId: (id) => set({ comparisonVariantMeshId: id }),
  comparisonMode: 'side-by-side',
  setComparisonMode: (m) => set({ comparisonMode: m }),
}));
