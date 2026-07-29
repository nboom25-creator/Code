import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { hydrostaticPressure, cylinderExternalPressure, flatEndCap, penetrationLoad, oRingGland, NOT_FEA_NOTICE } from "@/lib/calc/pressure";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { StructureWorkspace } from "@/components/pages/StructureWorkspace";

export const dynamic = "force-dynamic";

export default async function StructurePage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }

  const st = snap.settings.structure;
  const depth = snap.settings.mission.depthLimitSI;
  const rho = snap.water.densitySI;
  const g = snap.settings.environment.gravitySI;

  const hydro = hydrostaticPressure({
    depthSI: depth,
    waterDensitySI: rho,
    gravitySI: g,
    surfacePressureSI: snap.settings.environment.surfacePressureSI,
  });
  const gauge = hydro.values.gauge.value;

  const canCylinder =
    st.housingOuterDiameterSI !== undefined &&
    st.housingWallThicknessSI !== undefined &&
    st.housingLengthSI !== undefined &&
    st.youngsModulusSI !== undefined &&
    st.poissonsRatio !== undefined &&
    st.yieldStrengthSI !== undefined;

  const cylinder = canCylinder
    ? cylinderExternalPressure({
        outerDiameterSI: st.housingOuterDiameterSI!,
        wallThicknessSI: st.housingWallThicknessSI!,
        lengthSI: st.housingLengthSI!,
        externalPressureSI: gauge,
        youngsModulusSI: st.youngsModulusSI!,
        poissonsRatio: st.poissonsRatio!,
        yieldStrengthSI: st.yieldStrengthSI!,
        safetyFactor: st.safetyFactor,
        materialProvenance: st.materialProvenance,
      })
    : null;

  const endCap =
    canCylinder
      ? flatEndCap({
          radiusSI: (st.housingOuterDiameterSI! - 2 * st.housingWallThicknessSI!) / 2,
          thicknessSI: st.housingWallThicknessSI! * 2,
          pressureSI: gauge,
          youngsModulusSI: st.youngsModulusSI!,
          poissonsRatio: st.poissonsRatio!,
          yieldStrengthSI: st.yieldStrengthSI!,
          edgeCondition: "simply-supported",
          safetyFactor: st.safetyFactor,
        })
      : null;

  const plunger = penetrationLoad({
    diameterSI: snap.settings.syringe.boreDiameterSI,
    externalPressureSI: gauge,
    safetyFactor: st.safetyFactor,
  });

  const gland = oRingGland({
    cordDiameterSI: 0.003,
    glandDepthSI: 0.0022,
    glandWidthSI: 0.004,
    sealType: "radial-dynamic",
    externalPressureSI: gauge,
  });

  const depthSweep = Array.from({ length: 21 }, (_, i) => i * Math.max(0.5, depth / 10)).map((d) => {
    const p = rho * g * d;
    return {
      depth_m: Number(d.toFixed(2)),
      gauge_pressure_kPa: Number((p / 1000).toFixed(2)),
      plunger_thrust_N: Number((p * (Math.PI / 4) * snap.settings.syringe.boreDiameterSI ** 2).toFixed(3)),
      hoop_stress_MPa: canCylinder
        ? Number(((p * (st.housingOuterDiameterSI! - st.housingWallThicknessSI!) / 2 / st.housingWallThicknessSI!) / 1e6).toFixed(4))
        : 0,
    };
  });

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Pressure and structural checks"
        subtitle="Closed-form preliminary checks. Not finite-element analysis, and no substitute for a proof test."
      />
      <StructureWorkspace
        projectId={snap.project.id}
        depthM={depth}
        notFeaNotice={NOT_FEA_NOTICE}
        hydro={{ values: hydro.values, steps: hydro.steps, warnings: hydro.warnings, assumptions: hydro.assumptions, inputs: hydro.inputs, confidence: hydro.confidence }}
        cylinder={cylinder ? { values: cylinder.values, steps: cylinder.steps, warnings: cylinder.warnings, assumptions: cylinder.assumptions, limitations: cylinder.limitations ?? [], inputs: cylinder.inputs, confidence: cylinder.confidence } : null}
        endCap={endCap ? { values: endCap.values, steps: endCap.steps, warnings: endCap.warnings, assumptions: endCap.assumptions, limitations: endCap.limitations ?? [] } : null}
        plunger={{ values: plunger.values, steps: plunger.steps, warnings: plunger.warnings }}
        gland={{ values: gland.values, steps: gland.steps, warnings: gland.warnings }}
        materialProvenance={st.materialProvenance}
        safetyFactor={st.safetyFactor}
        depthSweep={depthSweep}
        hasHousing={canCylinder}
      />
    </div>
  );
}
