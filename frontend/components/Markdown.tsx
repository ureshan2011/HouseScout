// Minimal markdown renderer (bold, headings, bullet lists, paragraphs) — avoids a
// heavy dependency for the small amount of AI-generated markdown we display.
"use client";

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`}>
          {list.map((li, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(li) }} />
          ))}
        </ul>
      );
      list = [];
    }
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^#{1,6}\s+/.test(line)) {
      flush();
      out.push(<h2 key={idx} dangerouslySetInnerHTML={{ __html: inline(line.replace(/^#{1,6}\s+/, "")) }} />);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(<p key={idx} dangerouslySetInnerHTML={{ __html: inline(line) }} />);
    }
  });
  flush();
  return <div className="prose-ai text-sm leading-relaxed">{out}</div>;
}

function inline(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}
