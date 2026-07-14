"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

/**
 * Renders tutor prose that mixes Markdown with LaTeX ($inline$ and $$block$$).
 * KaTeX handles the math; remark-gfm handles tables/lists. All content comes
 * from validated AI output (already schema-checked upstream).
 */
export function MarkdownMath({ children }: { children: string }) {
  return (
    <div className="prose-tutor text-sm text-slate-700 dark:text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
