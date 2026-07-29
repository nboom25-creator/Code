import Link from "next/link";
import { getActiveSnapshot } from "@/lib/project/session";
import { PageHeader, EmptyState, SampleBanner } from "@/components/ui";
import { ViewerClient } from "@/components/pages/ViewerClient";
import { jsonField } from "@/components/serverJson";

export const dynamic = "force-dynamic";

export default async function ViewerPage() {
  const snap = await getActiveSnapshot();
  if (!snap) {
    return <EmptyState title="No project selected" body="Create or open a project first." action={<Link href="/projects" className="gf-btn gf-btn-primary">Go to projects</Link>} />;
  }

  const components = snap.components.map((c) => {
    const geo = snap.geometryFiles.find((g) => g.component_id === c.id && ["stl", "obj"].includes(String(g.format)));
    return {
      id: String(c.id),
      name: String(c.name),
      category: String(c.category ?? "other"),
      material: c.material_name ? String(c.material_name) : null,
      displacementMode: String(c.displacement_mode ?? "internal"),
      confidence: String(c.confidence ?? "medium"),
      color: c.color ? String(c.color) : null,
      position: [Number(c.pos_x ?? 0), Number(c.pos_y ?? 0), Number(c.pos_z ?? 0)] as [number, number, number],
      size: [
        c.bbox_x === null || c.bbox_x === undefined ? null : Number(c.bbox_x),
        c.bbox_y === null || c.bbox_y === undefined ? null : Number(c.bbox_y),
        c.bbox_z === null || c.bbox_z === undefined ? null : Number(c.bbox_z),
      ] as [number | null, number | null, number | null],
      massSI: Number(c.measured_mass_kg ?? c.estimated_mass_kg ?? 0) * Number(c.quantity ?? 1),
      volumeSI: Number(c.displaced_volume_m3 ?? c.user_volume_m3 ?? c.cad_volume_m3 ?? 0),
      hasMass: c.measured_mass_kg !== null || c.estimated_mass_kg !== null,
      verified: c.measured_mass_kg !== null && c.measured_mass_kg !== undefined,
      includeInBudget: Number(c.include_in_budget ?? 1) === 1,
      meshUrl: geo ? `/api/files/${encodeURIComponent(String(geo.stored_name))}` : null,
      meshUnit: geo ? String(geo.unit ?? "mm") : null,
      meshFormat: geo ? String(geo.format) : null,
      meshWatertight: geo ? Boolean(jsonField<{ analysis?: { isWatertight?: boolean } }>(geo.parse_json, {}).analysis?.isWatertight) : false,
    };
  });

  return (
    <div className="space-y-4">
      {snap.project.is_sample === 1 && <SampleBanner />}
      <PageHeader
        title="CAD viewer"
        subtitle="The vehicle arrangement in the project coordinate frame, with the centre of gravity and centre of buoyancy marked. Components with an attached STL or OBJ render as their real mesh; the rest render as their bounding box."
      />
      <ViewerClient
        components={components}
        cg={snap.massProps.cg}
        cb={snap.massProps.cb}
        hullLength={snap.settings.vehicle.hullLengthSI}
        hullDiameter={snap.settings.vehicle.hullDiameterSI}
      />
    </div>
  );
}
