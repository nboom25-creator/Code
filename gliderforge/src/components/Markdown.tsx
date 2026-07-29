"use client";

import React from "react";

/**
 * Minimal Markdown renderer for reports and assistant answers.
 *
 * Deliberately small and dependency-free, and — importantly — it never injects
 * HTML. Every node is produced as React elements, so a report containing
 * user-entered text (component names, notebook bodies, requirement rationale)
 * cannot introduce markup. Supports the subset the report generator emits:
 * headings, paragraphs, lists, tables, code fences, block quotes, rules, bold,
 * italic, inline code and links.
 */

type Inline = React.ReactNode;

function renderInline(text: string, keyPrefix: string): Inline[] {
  const out: Inline[] = [];
  // Order matters: code first so its contents are not re-processed.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (linkMatch) {
        const href = linkMatch[2];
        // Only allow relative and http(s) links; anything else renders as text.
        const safe = /^(https?:\/\/|\/|#)/.test(href);
        out.push(
          safe ? (
            <a key={key} href={href} rel="noreferrer noopener">
              {linkMatch[1]}
            </a>
          ) : (
            <span key={key}>{linkMatch[1]}</span>
          ),
        );
      }
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

export function Markdown({ source }: { source: string }) {
  const blocks = React.useMemo(() => {
    const lines = source.split("\n");
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    const flushParagraph = (buffer: string[]) => {
      if (buffer.length === 0) return;
      nodes.push(<p key={`p-${key++}`}>{renderInline(buffer.join(" "), `p${key}`)}</p>);
      buffer.length = 0;
    };

    const paragraph: string[] = [];

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code
      if (line.trimStart().startsWith("```")) {
        flushParagraph(paragraph);
        const body: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
          body.push(lines[i]);
          i++;
        }
        i++;
        nodes.push(
          <pre key={`code-${key++}`}>
            <code>{body.join("\n")}</code>
          </pre>,
        );
        continue;
      }

      // Table
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushParagraph(paragraph);
        const header = splitRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        nodes.push(
          <div key={`table-${key++}`} className="gf-scroll-x">
            <table>
              <thead>
                <tr>
                  {header.map((h, hi) => (
                    <th key={hi}>{renderInline(h, `th${hi}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci}>{renderInline(c, `td${ri}-${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Headings
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph(paragraph);
        const level = heading[1].length;
        const content = renderInline(heading[2], `h${key}`);
        const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[level - 1];
        nodes.push(<Tag key={`h-${key++}`}>{content}</Tag>);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flushParagraph(paragraph);
        nodes.push(<hr key={`hr-${key++}`} />);
        i++;
        continue;
      }

      // Block quote
      if (/^\s*>\s?/.test(line)) {
        flushParagraph(paragraph);
        const body: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          body.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        nodes.push(<blockquote key={`bq-${key++}`}>{renderInline(body.join(" "), `bq${key}`)}</blockquote>);
        continue;
      }

      // Lists
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        flushParagraph(paragraph);
        const ordered = /^\s*\d+\./.test(line);
        const items: string[] = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
          i++;
          // Continuation lines indented under the item.
          while (i < lines.length && /^\s{3,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i++;
          }
        }
        const List = ordered ? "ol" : "ul";
        nodes.push(
          <List key={`list-${key++}`}>
            {items.map((it, ii) => (
              <li key={ii}>{renderInline(it, `li${ii}`)}</li>
            ))}
          </List>,
        );
        continue;
      }

      if (line.trim() === "") {
        flushParagraph(paragraph);
        i++;
        continue;
      }

      paragraph.push(line.trim());
      i++;
    }
    flushParagraph(paragraph);
    return nodes;
  }, [source]);

  return <>{blocks}</>;
}
