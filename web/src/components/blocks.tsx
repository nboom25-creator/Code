"use client";

import { Katex } from "./Katex";
import type { Equation, Variable } from "@/lib/schemas";

export function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="card scroll-mt-20">
      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {children}
    </section>
  );
}

export function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-slate-400">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function EquationList({ equations }: { equations: Equation[] }) {
  if (!equations?.length) return <p className="text-sm text-slate-400">—</p>;
  return (
    <div className="space-y-3">
      {equations.map((eq, i) => (
        <div key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          {eq.name && <div className="mb-1 text-xs font-medium text-slate-500">{eq.name}</div>}
          <Katex tex={eq.latex} />
          {eq.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{eq.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function VariableTable({ variables }: { variables: Variable[] }) {
  if (!variables?.length) return <p className="text-sm text-slate-400">—</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="py-1 pr-4">Symbol</th>
            <th className="py-1 pr-4">Quantity</th>
            <th className="py-1 pr-4">SI unit</th>
            <th className="py-1">Notes</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1.5 pr-4 font-mono">
                <Katex tex={v.symbol} display={false} />
              </td>
              <td className="py-1.5 pr-4">{v.name}</td>
              <td className="py-1.5 pr-4 font-mono text-slate-500">{v.siUnit || "—"}</td>
              <td className="py-1.5 text-slate-500">{v.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
