"use client";

export function Spinner({ label = "Generating…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, code }: { message: string; code?: string }) {
  const isConfig = code === "missing_api_key";
  return (
    <div className="card border-red-300 bg-red-50 text-sm dark:border-red-800 dark:bg-red-950/40">
      <div className="font-medium text-red-700 dark:text-red-300">
        {isConfig ? "Configuration needed" : "Something went wrong"}
      </div>
      <p className="mt-1 text-slate-600 dark:text-slate-300">{message}</p>
      {isConfig && (
        <p className="mt-2 text-xs text-slate-500">
          Add the key to <code>web/.env.local</code> and restart the dev server. See the README.
        </p>
      )}
    </div>
  );
}

export function SaveActions({
  onSave,
  exportData,
  filename,
}: {
  onSave: () => void;
  exportData: unknown;
  filename: string;
}) {
  function exportJson() {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-ghost !py-1.5" onClick={onSave}>
        💾 Save
      </button>
      <button className="btn-ghost !py-1.5" onClick={exportJson}>
        ⬇ Export JSON
      </button>
      <button className="btn-ghost !py-1.5" onClick={() => window.print()}>
        🖨 Print
      </button>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card grid place-items-center py-12 text-center">
      <div className="text-3xl">📐</div>
      <div className="mt-2 font-medium">{title}</div>
      <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p>
    </div>
  );
}
