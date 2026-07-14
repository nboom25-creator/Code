"use client";

import { useEffect, useState } from "react";
import type { Controls } from "@/lib/prompts";
import { getPrefs, setPrefs } from "@/lib/storage";

const DEFAULTS: Controls = {
  level: "intermediate",
  detail: "detailed",
  units: "SI",
  rigor: "standard",
  includeDerivations: true,
};

/** Hook that persists tutoring controls to prefs (guest mode). */
export function useControls(): [Controls, (patch: Partial<Controls>) => void, boolean] {
  const [controls, setControls] = useState<Controls>(DEFAULTS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const p = getPrefs();
    setControls({
      level: p.level,
      detail: p.detail,
      units: p.units,
      rigor: p.rigor,
      includeDerivations: p.includeDerivations,
    });
    setReady(true);
  }, []);
  function update(patch: Partial<Controls>) {
    setControls((c) => {
      const next = { ...c, ...patch };
      setPrefs(next);
      return next;
    });
  }
  return [controls, update, ready];
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="label">{label}</span>
      <select
        className="input !py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ControlsBar({
  controls,
  onChange,
  showSolutionMode = false,
}: {
  controls: Controls;
  onChange: (patch: Partial<Controls>) => void;
  showSolutionMode?: boolean;
}) {
  return (
    <div className="card grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select
        label="Level"
        value={controls.level}
        onChange={(v) => onChange({ level: v })}
        options={[
          { value: "beginner", label: "Beginner" },
          { value: "intermediate", label: "Intermediate" },
          { value: "advanced", label: "Advanced" },
        ]}
      />
      <Select
        label="Detail"
        value={controls.detail}
        onChange={(v) => onChange({ detail: v })}
        options={[
          { value: "concise", label: "Concise" },
          { value: "detailed", label: "Detailed" },
        ]}
      />
      <Select
        label="Units"
        value={controls.units}
        onChange={(v) => onChange({ units: v })}
        options={[
          { value: "SI", label: "SI" },
          { value: "USCS", label: "U.S. customary" },
        ]}
      />
      <Select
        label="Rigor"
        value={controls.rigor}
        onChange={(v) => onChange({ rigor: v })}
        options={[
          { value: "low", label: "Low" },
          { value: "standard", label: "Standard" },
          { value: "high", label: "High" },
        ]}
      />
      <label className="flex flex-col text-xs">
        <span className="label">Derivations</span>
        <button
          type="button"
          className="input !py-1.5 text-left"
          onClick={() => onChange({ includeDerivations: !controls.includeDerivations })}
        >
          {controls.includeDerivations ? "Included" : "Skipped"}
        </button>
      </label>
      {showSolutionMode && (
        <Select
          label="Solution"
          value={controls.solutionMode ?? "full"}
          onChange={(v) => onChange({ solutionMode: v })}
          options={[
            { value: "full", label: "Full solution" },
            { value: "guided", label: "Guided" },
            { value: "hints", label: "Hints only" },
          ]}
        />
      )}
    </div>
  );
}
