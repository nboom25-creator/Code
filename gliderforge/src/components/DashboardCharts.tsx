"use client";

import React from "react";
import { BarPlot } from "./Charts";
import { Tabs } from "./ui";

/**
 * Which components dominate mass and which dominate displacement.
 *
 * Two separate charts rather than one with two scales: mass in grams and
 * volume in cm³ are different measures, and putting them on one axis pair
 * would be a dual-axis chart.
 */
export function MassShareChart({
  contributions,
}: {
  contributions: { name: string; massG: number; volumeCm3: number }[];
}) {
  const [tab, setTab] = React.useState("mass");

  const massData = contributions
    .filter((c) => c.massG > 0)
    .sort((a, b) => b.massG - a.massG)
    .slice(0, 12)
    .map((c) => ({ name: c.name.length > 26 ? `${c.name.slice(0, 25)}…` : c.name, mass_g: Number(c.massG.toFixed(2)) }));

  const volData = contributions
    .filter((c) => c.volumeCm3 > 0)
    .sort((a, b) => b.volumeCm3 - a.volumeCm3)
    .slice(0, 12)
    .map((c) => ({ name: c.name.length > 26 ? `${c.name.slice(0, 25)}…` : c.name, volume_cm3: Number(c.volumeCm3.toFixed(1)) }));

  return (
    <div className="gf-panel p-3">
      <Tabs
        tabs={[
          { id: "mass", label: "Mass contribution" },
          { id: "volume", label: "Displacement contribution" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "mass" ? (
        <BarPlot
          title="Mass by component"
          subtitle="Largest 12, heaviest first"
          data={massData}
          categoryKey="name"
          valueKey="mass_g"
          valueLabel="Mass (g)"
          filename="mass-contribution"
          note="Components with no mass entered are absent from this chart entirely — check the mass budget page for the list of missing values."
          labelFormatter={(v) => `${v.toFixed(0)} g`}
        />
      ) : (
        <BarPlot
          title="Displaced volume by component"
          subtitle="Water-exposed components only, largest 12"
          data={volData}
          categoryKey="name"
          valueKey="volume_cm3"
          valueLabel="Displaced volume (cm³)"
          filename="displacement-contribution"
          note="Components inside a sealed hull contribute no displacement by design — the hull envelope already accounts for their volume."
          labelFormatter={(v) => `${v.toFixed(0)} cm³`}
        />
      )}
    </div>
  );
}
