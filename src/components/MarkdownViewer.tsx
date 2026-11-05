import { useMemo, useState, type ReactNode } from "react";
import { Copy, Check, Code, Eye, FileText } from "lucide-react";

type Frontmatter = Record<string, string>;

function parseFrontmatter(text: string): { frontmatter: Frontmatter | null; body: string } {
  if (!text.startsWith("---")) return { frontmatter: null, body: text };
  const endIdx = text.indexOf("\n---", 3);
  if (endIdx === -1) return { frontmatter: null, body: text };

  const rawFm = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 4).replace(/^\n+/, "");
  const frontmatter: Frontmatter = {};

  for (const line of rawFm.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key) frontmatter[key] = val;
    }
  }

  return { frontmatter: Object.keys(frontmatter).length ? frontmatter : null, body };
}

function renderInline(text: string): ReactNode[] {
  // Matches: **bold**, *italic*, `code`, ~~strike~~, [text](url)
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="markdown-inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return <del key={i}>{part.slice(2, -2)}</del>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const isExternal = /^https?:\/\//i.test(linkMatch[2]);
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="markdown-link"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}

export function parseMarkdownBlocks(text: string): ReactNode[] {
  const lines = text.split(/\r?\n/);
  const elements: ReactNode[] = [];
  let i = 0;

  const isSpecialStart = (l: string, nextL?: string) => {
    if (!l.trim()) return true;
    if (l.trim().startsWith("```")) return true;
    if (/^(---|___|\*\*\*)\s*$/.test(l.trim())) return true;
    if (/^(#{1,6})\s+/.test(l)) return true;
    if (l.startsWith(">")) return true;
    if (/^\s*[-*•]\s+/.test(l)) return true;
    if (/^\s*\d+\.\s+/.test(l)) return true;
    if (l.includes("|") && nextL && /^\s*\|?[-:| ]+\|?\s*$/.test(nextL)) return true;
    return false;
  };

  while (i < lines.length) {
    const startIndex = i;
    const line = lines[i];

    // Fenced Code Block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i++; // skip closing ```
      }
      const codeText = codeLines.join("\n");
      elements.push(
        <div key={`code-${elements.length}`} className="markdown-code-block">
          {lang && <div className="markdown-code-lang">{lang}</div>}
          <pre>
            <code>{codeText}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Horizontal Rule
    if (/^(---|___|\*\*\*)\s*$/.test(line.trim())) {
      elements.push(<hr key={`hr-${elements.length}`} className="markdown-hr" />);
      i++;
      continue;
    }

    // Headers
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const titleText = headingMatch[2];
      const content = renderInline(titleText);
      if (level === 1) {
        elements.push(<h1 key={`h1-${elements.length}`} className="markdown-h1">{content}</h1>);
      } else if (level === 2) {
        elements.push(<h2 key={`h2-${elements.length}`} className="markdown-h2">{content}</h2>);
      } else if (level === 3) {
        elements.push(<h3 key={`h3-${elements.length}`} className="markdown-h3">{content}</h3>);
      } else {
        elements.push(<h4 key={`h4-${elements.length}`} className="markdown-h4">{content}</h4>);
      }
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={`quote-${elements.length}`} className="markdown-blockquote">
          {quoteLines.map((ql, qidx) => (
            <p key={qidx}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Table
    const isTableHeader = line.includes("|") && lines[i + 1] && /^\s*\|?[-:| ]+\|?\s*$/.test(lines[i + 1]);
    if (isTableHeader) {
      const parseRow = (rowLine: string) =>
        rowLine
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());

      const headerCells = parseRow(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];

      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }

      elements.push(
        <div key={`table-${elements.length}`} className="markdown-table-wrapper">
          <table className="markdown-table">
            <thead>
              <tr>
                {headerCells.map((cell, cidx) => (
                  <th key={cidx}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr key={ridx}>
                  {row.map((cell, cidx) => (
                    <td key={cidx}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Task List
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const taskItems: { checked: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const checked = /^\s*[-*]\s+\[[xX]\]/.test(lines[i]);
        const text = lines[i].replace(/^\s*[-*]\s+\[[ xX]\]\s+/, "");
        taskItems.push({ checked, text });
        i++;
      }
      elements.push(
        <ul key={`tasks-${elements.length}`} className="markdown-task-list">
          {taskItems.map((item, tidx) => (
            <li key={tidx} className={item.checked ? "task-completed" : ""}>
              <input type="checkbox" checked={item.checked} readOnly />
              <span>{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Bulleted List
    if (/^\s*[-*•]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[[ xX]\]/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className="markdown-ul">
          {listItems.map((item, lidx) => (
            <li key={lidx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered List
    if (/^\s*\d+\.\s+/.test(line)) {
      const numItems: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        numItems.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${elements.length}`} className="markdown-ol">
          {numItems.map((item, nidx) => (
            <li key={nidx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (collect contiguous text lines until a block starter)
    const paraLines: string[] = [];
    while (i < lines.length && !isSpecialStart(lines[i], lines[i + 1])) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      elements.push(
        <p key={`p-${elements.length}`} className="markdown-p">
          {renderInline(paraLines.join(" "))}
        </p>
      );
    }

    // Absolute fallback: ensure i ALWAYS advances so an infinite loop is mathematically impossible
    if (i <= startIndex) {
      elements.push(
        <p key={`fallback-${elements.length}`} className="markdown-p">
          {renderInline(lines[startIndex])}
        </p>
      );
      i = startIndex + 1;
    }
  }

  return elements;
}

export default function MarkdownViewer({
  content,
  filename = "document.md",
  className = "",
}: {
  content: string;
  filename?: string;
  className?: string;
}) {
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const [copied, setCopied] = useState(false);

  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content]);
  const renderedElements = useMemo(() => parseMarkdownBlocks(body), [body]);

  function handleCopy() {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`markdown-viewer-container ${className}`}>
      {/* Viewer toolbar */}
      <div className="markdown-viewer-toolbar">
        <div className="markdown-view-toggle">
          <button
            type="button"
            className={viewMode === "rendered" ? "active" : ""}
            onClick={() => setViewMode("rendered")}
          >
            <Eye size={13} />
            Rendered
          </button>
          <button
            type="button"
            className={viewMode === "source" ? "active" : ""}
            onClick={() => setViewMode("source")}
          >
            <Code size={13} />
            Raw Source
          </button>
        </div>

        <button
          type="button"
          className="button secondary small markdown-copy-btn"
          onClick={handleCopy}
          title="Copy markdown to clipboard"
        >
          {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy text"}
        </button>
      </div>

      {/* Frontmatter Metadata Pill Strip */}
      {viewMode === "rendered" && frontmatter && (
        <div className="markdown-frontmatter-card">
          <div className="markdown-frontmatter-title">Metadata</div>
          <div className="markdown-frontmatter-grid">
            {Object.entries(frontmatter).map(([k, v]) => (
              <div key={k} className="markdown-frontmatter-item">
                <span className="fm-key">{k}:</span>
                <span className="fm-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Body */}
      {viewMode === "rendered" ? (
        <article className="markdown-rendered-body">{renderedElements}</article>
      ) : (
        <div className="markdown-source-body">
          <pre>
            <code>{content}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
