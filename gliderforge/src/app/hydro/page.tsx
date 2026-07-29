import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { dragBuildup, glideEquilibrium, liftCurveSlope } from "@/lib/calc/hydro";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { HydroWorkspace } from "@/components/pages/HydroWorkspace";

export const dynamic = "force-dynamic";

export default async function HydroPage() {
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

  const h = snap.settings.hydro;
  const v = snap.settings.vehicle;
  const rho = snap.water.densitySI;
  const authority = snap.syringe.values.buoyancyForceChange.value / 2;

  // Drag versus speed, using the buildup at each speed.
  const speeds = Array.from({ length: 21 }, (_, i) => 0.05 + i * 0.035);
  const dragVsSpeed = speeds.map((V) => {
    const d = dragBuildup({
      velocitySI: V,
      densitySI: rho,
      temperatureC: snap.settings.environment.temperatureC,
      hullLengthSI: v.hullLengthSI,
      hullDiameterSI: v.hullDiameterSI,
      hullWettedAreaSI: v.hullWettedAreaSI,
      wingAreaSI: v.wingAreaSI,
      wingAspectRatio: v.wingAspectRatio,
      wingThicknessRatio: v.wingThicknessRatio,
      oswaldEfficiency: v.oswaldEfficiency,
      tailAreaSI: v.tailAreaSI,
      liftCoefficient: h.liftCoefficient,
      appendageDragAreaSI: v.appendageDragAreaSI,
      calibrationFactor: h.calibrationFactor,
    });
    const q = 0.5 * rho * V * V;
    return {
      speed_m_s: Number(V.toFixed(3)),
      total_drag_N: Number(d.values.totalDrag.value.toFixed(5)),
      hull_drag_N: Number(d.values.hullDrag.value.toFixed(5)),
      wing_drag_N: Number(d.values.wingProfileDrag.value.toFixed(5)),
      induced_drag_N: Number(d.values.inducedDrag.value.toFixed(5)),
      lift_N: Number((q * h.referenceAreaSI * h.liftCoefficient).toFixed(5)),
      reynolds: Number(d.values.reynolds.value.toPrecision(5)),
    };
  });

  // Glide ratio versus angle of attack, using a lift-slope model with the
  // user's drag polar. The polar is stated explicitly so it can be challenged.
  const slope = liftCurveSlope(v.wingAspectRatio || 4);
  const cd0 = Math.max(1e-4, h.dragCoefficient - (h.liftCoefficient ** 2) / (Math.PI * (v.wingAspectRatio || 4) * v.oswaldEfficiency));
  const alphaSweep = Array.from({ length: 25 }, (_, i) => i * 0.75).map((deg) => {
    const CL = slope.perRad * (deg * Math.PI) / 180;
    const CD = cd0 + (CL * CL) / (Math.PI * (v.wingAspectRatio || 4) * v.oswaldEfficiency);
    return {
      alpha_deg: Number(deg.toFixed(2)),
      lift_coefficient: Number(CL.toFixed(4)),
      drag_coefficient: Number(CD.toFixed(5)),
      glide_ratio: Number((CD > 0 ? CL / CD : 0).toFixed(3)),
    };
  });

  // Vertical speed versus net buoyancy.
  const buoySweep = Array.from({ length: 21 }, (_, i) => (i + 1) * (Math.max(authority, 0.05) / 10)).map((F) => {
    const g = glideEquilibrium({
      netBuoyancyForceSI: F,
      densitySI: rho,
      referenceAreaSI: h.referenceAreaSI,
      liftCoefficient: h.liftCoefficient,
      dragCoefficient: h.dragCoefficient,
      descending: true,
      coefficientSource: h.coefficientSource,
    });
    return {
      net_buoyancy_N: Number(F.toFixed(4)),
      speed_m_s: Number(g.values.speed.value.toFixed(4)),
      vertical_speed_m_s: Number(Math.abs(g.values.verticalSpeed.value).toFixed(4)),
      horizontal_speed_m_s: Number(g.values.horizontalSpeed.value.toFixed(4)),
    };
  });

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="Hydrodynamics and glide performance"
        subtitle="A component drag buildup is a preliminary estimate. For a small student-built vehicle, 30–50% error against measurement is normal, so treat everything here as a scoping tool until a tow or glide test calibrates it."
      />
      <HydroWorkspace
        projectId={snap.project.id}
        drag={{
          values: snap.drag.values,
          steps: snap.drag.steps,
          assumptions: snap.drag.assumptions,
          warnings: snap.drag.warnings,
          limitations: snap.drag.limitations ?? [],
          confidence: snap.drag.confidence,
          inputs: snap.drag.inputs,
        }}
        dive={{ values: snap.diveGlide.values, warnings: snap.diveGlide.warnings, steps: snap.diveGlide.steps, assumptions: snap.diveGlide.assumptions, limitations: snap.diveGlide.limitations ?? [] }}
        climb={{ values: snap.climbGlide.values }}
        settings={{
          modelLevel: h.modelLevel,
          coefficientSource: h.coefficientSource,
          coefficientNote: h.coefficientNote,
          CL: h.liftCoefficient,
          CD: h.dragCoefficient,
          referenceAreaSI: h.referenceAreaSI,
          referenceAreaBasis: h.referenceAreaBasis,
          calibrationFactor: h.calibrationFactor,
          aspectRatio: v.wingAspectRatio,
          oswald: v.oswaldEfficiency,
          cd0,
          liftSlopePerRad: slope.perRad,
          liftSlopeEquation: slope.equation,
          liftSlopeNote: slope.note,
        }}
        charts={{ dragVsSpeed, alphaSweep, buoySweep }}
        authorityN={authority}
      />
    </div>
  );
}
