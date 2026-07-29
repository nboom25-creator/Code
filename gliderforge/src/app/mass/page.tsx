import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { formatQty } from "@/lib/units";
import { PageHeader, EmptyState, SampleBanner, Card, Grid, Stat, WarningList, AssumptionList, StepList, Limitations, Badge } from "@/components/ui";
import { MassShareChart } from "@/components/DashboardCharts";
import { SaveCalculationButton } from "@/components/pages/SaveCalculationButton";
import { UncertaintyPanel } from "@/components/pages/UncertaintyPanel";

export const dynamic = "force-dynamic";

export default async function MassPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return (
      <EmptyState
        title="No project selected"
        body="Create or open a project first."
        action={
          <Link href="/projects" className="gf-btn gf-btn-primary">
            Go to projects
          </Link>
        }
      />
    );
  }

  const q = (v: number | undefined, unit: string, d = 4) => (v === undefined || !Number.isFinite(v) ? "—" : formatQty({ value: v, unit }, d));
  const b = snap.buoyancy.values;
  const mp = snap.massProps;
  const net = b.netBuoyantForce.value;
  const maxMass = snap.settings.vehicle.maxMassSI;

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Mass, volume and buoyancy budget"
        subtitle="Net buoyancy is a small difference between two large numbers. A 1% error in either the mass or the displacement can change its sign, which is why every missing value is flagged as an error rather than quietly treated as zero."
        actions={
          <>
            <SaveCalculationButton
              projectId={snap.project.id}
              calcId="buoyancy.net"
              title="Static buoyancy"
              inputs={snap.buoyancy.inputs}
              results={snap.buoyancy.values}
              warnings={snap.buoyancy.warnings}
              assumptions={snap.buoyancy.assumptions}
              steps={snap.buoyancy.steps}
              confidence={snap.buoyancy.confidence}
            />
            <a className="gf-btn" href={`/api/projects/${snap.project.id}/reports/buoyancy-budget?download=1`}>
              Export report
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total vehicle mass"
          value={q(mp.values.totalMass.value, "kg")}
          hint={maxMass !== undefined ? `Limit ${q(maxMass, "kg")} — ${mp.values.totalMass.value <= maxMass ? "within" : "OVER"}` : `${snap.components.length} components`}
          tone={maxMass !== undefined && mp.values.totalMass.value > maxMass ? "critical" : undefined}
        />
        <Stat label="Displaced volume" value={q(mp.values.totalDisplacedVolume.value * 1e6, "cm^3")} hint={`Displaces ${q(b.displacedMass.value, "kg")} of water`} />
        <Stat label="Buoyant force" value={q(b.buoyantForce.value, "N")} hint="F_B = ρ g V" />
        <Stat label="Weight" value={q(b.weight.value, "N")} hint="W = m g" />
        <Stat
          label="Net buoyant force"
          value={q(net, "N")}
          hint={net > 0 ? "Positive — the vehicle rises" : net < 0 ? "Negative — the vehicle sinks" : "Neutral"}
          tone={!Number.isFinite(net) ? "critical" : Math.abs(net) < 0.05 ? "good" : undefined}
        />
        <Stat
          label="Ballast to neutral"
          value={Number.isFinite(snap.neutral.massChangeSI) ? `${Math.abs(snap.neutral.massChangeSI * 1000).toFixed(1)}` : "—"}
          unit={`g to ${snap.neutral.massChangeSI >= 0 ? "add" : "remove"}`}
          hint={`or change displacement by ${Math.abs(snap.neutral.volumeChangeSI * 1e6).toFixed(1)} cm³ — these are alternatives, not both`}
        />
        <Stat label="Average vehicle density" value={q(b.averageDensity.value, "kg/m^3")} hint={`Water is ${q(snap.water.densitySI, "kg/m^3", 6)}`} />
        <Stat label="Buoyancy margin" value={q(b.buoyancyMarginPercent.value, "%", 3)} hint="Net force as a fraction of weight" />
      </div>

      {(mp.missingMass.length > 0 || mp.missingVolume.length > 0) && (
        <Card title="Missing data is biasing this budget">
          <div className="space-y-2 text-xs">
            {mp.missingMass.length > 0 && (
              <p>
                <Badge tone="critical">no mass</Badge>{" "}
                <span className="text-muted">
                  {mp.missingMass.join(", ")} — counted as zero, so the total mass and the CG are both too low.
                </span>
              </p>
            )}
            {mp.missingVolume.length > 0 && (
              <p>
                <Badge tone="critical">no displaced volume</Badge>{" "}
                <span className="text-muted">
                  {mp.missingVolume.join(", ")} — counted as zero, so displacement and the CB are both understated.
                </span>
              </p>
            )}
            <Link href="/components" className="gf-btn mt-2">
              Fix on the Components page
            </Link>
          </div>
        </Card>
      )}

      <Grid cols={2}>
        <MassShareChart
          contributions={mp.contributions.map((c) => ({ name: c.name, massG: c.massSI * 1000, volumeCm3: c.volumeSI * 1e6 }))}
        />
        <Card title="Component budget table" dense>
          <div className="gf-scroll-x max-h-[420px] overflow-y-auto">
            <table className="gf-table">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <th>Component</th>
                  <th>Mass (g)</th>
                  <th>Share</th>
                  <th>Displacement (cm³)</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {mp.contributions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-[10px] text-muted">{c.category}</span>
                    </td>
                    <td>{c.massKnown ? (c.massSI * 1000).toFixed(1) : <Badge tone="critical">missing</Badge>}</td>
                    <td>{(c.massFraction * 100).toFixed(1)} %</td>
                    <td>
                      {c.displacementMode === "internal" ? (
                        <span className="text-[11px] text-muted">n/a</span>
                      ) : c.volumeKnown ? (
                        (c.volumeSI * 1e6).toFixed(1)
                      ) : (
                        <Badge tone="critical">missing</Badge>
                      )}
                    </td>
                    <td className="text-[11px]">{c.displacementMode}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Total</td>
                  <td>{(mp.values.totalMass.value * 1000).toFixed(1)}</td>
                  <td>100 %</td>
                  <td>{(mp.values.totalDisplacedVolume.value * 1e6).toFixed(1)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card title="Buoyancy calculation">
          <div className="space-y-3">
            <StepList steps={snap.buoyancy.steps} defaultOpen />
            <AssumptionList assumptions={snap.buoyancy.assumptions} />
            <WarningList warnings={snap.buoyancy.warnings} />
            <Limitations items={snap.buoyancy.limitations} />
          </div>
        </Card>
        <Card title="Mass properties calculation">
          <div className="space-y-3">
            <StepList steps={snap.massProps.steps} />
            <AssumptionList assumptions={snap.massProps.assumptions} />
            <WarningList warnings={snap.massProps.warnings} />
            <Limitations items={snap.massProps.limitations} />
          </div>
        </Card>
      </Grid>

      <UncertaintyPanel
        title="How uncertain is the net buoyancy?"
        description="Net buoyancy is the difference of two nearly equal quantities, so its relative uncertainty is far larger than that of either input. Enter what you actually know about your mass and volume uncertainty and see what it does."
        inputs={[
          { name: "waterDensity", label: "Water density", value: snap.water.densitySI, unit: "kg/m^3", defaultUncertainty: 0.5 },
          { name: "volume", label: "Displaced volume", value: mp.values.totalDisplacedVolume.value, unit: "m^3", defaultUncertainty: mp.values.totalDisplacedVolume.value * 0.02 },
          { name: "mass", label: "Vehicle mass", value: mp.values.totalMass.value, unit: "kg", defaultUncertainty: 0.01 },
        ]}
        expression="netBuoyancy"
        resultUnit="N"
        gravity={snap.settings.environment.gravitySI}
      />

      <Card title="Water properties in use">
        <p className="text-xs">
          <strong>{formatQty({ value: snap.water.densitySI, unit: "kg/m^3" }, 6)}</strong>{" "}
          <span className="text-muted">— {snap.water.source}</span>
        </p>
        <WarningList warnings={snap.water.warnings} title="" />
        <p className="mt-2 text-[11px] text-muted">
          Change it in <Link href="/settings" className="underline">Settings</Link>. Going from 25 °C fresh water to 15 °C sea water changes
          the buoyant force on a 3 L vehicle by about 0.85 N — larger than many buoyancy engines can produce.
        </p>
      </Card>
    </div>
  );
}
