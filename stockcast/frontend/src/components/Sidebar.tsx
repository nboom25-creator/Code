"use client";
import React from "react";
import { Card } from "./ui";

export function ListCard({
  title,
  items,
  onPick,
  onRemove,
  empty,
}: {
  title: string;
  items: string[];
  onPick: (t: string) => void;
  onRemove?: (t: string) => void;
  empty: string;
}) {
  return (
    <Card title={title} className="p-4">
      {items.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((t) => (
            <li key={t} className="flex items-center gap-1 rounded-lg border border-border bg-surface/60 pl-2.5">
              <button onClick={() => onPick(t)} className="py-1 font-mono text-sm font-semibold text-fg hover:text-brand">
                {t}
              </button>
              {onRemove && (
                <button
                  onClick={() => onRemove(t)}
                  aria-label={`Remove ${t}`}
                  className="px-1.5 text-muted hover:text-down"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
