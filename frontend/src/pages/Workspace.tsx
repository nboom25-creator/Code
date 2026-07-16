import { useEffect } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router-dom';
import {
  useCapabilities,
  useLoadCases,
  useMeshes,
  useProject,
  useProjectMaterial,
  useRecommendations,
  useReports,
  useResults,
  useVariants,
} from '../api/hooks';
import { errorMessage } from '../api/client';
import JobsBar from '../components/JobsBar';
import ComparisonViewports from '../components/viewer/ComparisonViewports';
import Viewer3D from '../components/viewer/Viewer3D';
import Step1Upload from '../components/steps/Step1Upload';
import Step2Material from '../components/steps/Step2Material';
import Step3Loads from '../components/steps/Step3Loads';
import Step4Analysis from '../components/steps/Step4Analysis';
import Step5Recommendations from '../components/steps/Step5Recommendations';
import Step6Variants from '../components/steps/Step6Variants';
import Step7Comparison from '../components/steps/Step7Comparison';
import Step8Report from '../components/steps/Step8Report';
import { Alert, Badge, cx } from '../components/ui';
import { useUIStore } from '../stores/ui';

const STEPS = [
  { key: 'upload', num: 1, label: 'Upload & Geometry' },
  { key: 'material', num: 2, label: 'Material & Use' },
  { key: 'loads', num: 3, label: 'Loads & Constraints' },
  { key: 'analysis', num: 4, label: 'Analysis' },
  { key: 'recommendations', num: 5, label: 'Recommendations' },
  { key: 'variants', num: 6, label: 'Design Variants' },
  { key: 'comparison', num: 7, label: 'Comparison' },
  { key: 'report', num: 8, label: 'Report & Export' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

const SUPPORT_TYPES = new Set(['fixed', 'pinned', 'roller', 'symmetry']);
const LOAD_TYPES = new Set(['force', 'pressure', 'bearing', 'torque', 'gravity', 'rotation']);

export default function Workspace() {
  const { projectId, step } = useParams<{ projectId: string; step: string }>();
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const { data: caps } = useCapabilities();
  const { data: meshes } = useMeshes(projectId);
  const { data: material } = useProjectMaterial(projectId);
  const { data: loadCases } = useLoadCases(projectId);
  const { data: results } = useResults(projectId);
  const { data: recommendations } = useRecommendations(projectId);
  const { data: variants } = useVariants(projectId);
  const { data: reports } = useReports(projectId);

  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const setSelectedMeshId = useUIStore((s) => s.setSelectedMeshId);

  // reset viewer state when the project changes
  useEffect(() => {
    setSelectedMeshId(null);
    useUIStore.getState().setFeaResultId(null);
    useUIStore.getState().setHighlightTriangles(null);
    useUIStore.getState().setSelectionTool('none');
  }, [projectId, setSelectedMeshId]);

  // default mesh: newest non-variant version
  useEffect(() => {
    if (!meshes || meshes.length === 0) return;
    const stillValid = selectedMeshId && meshes.some((m) => m.id === selectedMeshId);
    if (!stillValid) {
      const nonVariant = [...meshes].reverse().find((m) => m.kind !== 'variant');
      setSelectedMeshId((nonVariant ?? meshes[meshes.length - 1]).id);
    }
  }, [meshes, selectedMeshId, setSelectedMeshId]);

  if (!projectId || !step) return <Navigate to="/" replace />;
  if (!STEPS.some((s) => s.key === step)) return <Navigate to={`/p/${projectId}/upload`} replace />;

  if (projectQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Alert kind="error" title="Failed to open project">
          {errorMessage(projectQuery.error)}{' '}
          <Link className="text-sky-300 underline" to="/">
            Back to dashboard
          </Link>
        </Alert>
      </div>
    );
  }

  const loadCaseReady = (loadCases ?? []).some(
    (lc) =>
      lc.boundary_conditions.some((b) => SUPPORT_TYPES.has(b.bc_type)) &&
      lc.boundary_conditions.some((b) => LOAD_TYPES.has(b.bc_type)),
  );

  const completion: Record<StepKey, boolean> = {
    upload: !!meshes?.length && !!project?.unit_confirmed,
    material: !!material?.confirmed,
    loads: loadCaseReady,
    analysis: (results ?? []).length > 0,
    recommendations: (recommendations ?? []).length > 0,
    variants: (variants ?? []).some((v) => v.status === 'succeeded'),
    comparison: (variants ?? []).some((v) => v.status === 'succeeded'),
    report: (reports ?? []).length > 0,
  };

  const stepKey = step as StepKey;

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-700/70 bg-slate-800 px-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-base font-bold text-sky-400 hover:text-sky-300">
            PartForge AI
          </Link>
          <span className="text-slate-600">/</span>
          <span className="max-w-[280px] truncate text-sm font-medium text-slate-200">
            {project?.name ?? '…'}
          </span>
          {project?.is_demo && <Badge color="purple">demo</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {caps && (
            <Badge
              color={caps.fea_available ? 'green' : 'amber'}
              title={
                caps.fea_available
                  ? `Gmsh + CalculiX detected (${caps.version})`
                  : `ccx available: ${caps.ccx_available}, gmsh available: ${caps.gmsh_available}`
              }
            >
              {caps.fea_available ? 'FEA: available' : 'FEA: solver not installed'}
            </Badge>
          )}
          <Link to="/settings" className="text-xs text-slate-400 hover:text-sky-300">
            Settings
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <nav className="flex w-52 shrink-0 flex-col border-r border-slate-700/70 bg-slate-800/60 py-2">
          <NavLink
            to="/"
            className="mx-2 mb-1 rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
          >
            ← Dashboard
          </NavLink>
          {STEPS.map((s) => (
            <NavLink
              key={s.key}
              to={`/p/${projectId}/${s.key}`}
              className={({ isActive }) =>
                cx(
                  'mx-2 flex items-center gap-2 rounded px-2 py-1.5 text-xs',
                  isActive
                    ? 'bg-sky-500/15 font-medium text-sky-300'
                    : 'text-slate-300 hover:bg-slate-700/60',
                )
              }
            >
              <span
                className={cx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                  completion[s.key]
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : 'border-slate-600 text-slate-400',
                )}
              >
                {completion[s.key] ? '✓' : s.num}
              </span>
              <span className="truncate">{s.label}</span>
            </NavLink>
          ))}
          <div className="mt-auto px-4 pb-2 text-[10px] leading-relaxed text-slate-600">
            Geometry observations come from the mesh; FEA results are preliminary linear statics,
            not a certified validation.
          </div>
        </nav>

        {/* center viewport */}
        <div className="min-w-0 flex-1">
          {stepKey === 'comparison' ? (
            <ComparisonViewports projectId={projectId} />
          ) : (
            <Viewer3D projectId={projectId} />
          )}
        </div>

        {/* right panel */}
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-700/70 bg-slate-800/40 p-3">
          {stepKey === 'upload' && <Step1Upload projectId={projectId} />}
          {stepKey === 'material' && <Step2Material projectId={projectId} />}
          {stepKey === 'loads' && <Step3Loads projectId={projectId} />}
          {stepKey === 'analysis' && <Step4Analysis projectId={projectId} />}
          {stepKey === 'recommendations' && <Step5Recommendations projectId={projectId} />}
          {stepKey === 'variants' && <Step6Variants projectId={projectId} />}
          {stepKey === 'comparison' && <Step7Comparison projectId={projectId} />}
          {stepKey === 'report' && <Step8Report projectId={projectId} />}
        </aside>
      </div>

      <JobsBar projectId={projectId} />
    </div>
  );
}
