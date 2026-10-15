// A small Markdown renderer for ALT's policies: headings, paragraphs, bullet lists, **bold**,
// *italic* and [links](url). It builds React elements, never raw HTML.
const inline = (text, key = "i") => {
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
      const safe = /^(https?:|\/)/.test(href) ? href : "#";
      out.push(
        <a key={`${key}${n++}`} href={safe} className="font-semibold underline underline-offset-4">
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
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      list ??= { type: "ul", items: [] };
      list.items.push(line.replace(/^\s*[-*] /, ""));
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^(#{1,3}) (.*)$/);
    blocks.push(h ? { type: `h${h[1].length}`, text: h[2], i } : { type: "p", text: line, i });
  });
  flush();
  return (
    <div className="space-y-4 leading-relaxed text-ink-2">
      {blocks.map((b, k) =>
        b.type === "ul" ? (
          <ul key={k} className="list-disc space-y-1.5 pl-6">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${k}-${j}-`)}</li>
            ))}
          </ul>
        ) : b.type === "p" ? (
          <p key={k}>{inline(b.text, `${k}-`)}</p>
        ) : (
          <h2 key={k} className="pt-2 font-display text-xl font-bold text-ink">
            {inline(b.text, `${k}-`)}
          </h2>
        ),
      )}
    </div>
  );
}
