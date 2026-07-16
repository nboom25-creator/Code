import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  AIExplainResponse,
  AIProposeResponse,
  BCInput,
  BoundaryCondition,
  Capabilities,
  ComparisonResponse,
  DemoResponse,
  DesignVariant,
  GeometryAnalysis,
  Job,
  LoadCase,
  LoadCaseValidation,
  ManufacturingProfile,
  Material,
  MeshVersion,
  PresetsResponse,
  Project,
  ProjectMaterial,
  Recommendation,
  Region,
  RepairCommitResponse,
  RepairPreview,
  ReportEntry,
  ResultFields,
  ScalarField,
  SimulationResult,
  SnapshotResponse,
  UnitSuggestion,
  UploadResponse,
  UseCase,
} from './types';

// ------------------------------------------------------------------ job retry registry
// Jobs are created by POSTs; to offer "retry" we remember the originating request.
const jobRequests = new Map<string, { path: string; body: unknown }>();

export function registerJobRequest(jobId: string, path: string, body: unknown) {
  jobRequests.set(jobId, { path, body });
}

export function getJobRequest(jobId: string) {
  return jobRequests.get(jobId);
}

export function invalidateForJobKind(qc: QueryClient, kind: string) {
  if (kind === 'geometry_analysis') {
    void qc.invalidateQueries({ queryKey: ['analysis'] });
    void qc.invalidateQueries({ queryKey: ['scalars'] });
    void qc.invalidateQueries({ queryKey: ['meshes'] });
  } else if (kind === 'fea') {
    void qc.invalidateQueries({ queryKey: ['results'] });
  } else if (kind === 'variant_generation') {
    void qc.invalidateQueries({ queryKey: ['variants'] });
    void qc.invalidateQueries({ queryKey: ['meshes'] });
    void qc.invalidateQueries({ queryKey: ['comparison'] });
    void qc.invalidateQueries({ queryKey: ['results'] });
    void qc.invalidateQueries({ queryKey: ['analysis'] });
  } else if (kind === 'report') {
    void qc.invalidateQueries({ queryKey: ['reports'] });
  }
  void qc.invalidateQueries({ queryKey: ['jobs'] });
}

// ------------------------------------------------------------------ queries

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.get<Capabilities>('/capabilities'),
    staleTime: Infinity,
  });
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });
}

export function useMeshes(projectId: string | undefined) {
  return useQuery({
    queryKey: ['meshes', projectId],
    queryFn: () => api.get<MeshVersion[]>(`/projects/${projectId}/meshes`),
    enabled: !!projectId,
  });
}

export function useUnitSuggestion(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['unitSuggestion', projectId],
    queryFn: () => api.get<UnitSuggestion>(`/projects/${projectId}/unit/suggestion`),
    enabled: !!projectId && enabled,
    retry: false,
  });
}

export function useMeshScalars(meshId: string | undefined, field: string | null) {
  return useQuery({
    queryKey: ['scalars', meshId, field],
    queryFn: () => api.get<ScalarField>(`/meshes/${meshId}/scalars?field=${field}`),
    enabled: !!meshId && !!field,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useMeshFile(meshId: string | undefined) {
  return useQuery({
    queryKey: ['meshFile', meshId],
    queryFn: () => api.arrayBuffer(`/meshes/${meshId}/file`),
    enabled: !!meshId,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}

export function useMaterials() {
  return useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<Material[]>('/materials'),
    staleTime: 5 * 60_000,
  });
}

export function useProjectMaterial(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projectMaterial', projectId],
    queryFn: () => api.get<ProjectMaterial | null>(`/projects/${projectId}/material`),
    enabled: !!projectId,
  });
}

export function useManufacturing(projectId: string | undefined) {
  return useQuery({
    queryKey: ['manufacturing', projectId],
    queryFn: () => api.get<ManufacturingProfile | null>(`/projects/${projectId}/manufacturing`),
    enabled: !!projectId,
  });
}

export function usePresets() {
  return useQuery({
    queryKey: ['presets'],
    queryFn: () => api.get<PresetsResponse>('/presets'),
    staleTime: Infinity,
  });
}

export function useUseCase(projectId: string | undefined) {
  return useQuery({
    queryKey: ['usecase', projectId],
    queryFn: () => api.get<UseCase | null>(`/projects/${projectId}/usecase`),
    enabled: !!projectId,
  });
}

export function useRegions(projectId: string | undefined, meshVersionId?: string) {
  return useQuery({
    queryKey: ['regions', projectId, meshVersionId ?? 'all'],
    queryFn: () =>
      api.get<Region[]>(
        `/projects/${projectId}/regions${meshVersionId ? `?mesh_version_id=${meshVersionId}` : ''}`,
      ),
    enabled: !!projectId,
  });
}

export function useLoadCases(projectId: string | undefined) {
  return useQuery({
    queryKey: ['loadcases', projectId],
    queryFn: () => api.get<LoadCase[]>(`/projects/${projectId}/loadcases`),
    enabled: !!projectId,
  });
}

export function useJobs(projectId: string | undefined, pollMs: number | false) {
  return useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.get<Job[]>(`/projects/${projectId}/jobs`),
    enabled: !!projectId,
    refetchInterval: pollMs,
  });
}

export function useGeometryAnalysis(meshId: string | undefined) {
  return useQuery({
    queryKey: ['analysis', meshId],
    queryFn: () => api.get<GeometryAnalysis>(`/meshes/${meshId}/analysis`),
    enabled: !!meshId,
    retry: false,
  });
}

export function useResults(projectId: string | undefined) {
  return useQuery({
    queryKey: ['results', projectId],
    queryFn: () => api.get<SimulationResult[]>(`/projects/${projectId}/results`),
    enabled: !!projectId,
  });
}

export function useResultFields(resultId: string | undefined) {
  return useQuery({
    queryKey: ['resultFields', resultId],
    queryFn: () => api.get<ResultFields>(`/results/${resultId}/fields`),
    enabled: !!resultId,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export function useRecommendations(projectId: string | undefined, meshVersionId?: string) {
  return useQuery({
    queryKey: ['recommendations', projectId, meshVersionId ?? 'all'],
    queryFn: () =>
      api.get<Recommendation[]>(
        `/projects/${projectId}/recommendations${meshVersionId ? `?mesh_version_id=${meshVersionId}` : ''}`,
      ),
    enabled: !!projectId,
  });
}

export function useVariants(projectId: string | undefined) {
  return useQuery({
    queryKey: ['variants', projectId],
    queryFn: () => api.get<DesignVariant[]>(`/projects/${projectId}/variants`),
    enabled: !!projectId,
  });
}

export function useComparison(projectId: string | undefined, baselineMeshId?: string) {
  return useQuery({
    queryKey: ['comparison', projectId, baselineMeshId ?? 'auto'],
    queryFn: () =>
      api.get<ComparisonResponse>(
        `/projects/${projectId}/comparison${baselineMeshId ? `?baseline_mesh_id=${baselineMeshId}` : ''}`,
      ),
    enabled: !!projectId,
    retry: false,
  });
}

export function useReports(projectId: string | undefined) {
  return useQuery({
    queryKey: ['reports', projectId],
    queryFn: () => api.get<ReportEntry[]>(`/projects/${projectId}/reports`),
    enabled: !!projectId,
  });
}

// ------------------------------------------------------------------ mutations

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.post<Project>('/projects', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.delete<{ deleted: boolean }>(`/projects/${projectId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useCreateDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DemoResponse>('/demo'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useConfirmUnit(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unit: string) => api.post<Project>(`/projects/${projectId}/unit`, { unit }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUploadMesh(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<UploadResponse>(`/projects/${projectId}/upload`, form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meshes', projectId] });
      void qc.invalidateQueries({ queryKey: ['unitSuggestion', projectId] });
    },
  });
}

export function useRepairPreview(meshId: string | undefined) {
  return useMutation({
    mutationFn: (operations: string[]) =>
      api.post<RepairPreview>(`/meshes/${meshId}/repair/preview`, { operations }),
  });
}

export function useRepairCommit(projectId: string, meshId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operations: string[]) =>
      api.post<RepairCommitResponse>(`/meshes/${meshId}/repair/commit`, { operations }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meshes', projectId] }),
  });
}

export function useSetMaterial(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { material_id: string; overrides: Record<string, number>; confirmed: boolean }) =>
      api.put<ProjectMaterial>(`/projects/${projectId}/material`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projectMaterial', projectId] }),
  });
}

export function useSetManufacturing(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManufacturingProfile) =>
      api.put<ManufacturingProfile>(`/projects/${projectId}/manufacturing`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', projectId] });
      void qc.invalidateQueries({ queryKey: ['projectMaterial', projectId] });
    },
  });
}

export function useSetUseCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { preset: string | null; free_text: string; answers: Record<string, unknown> }) =>
      api.put<UseCase>(`/projects/${projectId}/usecase`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['usecase', projectId] }),
  });
}

export function useCreateRegion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      mesh_version_id: string;
      name: string;
      triangle_indices: number[];
      kind?: string;
      meta?: Record<string, unknown>;
      color?: string;
    }) => api.post<Region>(`/projects/${projectId}/regions`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['regions', projectId] }),
  });
}

export function useDeleteRegion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (regionId: string) => api.delete<{ deleted: boolean }>(`/regions/${regionId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['regions', projectId] }),
  });
}

export function useProtectRegion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ regionId, reason, protect }: { regionId: string; reason: string; protect: boolean }) =>
      protect
        ? api.post<Region>(`/regions/${regionId}/protect`, { reason })
        : api.delete<Region>(`/regions/${regionId}/protect`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['regions', projectId] }),
  });
}

export function useCreateLoadCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.post<LoadCase>(`/projects/${projectId}/loadcases`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['loadcases', projectId] }),
  });
}

export function useDeleteLoadCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loadCaseId: string) => api.delete<{ deleted: boolean }>(`/loadcases/${loadCaseId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['loadcases', projectId] }),
  });
}

export function useAddBC(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ loadCaseId, bc }: { loadCaseId: string; bc: BCInput }) =>
      api.post<BoundaryCondition>(`/loadcases/${loadCaseId}/bcs`, bc),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['loadcases', projectId] }),
  });
}

export function useDeleteBC(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bcId: string) => api.delete<{ deleted: boolean }>(`/bcs/${bcId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['loadcases', projectId] }),
  });
}

export function useValidateLoadCase() {
  return useMutation({
    mutationFn: (loadCaseId: string) =>
      api.post<LoadCaseValidation>(`/loadcases/${loadCaseId}/validate`),
  });
}

export function useStartGeometryAnalysis(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meshVersionId: string) => {
      const path = `/projects/${projectId}/analyze/geometry`;
      const body = { mesh_version_id: meshVersionId };
      return api.post<Job>(path, body).then((job) => {
        registerJobRequest(job.id, path, body);
        return job;
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useStartFea(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      mesh_version_id: string;
      load_case_id: string;
      display_mesh_id?: string;
      settings?: { target_elements?: number; second_order?: boolean };
    }) => {
      const path = `/projects/${projectId}/analyze/fea`;
      return api.post<Job>(path, body).then((job) => {
        registerJobRequest(job.id, path, body);
        return job;
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useCancelJob(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<Job>(`/jobs/${jobId}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useRetryJob(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => {
      const req = jobRequests.get(jobId);
      if (!req) throw new Error('The original request for this job is not known to this session.');
      return api.post<Job>(req.path, req.body).then((job) => {
        registerJobRequest(job.id, req.path, req.body);
        return job;
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useGenerateRecommendations(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meshVersionId: string) =>
      api.post<Recommendation[]>(`/projects/${projectId}/recommendations/generate`, {
        mesh_version_id: meshVersionId,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recommendations', projectId] }),
  });
}

export function usePatchRecommendation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: 'open' | 'accepted' | 'dismissed' }) =>
      api.patch<Recommendation>(`/recommendations/${id}`, { state }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recommendations', projectId] }),
  });
}

export function useGenerateVariants(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { base_mesh_id: string; strategies: string[]; recommendation_ids?: string[] }) => {
      const path = `/projects/${projectId}/variants/generate`;
      return api.post<Job>(path, body).then((job) => {
        registerJobRequest(job.id, path, body);
        return job;
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useSetVariantApproval(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, approval }: { variantId: string; approval: string }) =>
      api.post<DesignVariant>(`/variants/${variantId}/approval`, { approval }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['variants', projectId] }),
  });
}

export function useGenerateReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meshVersionId: string | null) => {
      const path = `/projects/${projectId}/report`;
      const body = { mesh_version_id: meshVersionId };
      return api.post<Job>(path, body).then((job) => {
        registerJobRequest(job.id, path, body);
        return job;
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', projectId] }),
  });
}

export function useUploadSnapshot(projectId: string) {
  return useMutation({
    mutationFn: ({ blob, label }: { blob: Blob; label: string }) => {
      const form = new FormData();
      form.append('file', blob, 'snapshot.png');
      form.append('label', label);
      return api.postForm<SnapshotResponse>(`/projects/${projectId}/snapshots`, form);
    },
  });
}

export function useAIExplain(projectId: string) {
  return useMutation({
    mutationFn: (meshVersionId: string) =>
      api.post<AIExplainResponse>(`/projects/${projectId}/ai/explain`, {
        mesh_version_id: meshVersionId,
      }),
  });
}

export function useAIProposeLoadCase(projectId: string) {
  return useMutation({
    mutationFn: (text: string) =>
      api.post<AIProposeResponse>(`/projects/${projectId}/ai/propose-loadcase`, { text }),
  });
}
