/**
 * A text-only PDF (PDF 1.4, Helvetica, A4), no library needed: for the records people download from ALT
 * (the Creator panel summary, consent records). The first line is the title; up to 58 lines per page.
 */
export function textPdf(lines: string[]) {
  // Text in a PDF string: escape \ ( ), and keep to the characters Helvetica's standard encoding has.
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[·–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, '?');
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, lines.length); i += 58) pages.push(lines.slice(i, i + 58));
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: number[] = [];
  pages.forEach((page, p) => {
    const content = ['BT', '/F1 10 Tf', '13 TL', '50 800 Td', ...page.map((l, i) => (p === 0 && i === 0 ? `/F1 14 Tf (${esc(l)}) Tj /F1 10 Tf T*` : `(${esc(l)}) Tj T*`)), 'ET'].join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`);
    kids.push(objects.length);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
