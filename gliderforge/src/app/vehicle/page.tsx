import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { formatQty } from "@/lib/units";
import { PageHeader, EmptyState, SampleBanner, Card, Grid, Stat, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VehiclePage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }
  const v = snap.settings.vehicle;
  const q = (x: number | undefined, unit: string, d = 4) => (x === undefined || !Number.isFinite(x) ? "—" : formatQty({ value: x, unit }, d));
  const overLength = v.maxLengthSI !== undefined && v.hullLengthSI > v.maxLengthSI;
  const overDiameter = v.maxDiameterSI !== undefined && v.hullDiameterSI > v.maxDiameterSI;
  const overMass = v.maxMassSI !== undefined && snap.massProps.values.totalMass.value > v.maxMassSI;

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Vehicle"
        subtitle="The shared vehicle definition: envelope, lifting surfaces and how they compare with the limits you set. Every module reads these numbers."
        actions={<Link href="/settings" className="gf-btn gf-btn-primary">Edit vehicle settings</Link>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hull length" value={q(v.hullLengthSI * 1000, "mm", 4)} hint={v.maxLengthSI !== undefined ? `Limit ${(v.maxLengthSI * 1000).toFixed(0)} mm` : "No limit set"} tone={overLength ? "critical" : undefined} />
        <Stat label="Hull diameter" value={q(v.hullDiameterSI * 1000, "mm", 4)} hint={v.maxDiameterSI !== undefined ? `Limit ${(v.maxDiameterSI * 1000).toFixed(0)} mm` : "No limit set"} tone={overDiameter ? "critical" : undefined} />
        <Stat label="Fineness ratio L/D" value={(v.hullLengthSI / v.hullDiameterSI).toFixed(2)} hint="Slender bodies (above about 5) have less pressure drag" />
        <Stat label="Vehicle mass" value={q(snap.massProps.values.totalMass.value, "kg")} hint={v.maxMassSI !== undefined ? `Limit ${v.maxMassSI} kg` : "No limit set"} tone={overMass ? "critical" : undefined} />
        <Stat label="Wing planform area" value={q(v.wingAreaSI * 1e4, "cm^2")} hint="Both panels combined" />
        <Stat label="Wing aspect ratio" value={v.wingAspectRatio.toFixed(2)} hint={v.wingAspectRatio < 2 ? "Very low — lifting-line theory loses accuracy" : "span squared over area"} tone={v.wingAspectRatio < 2 ? "warning" : undefined} />
        <Stat label="Tail / fin area" value={q(v.tailAreaSI * 1e4, "cm^2")} />
        <Stat label="Wetted area (hull)" value={q(snap.drag.values.hullWettedArea.value * 1e4, "cm^2")} provenance={v.hullWettedAreaSI === undefined ? "assumed" : "user"} hint={v.hullWettedAreaSI === undefined ? "Estimated as a capsule" : "From CAD"} />
      </div>

      <Grid cols={2}>
        <Card title="Envelope compliance">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Constraint</th>
                <th>Limit</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Overall length</td>
                <td>{v.maxLengthSI !== undefined ? `${(v.maxLengthSI * 1000).toFixed(0)} mm` : "not set"}</td>
                <td>{(v.hullLengthSI * 1000).toFixed(0)} mm</td>
                <td>{v.maxLengthSI === undefined ? <Badge tone="neutral">no limit</Badge> : overLength ? <Badge tone="critical">over</Badge> : <Badge tone="good">within</Badge>}</td>
              </tr>
              <tr>
                <td>Maximum diameter</td>
                <td>{v.maxDiameterSI !== undefined ? `${(v.maxDiameterSI * 1000).toFixed(0)} mm` : "not set"}</td>
                <td>{(v.hullDiameterSI * 1000).toFixed(0)} mm</td>
                <td>{v.maxDiameterSI === undefined ? <Badge tone="neutral">no limit</Badge> : overDiameter ? <Badge tone="critical">over</Badge> : <Badge tone="good">within</Badge>}</td>
              </tr>
              <tr>
                <td>Dry mass</td>
                <td>{v.maxMassSI !== undefined ? `${v.maxMassSI} kg` : "not set"}</td>
                <td>{snap.massProps.values.totalMass.value.toFixed(3)} kg</td>
                <td>{v.maxMassSI === undefined ? <Badge tone="neutral">no limit</Badge> : overMass ? <Badge tone="critical">over</Badge> : <Badge tone="good">within</Badge>}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Limits come from the vehicle settings. Record the corresponding requirements on the{" "}
            <Link href="/requirements" className="underline">Requirements page</Link> so they appear in the traceability matrix.
          </p>
        </Card>

        <Card title="Where these numbers are used">
          <ul className="ml-4 list-disc space-y-1.5 text-xs leading-relaxed text-muted">
            <li><strong className="text-ink">Hull length</strong> is the characteristic length for the Reynolds number and therefore for the skin-friction coefficient.</li>
            <li><strong className="text-ink">Hull diameter</strong> sets the Hoerner form factor through d/L, and the wetted-area estimate.</li>
            <li><strong className="text-ink">Wing area and aspect ratio</strong> set the induced drag and the lift-curve slope.</li>
            <li><strong className="text-ink">Appendage drag allowance</strong> is the single most commonly omitted term, and the usual reason a measured glide is slower than predicted.</li>
            <li><strong className="text-ink">Component displaced volumes</strong>, not these dimensions, drive the buoyancy budget — the geometry here is for hydrodynamics.</li>
          </ul>
        </Card>
      </Grid>

      <Card title="Subsystem inventory">
        <div className="gf-scroll-x">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Components</th>
                <th>Total mass</th>
                <th>Share of vehicle mass</th>
                <th>Displaced volume</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(
                snap.massProps.contributions.reduce<Record<string, { n: number; mass: number; volume: number }>>((acc, c) => {
                  const e = acc[c.category] ?? { n: 0, mass: 0, volume: 0 };
                  e.n += 1;
                  e.mass += c.massSI;
                  e.volume += c.volumeSI;
                  acc[c.category] = e;
                  return acc;
                }, {}),
              )
                .sort((a, b) => b[1].mass - a[1].mass)
                .map(([cat, e]) => (
                  <tr key={cat}>
                    <td className="font-medium">{cat}</td>
                    <td>{e.n}</td>
                    <td>{(e.mass * 1000).toFixed(1)} g</td>
                    <td>{snap.massProps.values.totalMass.value > 0 ? `${((e.mass / snap.massProps.values.totalMass.value) * 100).toFixed(1)} %` : "—"}</td>
                    <td>{(e.volume * 1e6).toFixed(1)} cm³</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
