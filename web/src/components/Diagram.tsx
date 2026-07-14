"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Diagram as DiagramType } from "@/lib/schemas";

/**
 * Renders a deterministic diagram: Mermaid source or an inline SVG string. No
 * AI raster artwork is ever used for technical figures. Supports enlarge and
 * download of the rendered SVG.
 */
export function Diagram({ diagram }: { diagram: DiagramType }) {
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [zoom, setZoom] = useState(false);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!diagram || diagram.type === "none") return;
      if (diagram.type === "svg") {
        setSvg(diagram.content);
        return;
      }
      if (diagram.type === "mermaid") {
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
          const { svg: out } = await mermaid.render(`m${id}`, diagram.content);
          if (!cancelled) setSvg(out);
        } catch (e) {
          if (!cancelled) setErr(e instanceof Error ? e.message : "Diagram failed to render.");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [diagram, id]);

  if (!diagram || diagram.type === "none") return null;

  if (diagram.type === "description") {
    return (
      <div className="card">
        {diagram.title && <div className="section-title mb-1">{diagram.title}</div>}
        <p className="text-sm text-slate-600 dark:text-slate-300">{diagram.content}</p>
      </div>
    );
  }

  function download() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(diagram.title || "diagram").replace(/\s+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <div className="section-title">{diagram.title || "Diagram"}</div>
          <div className="flex gap-1">
            <button className="chip" onClick={() => setZoom(true)} disabled={!svg}>
              Enlarge
            </button>
            <button className="chip" onClick={download} disabled={!svg}>
              Download SVG
            </button>
          </div>
        </div>
        {err ? (
          <p className="text-xs text-amber-600">Could not render diagram: {err}</p>
        ) : (
          <div
            ref={ref}
            className="overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        {diagram.caption && (
          <p className="mt-2 text-xs text-slate-500">{diagram.caption}</p>
        )}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
          onClick={() => setZoom(false)}
        >
          <div
            className="max-h-[90vh] max-w-[95vw] overflow-auto rounded-lg bg-white p-6 dark:bg-slate-900 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </>
  );
}
