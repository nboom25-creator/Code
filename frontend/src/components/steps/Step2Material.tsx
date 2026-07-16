import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import {
  useAIProposeLoadCase,
  useManufacturing,
  useMaterials,
  usePresets,
  useProjectMaterial,
  useSetManufacturing,
  useSetMaterial,
  useSetUseCase,
  useUseCase,
} from '../../api/hooks';
import type { LoadCaseProposal, ManufacturingProfile, Material } from '../../api/types';
import { TERM_TOOLTIPS, fmtMaterialProp } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, Collapsible, Field, Panel, Term, cx, inputCls, selectCls } from '../ui';

// user-facing override fields entered in engineering units, converted to SI on save
const OVERRIDE_FIELDS: { key: string; label: string; unit: string; toSI: number }[] = [
  { key: 'density', label: 'Density', unit: 'kg/m³', toSI: 1 },
  { key: 'elastic_modulus', label: 'Elastic modulus E', unit: 'GPa', toSI: 1e9 },
  { key: 'poisson_ratio', label: 'Poisson ratio ν', unit: '—', toSI: 1 },
  { key: 'yield_strength', label: 'Yield strength', unit: 'MPa', toSI: 1e6 },
];

export default function Step2Material({ projectId }: { projectId: string }) {
  const { data: materials } = useMaterials();
  const { data: projMat } = useProjectMaterial(projectId);
  const setMaterialMutation = useSetMaterial(projectId);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // server state is the source of truth: hydrate form once per load
  useEffect(() => {
    if (initialized || projMat === undefined) return;
    if (projMat) {
      setSelectedId(projMat.material.id);
      setConfirmed(projMat.confirmed);
      const eng: Record<string, string> = {};
      for (const [k, v] of Object.entries(projMat.overrides)) {
        const f = OVERRIDE_FIELDS.find((f) => f.key === k);
        eng[k] = f ? String(v / f.toSI) : String(v);
      }
      setOverrides(eng);
    }
    setInitialized(true);
  }, [projMat, initialized]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (materials ?? []).filter(
      (m) => !q || m.name.toLowerCase().includes(q) || m.key.includes(q) || m.category.includes(q),
    );
    const groups = new Map<string, Material[]>();
    for (const m of filtered) {
      const list = groups.get(m.category) ?? [];
      list.push(m);
      groups.set(m.category, list);
    }
    return [...groups.entries()];
  }, [materials, search]);

  const selected = materials?.find((m) => m.id === selectedId) ?? null;

  const save = () => {
    if (!selectedId) return;
    const si: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() === '') continue;
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      const f = OVERRIDE_FIELDS.find((f) => f.key === k);
      si[k] = f ? num * f.toSI : num;
    }
    setMaterialMutation.mutate({ material_id: selectedId, overrides: si, confirmed });
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Material">
        <input
          className={cx(inputCls, 'mb-2')}
          placeholder="Search materials…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-56 overflow-y-auto rounded border border-slate-700">
          {grouped.map(([category, mats]) => (
            <div key={category}>
              <div className="sticky top-0 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {category}
              </div>
              {mats.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={cx(
                    'flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-slate-700/50',
                    m.id === selectedId && 'bg-sky-500/15 text-sky-200',
                  )}
                >
                  <span>{m.name}</span>
                  {!m.isotropic && (
                    <Badge color="amber" title="Anisotropic (printed) — Z strength lower">
                      aniso
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {selected && (
          <div className="mt-3">
            <Alert kind="warning" className="mb-2">
              Representative values — confirm or override the critical properties before FEA
              reports a factor of safety.
            </Alert>
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(selected.properties).map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-700/50 last:border-0">
                    <td className="py-1 pr-2 text-slate-400">
                      {k.replace(/_/g, ' ')}
                      {selected.critical_properties.includes(k) && (
                        <span className="ml-1 text-amber-400" title="Critical property — must be confirmed">
                          *
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right font-mono text-slate-200">
                      {fmtMaterialProp(k, v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 text-[11px] text-slate-500">
              Source: {selected.source}. {selected.notes}
            </div>

            <div className="mt-3 text-xs font-semibold text-slate-200">
              Overrides (entered in engineering units, stored as SI)
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {OVERRIDE_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} [${f.unit}]`}>
                  <input
                    className={inputCls}
                    type="number"
                    step="any"
                    placeholder={fmtMaterialProp(f.key, selected.properties[f.key] ?? null)}
                    value={overrides[f.key] ?? ''}
                    onChange={(e) => setOverrides((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>

            <label className="mt-3 flex items-start gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              I confirm these properties are appropriate for my part (required before a{' '}
              <Term text="factor of safety" tip={TERM_TOOLTIPS.fos} /> is reported).
            </label>
            <Button variant="primary" className="mt-2" onClick={save} disabled={setMaterialMutation.isPending}>
              {setMaterialMutation.isPending ? 'Saving…' : 'Save material'}
            </Button>
            {setMaterialMutation.isError && (
              <Alert kind="error" title="Save material failed" className="mt-2">
                {errorMessage(setMaterialMutation.error)}
              </Alert>
            )}
            {projMat && (
              <div className="mt-2">
                <Badge color={projMat.confirmed ? 'green' : 'amber'}>
                  {projMat.confirmed ? 'material confirmed' : 'material not confirmed'}
                </Badge>
                {(projMat.effective_properties._adjustments?.length ?? 0) > 0 && (
                  <Collapsible label="Effective-property adjustments">
                    <ul className="list-disc pl-4">
                      {projMat.effective_properties._adjustments!.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </Collapsible>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>

      <ManufacturingCard projectId={projectId} />
      <UseCaseCard projectId={projectId} />
      <AIDraftCard projectId={projectId} />
    </div>
  );
}

// ------------------------------------------------------------------ manufacturing

const BUILD_DIRECTIONS: Record<string, number[]> = {
  '+Z': [0, 0, 1],
  '+X': [1, 0, 0],
  '+Y': [0, 1, 0],
};

function ManufacturingCard({ projectId }: { projectId: string }) {
  const { data: mfg } = useManufacturing(projectId);
  const mutation = useSetManufacturing(projectId);
  const [method, setMethod] = useState<ManufacturingProfile['method']>('unspecified');
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || mfg === undefined) return;
    if (mfg) {
      setMethod(mfg.method);
      const p: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(mfg.params)) {
        if (k === 'build_direction' && Array.isArray(v)) {
          const key = Object.entries(BUILD_DIRECTIONS).find(
            ([, dir]) => JSON.stringify(dir) === JSON.stringify(v),
          )?.[0];
          p[k] = key ?? '+Z';
        } else if (typeof v === 'boolean') p[k] = v;
        else p[k] = String(v);
      }
      setParams(p);
    }
    setInitialized(true);
  }, [mfg, initialized]);

  const isPrinted = method === 'fdm' || method === 'sla' || method === 'sls';

  const save = () => {
    const out: Record<string, unknown> = {};
    const num = (k: string) => {
      const v = params[k];
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
    };
    if (isPrinted) {
      num('layer_height_mm');
      num('infill_pct');
      num('wall_count');
      num('nozzle_diameter_mm');
      num('layer_adhesion_factor');
      if (typeof params.infill_pattern === 'string' && params.infill_pattern) {
        out.infill_pattern = params.infill_pattern;
      }
      out.build_direction = BUILD_DIRECTIONS[(params.build_direction as string) ?? '+Z'] ?? [0, 0, 1];
      out.annealed = !!params.annealed;
      out.treat_isotropic = !!params.treat_isotropic;
    }
    mutation.mutate({ method, params: out } as ManufacturingProfile);
  };

  const setP = (k: string, v: string | boolean) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <Panel title="Manufacturing profile">
      <Field label="Method">
        <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as ManufacturingProfile['method'])}>
          <option value="unspecified">Unspecified</option>
          <option value="fdm">FDM (3D print)</option>
          <option value="sla">SLA (resin)</option>
          <option value="sls">SLS (powder)</option>
          <option value="cnc">CNC machining</option>
          <option value="casting">Casting</option>
          <option value="sheet">Sheet metal</option>
        </select>
      </Field>
      {isPrinted && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Layer height [mm]">
            <input className={inputCls} type="number" step="any" value={(params.layer_height_mm as string) ?? ''} onChange={(e) => setP('layer_height_mm', e.target.value)} />
          </Field>
          <Field label="Infill [%]">
            <input className={inputCls} type="number" step="any" value={(params.infill_pct as string) ?? ''} onChange={(e) => setP('infill_pct', e.target.value)} />
          </Field>
          <Field label="Infill pattern">
            <input className={inputCls} value={(params.infill_pattern as string) ?? ''} onChange={(e) => setP('infill_pattern', e.target.value)} placeholder="gyroid…" />
          </Field>
          <Field label="Wall count">
            <input className={inputCls} type="number" value={(params.wall_count as string) ?? ''} onChange={(e) => setP('wall_count', e.target.value)} />
          </Field>
          <Field label="Nozzle Ø [mm]">
            <input className={inputCls} type="number" step="any" value={(params.nozzle_diameter_mm as string) ?? ''} onChange={(e) => setP('nozzle_diameter_mm', e.target.value)} />
          </Field>
          <Field label="Build direction">
            <select className={selectCls} value={(params.build_direction as string) ?? '+Z'} onChange={(e) => setP('build_direction', e.target.value)}>
              {Object.keys(BUILD_DIRECTIONS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field
            label={
              <span title={TERM_TOOLTIPS.layer_adhesion} className="cursor-help underline decoration-dotted">
                Layer adhesion factor (0–1]
              </span>
            }
            hint="Multiplies strengths to model the weaker Z (across-layer) direction."
          >
            <input className={inputCls} type="number" step="any" min={0} max={1} value={(params.layer_adhesion_factor as string) ?? ''} onChange={(e) => setP('layer_adhesion_factor', e.target.value)} placeholder="e.g. 0.6" />
          </Field>
          <div className="flex flex-col justify-end gap-1 pb-1">
            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={!!params.annealed} onChange={(e) => setP('annealed', e.target.checked)} />
              Annealed
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <input type="checkbox" checked={!!params.treat_isotropic} onChange={(e) => setP('treat_isotropic', e.target.checked)} />
              Treat as isotropic
            </label>
          </div>
        </div>
      )}
      <Button className="mt-2" onClick={save} disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save manufacturing profile'}
      </Button>
      {mutation.isError && (
        <Alert kind="error" title="Save manufacturing failed" className="mt-2">
          {errorMessage(mutation.error)}
        </Alert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ use case

function parseOptions(label: string): string[] {
  const idx = label.indexOf(':');
  const body = idx >= 0 ? label.slice(idx + 1) : label;
  return body.split('/').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

function UseCaseCard({ projectId }: { projectId: string }) {
  const { data: presets } = usePresets();
  const { data: usecase } = useUseCase(projectId);
  const mutation = useSetUseCase(projectId);

  const [preset, setPreset] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || usecase === undefined) return;
    if (usecase) {
      setPreset(usecase.preset);
      setFreeText(usecase.free_text);
      setAnswers(usecase.answers ?? {});
    }
    setInitialized(true);
  }, [usecase, initialized]);

  const setAnswer = (k: string, v: unknown) => setAnswers((p) => ({ ...p, [k]: v }));

  const toggleMulti = (k: string, option: string) => {
    const cur = Array.isArray(answers[k]) ? (answers[k] as string[]) : [];
    setAnswer(k, cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option]);
  };

  const activePreset = preset && presets ? presets.presets[preset] : null;

  return (
    <Panel title="Intended use">
      <div className="mb-1 text-[11px] text-slate-500">
        Presets suggest questions only — they never create loads, constraints or magnitudes.
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {presets &&
          Object.entries(presets.presets).map(([key, p]) => (
            <button
              key={key}
              onClick={() => setPreset(key === preset ? null : key)}
              className={cx(
                'rounded border px-2 py-1.5 text-left text-xs',
                key === preset
                  ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-600',
              )}
            >
              {p.label}
            </button>
          ))}
      </div>
      {activePreset && activePreset.prompts.length > 0 && (
        <div className="mt-2 rounded bg-slate-900/70 p-2 text-[11px] text-slate-400">
          <div className="mb-1 font-medium text-slate-300">Questions worth answering:</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {activePreset.prompts.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {presets?.questionnaire.map((f) => {
          if (f.type === 'multiselect') {
            const options = parseOptions(f.label);
            const cur = Array.isArray(answers[f.key]) ? (answers[f.key] as string[]) : [];
            return (
              <Field key={f.key} label={f.label.split(':')[0]}>
                <div className="flex flex-wrap gap-1">
                  {options.map((o) => (
                    <button
                      key={o}
                      onClick={() => toggleMulti(f.key, o)}
                      className={cx(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        cur.includes(o)
                          ? 'border-sky-500/70 bg-sky-500/20 text-sky-200'
                          : 'border-slate-600 text-slate-400 hover:border-slate-500',
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </Field>
            );
          }
          if (f.type === 'number') {
            return (
              <Field key={f.key} label={f.label}>
                <input
                  className={inputCls}
                  type="number"
                  step="any"
                  value={answers[f.key] !== undefined && answers[f.key] !== null ? String(answers[f.key]) : ''}
                  onChange={(e) => setAnswer(f.key, e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
            );
          }
          if (f.type === 'select') {
            const options =
              f.key === 'environment' ? ['indoor', 'outdoor'] : f.key === 'loading' ? ['static', 'cyclic'] : parseOptions(f.label);
            return (
              <Field key={f.key} label={f.label}>
                <select
                  className={selectCls}
                  value={(answers[f.key] as string) ?? ''}
                  onChange={(e) => setAnswer(f.key, e.target.value || null)}
                >
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }
          return (
            <Field key={f.key} label={f.label}>
              <input
                className={inputCls}
                value={(answers[f.key] as string) ?? ''}
                onChange={(e) => setAnswer(f.key, e.target.value)}
              />
            </Field>
          );
        })}
        <Field label="Describe the intended use in your own words">
          <textarea className={inputCls} rows={3} value={freeText} onChange={(e) => setFreeText(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="primary"
        className="mt-2"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ preset, free_text: freeText, answers })}
      >
        {mutation.isPending ? 'Saving…' : 'Save use case'}
      </Button>
      {mutation.isError && (
        <Alert kind="error" title="Save use case failed" className="mt-2">
          {errorMessage(mutation.error)}
        </Alert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ AI draft

function AIDraftCard({ projectId }: { projectId: string }) {
  const { data: usecase } = useUseCase(projectId);
  const mutation = useAIProposeLoadCase(projectId);
  const [text, setText] = useState('');
  const navigate = useNavigate();
  const setBcDraft = useUIStore((s) => s.setBcDraft);

  const proposal: LoadCaseProposal | null = mutation.data?.proposal ?? null;

  return (
    <Panel title="AI draft load case">
      <p className="mb-2 text-[11px] text-slate-500">
        Translates a plain-language description into a structured DRAFT. Providers never invent
        numbers you did not give; the draft must be mapped to regions and confirmed in step 3.
      </p>
      <textarea
        className={inputCls}
        rows={3}
        placeholder="e.g. The bracket carries a 25 kg pump bolted to the two top holes; the base is screwed to a steel frame…"
        value={text || usecase?.free_text || ''}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        className="mt-2"
        disabled={mutation.isPending || (text || usecase?.free_text || '').trim().length < 3}
        onClick={() => mutation.mutate(text || usecase?.free_text || '')}
      >
        {mutation.isPending ? 'Asking provider…' : 'Draft load case'}
      </Button>
      {mutation.isError && (
        <Alert kind="error" title="AI proposal failed" className="mt-2">
          {errorMessage(mutation.error)}
        </Alert>
      )}
      {mutation.data && proposal && (
        <div className="mt-2 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <Badge color="amber">DRAFT</Badge>
            <span className="text-slate-400">provider: {mutation.data.provider}</span>
          </div>
          <Alert kind="warning" className="mb-2">
            This is a draft — map regions and confirm in step 3. Nothing has been applied.
          </Alert>
          <div className="font-medium text-slate-200">{proposal.name}</div>
          {proposal.rationale && <div className="mt-1 text-slate-400">{proposal.rationale}</div>}
          <ul className="mt-2 space-y-1.5">
            {proposal.boundary_conditions.map((bc, i) => (
              <li key={i} className="rounded bg-slate-800 p-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-sky-300">{bc.bc_type}</span>
                  <Button
                    className="!px-1.5 !py-0.5 text-[10px]"
                    onClick={() => {
                      setBcDraft({
                        bc_type: bc.bc_type,
                        magnitude: bc.magnitude,
                        units: bc.units,
                        direction: bc.direction,
                        description: bc.description || bc.region_hint,
                      });
                      navigate(`/p/${projectId}/loads`);
                    }}
                  >
                    Prefill in step 3
                  </Button>
                </div>
                {bc.magnitude != null && (
                  <div className="text-slate-300">
                    {bc.magnitude} {bc.units ?? '(no units!)'}
                  </div>
                )}
                {bc.region_hint && <div className="text-slate-500">region: {bc.region_hint}</div>}
                {bc.description && <div className="text-slate-500">{bc.description}</div>}
              </li>
            ))}
          </ul>
          {proposal.open_questions.length > 0 && (
            <div className="mt-2">
              <div className="font-medium text-amber-300">Open questions</div>
              <ul className="list-disc pl-4 text-slate-400">
                {proposal.open_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2 text-[10px] text-slate-500">{mutation.data.note}</div>
        </div>
      )}
    </Panel>
  );
}
