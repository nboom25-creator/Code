"use client";

import React from "react";
import { propagate } from "@/lib/calc/uncertainty";
import { Card, Badge } from "../ui";
import { formatQty } from "@/lib/units";

interface Input {
  name: string;
  label: string;
  value: number;
  unit: string;
  defaultUncertainty: number;
}

const EXPRESSIONS: Record<string, { f: (v: Record<string, number>, g: number) => number; equation: string }> = {
  netBuoyancy: {
    f: (v, g) => v.waterDensity * g * v.volume - v.mass * g,
    equation: "F_net = rho * g * V - m * g",
  },
  buoyancyChange: {
    f: (v, g) => v.waterDensity * g * (Math.PI / 4) * v.bore ** 2 * v.stroke,
    equation: "dF = rho * g * (pi/4) * D^2 * x",
  },
};

/**
 * First-order uncertainty propagation with user-supplied input uncertainties.
 *
 * Sensitivities are evaluated numerically, so the panel also shows which input
 * dominates the variance — usually the more useful output than the total.
 */
export function UncertaintyPanel({
  title,
  description,
  inputs,
  expression,
  resultUnit,
  gravity,
}: {
  title: string;
  description: string;
  inputs: Input[];
  expression: keyof typeof EXPRESSIONS;
  resultUnit: string;
  gravity: number;
}) {
  const [u, setU] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(inputs.map((i) => [i.name, Math.abs(i.defaultUncertainty)])),
  );

  const spec = EXPRESSIONS[expression];
  const result = React.useMemo(
    () =>
      propagate(
        (values) => spec.f(values, gravity),
        inputs.map((i) => ({ name: i.name, value: i.value, uncertainty: u[i.name] ?? 0 })),
        2,
      ),
    [inputs, u, spec, gravity],
  );

  const relative = result.value !== 0 ? Math.abs(result.uncertainty / result.value) : NaN;

  return (
    <Card title={title} subtitle={description}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Standard uncertainty of each input</h4>
          <div className="space-y-2">
            {inputs.map((i) => (
              <div key={i.name} className="flex items-center gap-2">
                <label className="flex-1 text-xs" htmlFor={`u-${i.name}`}>
                  {i.label}
                  <span className="block text-[11px] text-muted">
                    value {formatQty({ value: i.value, unit: i.unit }, 5)}
                  </span>
                </label>
                <input
                  id={`u-${i.name}`}
                  className="gf-input w-32"
                  type="text"
                  inputMode="decimal"
                  value={String(u[i.name] ?? 0)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setU((s) => ({ ...s, [i.name]: Number.isFinite(n) ? Math.abs(n) : 0 }));
                  }}
                />
                <span className="w-16 shrink-0 text-[11px] text-muted">{i.unit}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Enter one standard deviation, in the same unit as the value. For a scale, half the last digit is a reasonable starting point; for a
            CAD volume, think about how well the model matches the part you actually built.
          </p>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Result</h4>
          <pre className="gf-scroll-x rounded bg-surface p-2 font-mono text-[11px]">{spec.equation}</pre>
          <div className="gf-num mt-2 text-xl font-semibold">
            {formatQty({ value: result.value, unit: resultUnit }, 4)}
            <span className="ml-2 text-sm font-normal text-muted">
              ± {formatQty({ value: result.uncertainty, unit: resultUnit }, 2)} (1σ)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Expanded (k = 2, roughly 95%): ± {formatQty({ value: result.expanded, unit: resultUnit }, 2)}
            {Number.isFinite(relative) && (
              <>
                {" — "}
                <Badge tone={relative > 0.5 ? "critical" : relative > 0.2 ? "warning" : "good"}>
                  {(relative * 100).toFixed(0)}% relative
                </Badge>
              </>
            )}
          </p>

          <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Where the uncertainty comes from</h4>
          <table className="gf-table">
            <thead>
              <tr>
                <th>Input</th>
                <th>Sensitivity</th>
                <th>Contribution</th>
                <th>Share of variance</th>
              </tr>
            </thead>
            <tbody>
              {result.contributions.map((c) => (
                <tr key={c.name}>
                  <td>{inputs.find((i) => i.name === c.name)?.label ?? c.name}</td>
                  <td>{Number.isFinite(c.sensitivity) ? c.sensitivity.toPrecision(3) : "—"}</td>
                  <td>{Number.isFinite(c.contribution) ? c.contribution.toPrecision(3) : "—"}</td>
                  <td>{(c.share * 100).toFixed(0)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings.length > 0 && (
            <ul className="ml-4 mt-2 list-disc space-y-1 text-[11px] text-muted">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted">
            This is a first-order (linearised) propagation: it assumes the uncertainties are small relative to the values and that the inputs
            are independent. If two inputs share a common error source — the same scale, the same CAD model — the real uncertainty is larger
            than this.
          </p>
        </div>
      </div>
    </Card>
  );
}
