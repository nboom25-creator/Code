"use client";

import { useMemo } from "react";
import katex from "katex";

/**
 * Render a raw LaTeX string (WITHOUT $ delimiters) — used for equation fields
 * that the schema stores delimiter-free.
 */
export function Katex({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex || "", {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return `<code>${tex}</code>`;
    }
  }, [tex, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
