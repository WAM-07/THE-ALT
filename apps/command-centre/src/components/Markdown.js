// A small Markdown renderer for ALT's policies: headings, paragraphs, bullet lists, **bold**,
// *italic* and [links](url). It builds React elements, never raw HTML.
const inline = (text, key) => {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}${n++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) out.push(<em key={`${key}${n++}`}>{t.slice(1, -1)}</em>);
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/);
      out.push(
        <a key={`${key}${n++}`} href={/^(https?:|\/)/.test(href) ? href : "#"}>
          {label}
        </a>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

export default function Markdown({ source }) {
  const blocks = [];
  let list = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      list ??= { type: "ul", items: [] };
      list.items.push(line.replace(/^\s*[-*] /, ""));
      continue;
    }
    if (list) blocks.push(list);
    list = null;
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3}) (.*)$/);
    blocks.push(h ? { type: "h", text: h[2] } : { type: "p", text: line });
  }
  if (list) blocks.push(list);
  return (
    <div className="md">
      {blocks.map((b, k) =>
        b.type === "ul" ? (
          <ul key={k}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${k}-${j}-`)}</li>
            ))}
          </ul>
        ) : b.type === "h" ? (
          <h3 key={k}>{inline(b.text, `${k}-`)}</h3>
        ) : (
          <p key={k}>{inline(b.text, `${k}-`)}</p>
        ),
      )}
    </div>
  );
}
