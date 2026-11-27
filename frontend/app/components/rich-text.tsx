import type { ReactNode } from "react";

/**
 * Policy and FAQ text written by staff, with a few simple marks and never treated as HTML:
 *   ## Heading          (# works too)
 *   - item  / • item    bulleted list
 *   1. item             numbered list
 *   **bold**
 *   [text](https://…)   link: http(s), mailto:, tel: or a page of this site ("/policies/delivery")
 * A blank line starts a new paragraph; a single line break stays a line break.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i;

/** Bold and links inside one line of text. */
export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={`${key}-${n++}`}>{m[1]}</strong>);
    } else if (m[2] !== undefined && m[3] !== undefined && SAFE_LINK.test(m[3])) {
      const external = /^https?:/i.test(m[3]);
      out.push(
        <a key={`${key}-${n++}`} href={m[3]} className="underline underline-offset-2"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {m[2]}
        </a>,
      );
    } else {
      out.push(m[0]); // an unsafe link stays as plain text
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(block: string[], key: string): ReactNode[] {
  return block.flatMap((line, i) => (i === 0 ? inline(line, `${key}-${i}`) : [<br key={`${key}-br${i}`} />, ...inline(line, `${key}-${i}`)]));
}

export function RichText({ text }: { text: string }) {
  const blocks = (text ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trimEnd())).filter((b) => b.some((l) => l.trim()));
  const nodes: ReactNode[] = [];
  blocks.forEach((raw, b) => {
    const block = raw.filter((l) => l.trim() !== "");
    let i = 0;
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length) nodes.push(<p key={`p${b}-${i}`}>{lines(paragraph, `p${b}-${i}`)}</p>);
      paragraph = [];
    };
    while (i < block.length) {
      const line = block[i]!.trim();
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        flush();
        nodes.push(heading[1]!.length === 1
          ? <h2 key={`h${b}-${i}`} className="pt-2 text-lg font-semibold">{inline(heading[2]!, `h${b}-${i}`)}</h2>
          : <h3 key={`h${b}-${i}`} className="pt-2 font-semibold">{inline(heading[2]!, `h${b}-${i}`)}</h3>);
        i++;
        continue;
      }
      const bullet = /^[-•*]\s+/;
      const number = /^\d+[.)]\s+/;
      if (bullet.test(line) || number.test(line)) {
        flush();
        const ordered = number.test(line);
        const items: string[] = [];
        while (i < block.length && (ordered ? number : bullet).test(block[i]!.trim())) {
          items.push(block[i]!.trim().replace(ordered ? number : bullet, ""));
          i++;
        }
        const children = items.map((item, k) => <li key={k}>{inline(item, `l${b}-${i}-${k}`)}</li>);
        nodes.push(ordered
          ? <ol key={`o${b}-${i}`} className="list-decimal space-y-1 ps-6">{children}</ol>
          : <ul key={`u${b}-${i}`} className="list-disc space-y-1 ps-6">{children}</ul>);
        continue;
      }
      paragraph.push(line);
      i++;
    }
    flush();
  });
  return <>{nodes}</>;
}
