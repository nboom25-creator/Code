import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { rankNextActions } from "@/lib/assistant/nextActions";
import { formatQty } from "@/lib/units";
import { PROJECT_PHASES } from "@/lib/project/settings";
import { Card, Grid, Stat, PageHeader, Badge, EmptyState, SampleBanner, WarningList } from "@/components/ui";
import { OnboardingActions } from "@/components/OnboardingActions";
import { MassShareChart } from "@/components/DashboardCharts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snap = await getActiveSnapshot();

  if (!snap) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="GliderForge Assistant"
          subtitle="An engineering workspace for a laboratory-scale autonomous underwater glider driven by a motor-driven syringe buoyancy engine."
        />
        <EmptyState
          title="No project yet"
          body={
            <>
              <p>
                Create a project to start, or load the demonstration project to see the whole workflow — component inventory, buoyancy
                budget, syringe sizing, stability, mission simulation and test planning — populated with clearly-labelled synthetic data.
              </p>
              <p className="mt-2">
                Nothing in this application is a verified engineering result. It shows its working, states its assumptions, and tells you
                what it does not know.
              </p>
            </>
          }
          action={<OnboardingActions />}
        />
      </div>
    );
  }

  const actions = rankNextActions(snap);
  const errors = snap.warnings.filter((w) => w.warning.severity === "error");
  const warns = snap.warnings.filter((w) => w.warning.severity === "warning");
  const phase = PROJECT_PHASES.find((p) => p.id === snap.project.phase);
  const q = (v: number | undefined, unit: string, digits = 4) =>
    v === undefined || !Number.isFinite(v) ? "—" : formatQty({ value: v, unit }, digits);

  const net = snap.buoyancy.values.netBuoyantForce.value;
  const dz = snap.stability.values.verticalSeparation.value;
  const authority = snap.syringe.values.buoyancyForceChange.value;
  const weight = snap.buoyancy.values.weight.value;
  const authorityPct = weight > 0 ? (authority / weight) * 100 : NaN;

  const upcoming = snap.milestones
    .filter((m) => String(m.status) !== "complete")
    .slice(0, 4);
  const openQuestions = snap.notebook.filter((n) => String(n.kind) === "question").slice(0, 4);
  const openAssumptions = snap.assumptions.filter((a) => String(a.status) === "open");

  return (
    <div className="space-y-5">
      {snap.project.is_sample === 1 && <SampleBanner />}

      <PageHeader
        title={snap.project.name}
        subtitle={
          <>
            Phase <strong>{phase?.label ?? snap.project.phase}</strong> · overall completion{" "}
            <strong>{snap.completion.percent.toFixed(0)}%</strong> · water{" "}
            {q(snap.water.densitySI, "kg/m^3", 6)} ({snap.settings.environment.temperatureC} °C,{" "}
            {snap.settings.environment.salinityPSU} PSU)
          </>
        }
        actions={
          <>
            <Link href="/assistant" className="gf-btn">
              Ask the assistant
            </Link>
            <Link href="/reports" className="gf-btn gf-btn-primary">
              Generate a report
            </Link>
          </>
        }
      />

      {/* ---- Vehicle state ------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Vehicle state</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Current vehicle mass"
            value={q(snap.massProps.values.totalMass.value, "kg")}
            hint={`${snap.components.length} components${snap.massProps.missingMass.length > 0 ? `, ${snap.massProps.missingMass.length} with no mass` : ""}`}
            provenance={snap.massProps.missingMass.length > 0 ? "unknown" : "calculated"}
            tone={snap.massProps.missingMass.length > 0 ? "critical" : undefined}
            href="/mass"
          />
          <Stat
            label="Estimated displaced volume"
            value={q(snap.massProps.values.totalDisplacedVolume.value * 1e6, "cm^3")}
            hint={snap.massProps.missingVolume.length > 0 ? `${snap.massProps.missingVolume.length} water-exposed parts have no volume` : "All water-exposed parts have a volume"}
            provenance={snap.massProps.missingVolume.length > 0 ? "unknown" : "calculated"}
            tone={snap.massProps.missingVolume.length > 0 ? "critical" : undefined}
            href="/mass"
          />
          <Stat
            label="Net buoyancy"
            value={q(net, "N")}
            hint={
              Number.isFinite(snap.neutral.massChangeSI)
                ? `${Math.abs(snap.neutral.massChangeSI * 1000).toFixed(1)} g ${snap.neutral.massChangeSI >= 0 ? "to add" : "to remove"} for neutral`
                : "Cannot solve for neutral"
            }
            tone={!Number.isFinite(net) ? "critical" : Math.abs(net) < 0.05 ? "good" : undefined}
            href="/mass"
          />
          <Stat
            label="Available syringe volume"
            value={q(snap.syringe.values.usableVolumeChange.value * 1e6, "cm^3")}
            hint={`${q(authority, "N")} of authority${Number.isFinite(authorityPct) ? ` = ${authorityPct.toFixed(2)}% of weight` : ""}`}
            tone={Number.isFinite(authorityPct) && authorityPct < 0.5 ? "warning" : undefined}
            href="/syringe"
          />
          <Stat
            label="Centre of gravity"
            value={Number.isFinite(snap.massProps.cg.x) ? `${(snap.massProps.cg.x * 1000).toFixed(1)}` : "—"}
            unit="mm from datum"
            hint={`y ${(snap.massProps.cg.y * 1000).toFixed(1)}, z ${(snap.massProps.cg.z * 1000).toFixed(1)} mm`}
            href="/stability"
          />
          <Stat
            label="Centre of buoyancy"
            value={Number.isFinite(snap.massProps.cb.x) ? `${(snap.massProps.cb.x * 1000).toFixed(1)}` : "—"}
            unit="mm from datum"
            hint={`y ${(snap.massProps.cb.y * 1000).toFixed(1)}, z ${(snap.massProps.cb.z * 1000).toFixed(1)} mm`}
            href="/stability"
          />
          <Stat
            label="Predicted pitch stability"
            value={Number.isFinite(dz) ? `${(dz * 1000).toFixed(1)}` : "—"}
            unit="mm CB above CG"
            hint={
              !Number.isFinite(dz)
                ? "CG or CB unknown"
                : dz <= 0
                  ? "UNSTABLE — CB is not above CG"
                  : dz < 0.005
                    ? "Marginal — inside build tolerance"
                    : `Equilibrium pitch ${((snap.stability.values.equilibriumPitch.value * 180) / Math.PI).toFixed(1)}°`
            }
            tone={!Number.isFinite(dz) ? "critical" : dz <= 0 ? "critical" : dz < 0.005 ? "warning" : "good"}
            href="/stability"
          />
          <Stat
            label="Predicted dive / climb"
            value={`${q(snap.diveGlide.values.speed.value, "m/s", 3)}`}
            hint={`Glide ratio ${q(snap.diveGlide.values.glideRatio.value, "-", 3)}, vertical ${q(Math.abs(snap.diveGlide.values.verticalSpeed.value), "m/s", 3)} · coefficients are ${snap.settings.hydro.coefficientSource}`}
            provenance={snap.settings.hydro.coefficientSource === "assumed" ? "assumed" : "calculated"}
            tone={snap.settings.hydro.coefficientSource === "assumed" ? "warning" : undefined}
            href="/hydro"
          />
        </div>
      </section>

      {/* ---- Next actions -------------------------------------------- */}
      <Card
        title="What should I work on next?"
        subtitle="Ranked from your project data by technical risk, dependencies, missing information and deadlines. Deterministic — the same data always gives the same ranking."
      >
        {actions.length === 0 ? (
          <p className="text-sm text-muted">Every check I run passes. Look at requirement verification for what remains.</p>
        ) : (
          <ol className="space-y-3">
            {actions.slice(0, 6).map((a, i) => (
              <li key={a.id} className="rounded border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="gf-num text-xs font-bold text-muted">{i + 1}.</span>
                    <Link href={a.href} className="text-sm font-semibold hover:underline">
                      {a.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      tone={a.category === "blocking" || a.category === "risk" ? "critical" : a.category === "verification" ? "warning" : "neutral"}
                    >
                      {a.category}
                    </Badge>
                    <Badge tone="neutral" title="Priority score from the ranking factors">
                      {a.score}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  <strong className="text-ink">Why: </strong>
                  {a.why}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  <strong className="text-ink">What would close it: </strong>
                  {a.evidence}
                </p>
                <p className="mt-1.5 text-[11px] text-muted">
                  Score from: {a.factors.map((f) => `${f.label} (+${f.points})`).join(", ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Grid cols={2}>
        {/* ---- Design warnings --------------------------------------- */}
        <Card
          title="Design warnings"
          subtitle={`${errors.length} error(s) and ${warns.length} warning(s) raised by the current model`}
        >
          {errors.length === 0 && warns.length === 0 ? (
            <p className="text-sm text-muted">No errors or warnings from the current model. That is not the same as being correct — it means nothing tripped a check.</p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {[...errors, ...warns].slice(0, 20).map((w, i) => (
                <div key={i} className="text-xs">
                  <Badge tone={w.warning.severity === "error" ? "critical" : "warning"}>
                    <span aria-hidden>{w.warning.severity === "error" ? "✕" : "!"}</span>
                    {w.module}
                  </Badge>
                  <p className="mt-1 leading-relaxed text-muted">{w.warning.message}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- Mass shares ------------------------------------------- */}
        <MassShareChart
          contributions={snap.massProps.contributions.map((c) => ({
            name: c.name,
            massG: c.massSI * 1000,
            volumeCm3: c.volumeSI * 1e6,
          }))}
        />
      </Grid>

      <Grid cols={3}>
        <Card title="Requirement verification" subtitle={`${snap.completion.requirementsVerified} of ${snap.completion.requirementsTotal} verified`}>
          {snap.requirements.length === 0 ? (
            <p className="text-xs text-muted">
              No requirements yet. <Link href="/requirements" className="underline">Write them</Link> — they are what your report and design review are judged against.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {snap.requirements.slice(0, 12).map((r) => (
                <li key={String(r.id)} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] text-muted">{String(r.key)}</span> {String(r.title)}
                  </span>
                  <Badge tone={String(r.verification_status) === "verified" ? "good" : String(r.verification_status) === "in-progress" ? "warning" : "neutral"}>
                    {String(r.verification_status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Unresolved assumptions" subtitle={`${openAssumptions.length} open`}>
          {openAssumptions.length === 0 ? (
            <p className="text-xs text-muted">No open assumptions recorded. If that seems too good, it usually means none have been written down.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
              {openAssumptions.slice(0, 8).map((a) => (
                <li key={String(a.id)}>
                  <div className="flex items-start gap-1.5">
                    <Badge tone={String(a.criticality) === "high" ? "critical" : String(a.criticality) === "low" ? "neutral" : "warning"}>
                      {String(a.criticality)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 leading-snug">{String(a.text)}</p>
                </li>
              ))}
            </ul>
          )}
          <Link href="/assumptions" className="gf-btn mt-3 w-full">
            Review assumptions
          </Link>
        </Card>

        <Card title="Upcoming milestones">
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted">No upcoming milestones. Add your course deadlines in Settings so the ranking can account for them.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {upcoming.map((m) => {
                const due = m.due_date ? new Date(String(m.due_date)) : null;
                const days = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null;
                return (
                  <li key={String(m.id)} className="flex items-start justify-between gap-2">
                    <span>
                      <span className="font-medium">{String(m.title)}</span>
                      <span className="block text-muted">{m.due_date ? String(m.due_date) : "no date"}</span>
                    </span>
                    {days !== null && (
                      <Badge tone={days < 0 ? "critical" : days < 7 ? "warning" : "neutral"}>{days < 0 ? `${-days}d late` : `${days}d`}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Grid>

      <Grid cols={3}>
        <Card title="Open engineering questions" subtitle="Notebook entries tagged as questions">
          {openQuestions.length === 0 ? (
            <p className="text-xs text-muted">
              None recorded. Log questions in the <Link href="/notebook" className="underline">notebook</Link> as they come up — they are the raw material of a good discussion section.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {openQuestions.map((n) => (
                <li key={String(n.id)}>
                  <Link href="/notebook" className="font-medium hover:underline">
                    {String(n.title)}
                  </Link>
                  <span className="block text-muted">{String(n.created_at).slice(0, 10)} · {String(n.subsystem ?? "general")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent calculations" subtitle={`${snap.calculations.length} immutable snapshots stored`}>
          {snap.calculations.length === 0 ? (
            <p className="text-xs text-muted">
              None saved yet. Every module has a &ldquo;save this run&rdquo; button; saved runs are immutable, so a result you quoted last month stays reproducible.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {snap.calculations.slice(0, 8).map((c) => (
                <li key={String(c.id)} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{String(c.title)}</span>
                    <span className="block font-mono text-[10px] text-muted">{String(c.calc_id)}</span>
                  </span>
                  <span className="shrink-0 text-muted">{String(c.created_at).slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent test results" subtitle={`${snap.testRuns.length} run(s) recorded`}>
          {snap.testRuns.length === 0 ? (
            <p className="text-xs text-muted">
              No measurements yet, so nothing in this project has been validated experimentally. Even a bucket displacement test changes that.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {snap.testRuns.slice(0, 8).map((r) => {
                const test = snap.tests.find((t) => t.id === r.test_id);
                return (
                  <li key={String(r.id)} className="flex items-start justify-between gap-2">
                    <span>
                      <span className="font-medium">{test ? String(test.key) : "?"} — {String(r.run_label)}</span>
                      <span className="block text-muted">{String(r.performed_on ?? r.created_at).slice(0, 10)}</span>
                    </span>
                    <Badge tone={String(r.pass_fail) === "pass" ? "good" : String(r.pass_fail) === "fail" ? "critical" : "neutral"}>
                      {String(r.pass_fail ?? "unjudged")}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Grid>

      <Card title="Completion checklist" subtitle="Weighted areas that make up the overall completion figure">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {snap.completion.sections.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded border p-2 text-xs">
              <span aria-hidden className={s.done ? "text-[#0ca30c]" : "text-muted"}>
                {s.done ? "✓" : "○"}
              </span>
              <span>
                <span className={s.done ? "font-medium" : "font-medium text-muted"}>{s.label}</span>
                <span className="block text-[11px] text-muted">{s.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Water properties in use" subtitle="Shared by every module on this project">
        <div className="space-y-2 text-xs">
          <p>
            <strong>{formatQty({ value: snap.water.densitySI, unit: "kg/m^3" }, 6)}</strong> — {snap.water.source}
          </p>
          <WarningList warnings={snap.water.warnings} title="Correlation notes" />
          <p className="text-muted">
            Change temperature, salinity, or override the density entirely in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            . Buoyancy is a small difference between two large numbers, so density matters more than it looks.
          </p>
        </div>
      </Card>
    </div>
  );
}
