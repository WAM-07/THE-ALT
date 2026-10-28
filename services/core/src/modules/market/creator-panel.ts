import { formatEther } from 'viem';
import type { Ctx } from '../../context.js';

/**
 * Module 18: the Creator Control Panel. One place for a creator's AIs: earnings and royalties (ALTAR's
 * `altar.creator_earnings` view, which mirrors the contract), engagement (ALTERA's `altera.ai_engagement`
 * view), health and versions (Core). Each service keeps its own data; Core only reads their views.
 */

const pol = (wei: bigint) => ({ wei: wei.toString(), pol: formatEther(wei) });

interface EarningRow {
  id: string;
  kind: 'sale' | 'rental' | 'subscription';
  ai_id: string | null;
  earner_user_id: string | null;
  royalty_user_id: string | null;
  amount_wei: string;
  royalty_wei: string;
  fee_wei: string;
  earner_wei: string;
  days: number | null;
  months: number | null;
  tx_hash: string;
  occurred_at: Date;
}

async function viewExists(ctx: Ctx, name: string) {
  const { rows } = await ctx.db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [name]);
  return Boolean(rows[0]?.ok);
}

/** Everything a person earned (as owner or seller, and as creator through royalties), newest first. */
async function earningsOf(ctx: Ctx, userId: string) {
  if (!(await viewExists(ctx, 'altar.creator_earnings'))) return [];
  const { rows } = await ctx.db.query<EarningRow>(
    `SELECT * FROM altar.creator_earnings WHERE earner_user_id = $1 OR royalty_user_id = $1 ORDER BY occurred_at DESC LIMIT 1000`,
    [userId],
  );
  return rows.map((r) => {
    const asEarner = r.earner_user_id === userId ? BigInt(r.earner_wei) : 0n;
    const royalty = r.royalty_user_id === userId ? BigInt(r.royalty_wei) : 0n;
    return { ...r, asEarner, royalty, total: asEarner + royalty };
  });
}

export async function creatorPanel(ctx: Ctx, userId: string) {
  const { rows: ais } = await ctx.db.query<{
    id: string; name: string; handle: string; status: string; health_score: string; owner_id: string; creator_id: string; current_version_id: string | null;
  }>(
    `SELECT id, name, handle, status, health_score, owner_id, creator_id, current_version_id FROM core.personal_ais
      WHERE (owner_id = $1 OR creator_id = $1) AND deleted_at IS NULL ORDER BY created_at`,
    [userId],
  );
  const ids = ais.map((a) => a.id);
  const [{ rows: versions }, earnings, engagement] = await Promise.all([
    ctx.db.query<{ ai_id: string; versions: number; trained: number; latest_readiness: string | null; current_no: number | null }>(
      `SELECT v.ai_id, count(*)::int AS versions, count(*) FILTER (WHERE v.engine = 'adapter')::int AS trained,
              (array_agg(v.readiness ORDER BY v.version_no DESC) FILTER (WHERE v.readiness IS NOT NULL))[1] AS latest_readiness,
              max(v.version_no) FILTER (WHERE v.id = a.current_version_id) AS current_no
         FROM core.ai_versions v JOIN core.personal_ais a ON a.id = v.ai_id
        WHERE v.ai_id = ANY($1::uuid[]) GROUP BY v.ai_id`,
      [ids],
    ),
    earningsOf(ctx, userId),
    (async () => {
      if (!(await viewExists(ctx, 'altera.ai_engagement'))) return [];
      const { rows } = await ctx.db.query<{ ai_id: string; followers: number; posts: number; posts_30d: number; likes: number; comments_received: number; comments_written: number }>(
        'SELECT * FROM altera.ai_engagement WHERE ai_id = ANY($1::uuid[])',
        [ids],
      );
      return rows;
    })(),
  ]);

  const sum = (rows: typeof earnings, pick: (r: (typeof earnings)[number]) => bigint) => rows.reduce((n, r) => n + pick(r), 0n);
  const byKind = (rows: typeof earnings) => ({
    sales: pol(sum(rows.filter((r) => r.kind === 'sale'), (r) => r.asEarner)),
    rentals: pol(sum(rows.filter((r) => r.kind === 'rental'), (r) => r.asEarner)),
    subscriptions: pol(sum(rows.filter((r) => r.kind === 'subscription'), (r) => r.asEarner)),
    royalties: pol(sum(rows, (r) => r.royalty)),
    total: pol(sum(rows, (r) => r.total)),
  });
  const months = new Map<string, bigint>();
  for (const r of earnings) {
    const m = r.occurred_at.toISOString().slice(0, 7);
    months.set(m, (months.get(m) ?? 0n) + r.total);
  }

  return {
    totals: { ...byKind(earnings), transactions: earnings.length },
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, wei]) => ({ month, ...pol(wei) })),
    ais: ais.map((a) => {
      const v = versions.find((x) => x.ai_id === a.id);
      const e = engagement.find((x) => x.ai_id === a.id);
      return {
        id: a.id,
        name: a.name,
        handle: a.handle,
        status: a.status,
        youOwn: a.owner_id === userId,
        youCreated: a.creator_id === userId,
        healthScore: Number(a.health_score),
        versions: { total: v?.versions ?? 0, trained: v?.trained ?? 0, live: v?.current_no ?? null, latestReadiness: v?.latest_readiness == null ? null : Number(v.latest_readiness) },
        earnings: byKind(earnings.filter((r) => r.ai_id === a.id)),
        engagement: e
          ? { followers: e.followers, posts: e.posts, postsLast30Days: e.posts_30d, likes: e.likes, commentsReceived: e.comments_received, commentsWritten: e.comments_written }
          : null,
      };
    }),
    transactions: earnings.slice(0, 100).map((r) => ({
      kind: r.kind,
      aiId: r.ai_id,
      aiName: ais.find((a) => a.id === r.ai_id)?.name ?? null,
      amount: pol(BigInt(r.amount_wei)),
      you: pol(r.total),
      as: r.asEarner && r.royalty ? 'owner and creator' : r.royalty ? 'creator (royalty)' : r.kind === 'sale' ? 'seller' : 'owner',
      days: r.days,
      months: r.months,
      txHash: r.tx_hash,
      at: r.occurred_at.toISOString(),
    })),
  };
}

export type CreatorPanel = Awaited<ReturnType<typeof creatorPanel>>;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote everything that needs it, and defuse spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every earning as CSV (one row each), for the creator's own records. */
export function panelCsv(panel: CreatorPanel) {
  const head = ['date', 'kind', 'ai', 'you_earned_pol', 'as', 'total_paid_pol', 'days', 'months', 'tx_hash'];
  const lines = panel.transactions.map((t) => [t.at, t.kind, t.aiName, t.you.pol, t.as, t.amount.pol, t.days, t.months, t.txHash].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** A one-page PDF summary (PDF 1.4, Helvetica, text only; no library needed). */
export function panelPdf(panel: CreatorPanel, person: string) {
  const lines: string[] = [
    'ALT Creator Control Panel',
    `${person} · ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Total earned: ${panel.totals.total.pol} POL (${panel.totals.transactions} transactions)`,
    `Sales ${panel.totals.sales.pol} · Rentals ${panel.totals.rentals.pol} · Subscriptions ${panel.totals.subscriptions.pol} · Royalties ${panel.totals.royalties.pol} POL`,
    '',
    'Your AIs',
    ...panel.ais.map(
      (a) =>
        `  ${a.name} (@${a.handle}) · ${a.status} · health ${Math.round(a.healthScore)} · v${a.versions.live ?? '-'} live, ${a.versions.trained} trained · earned ${a.earnings.total.pol} POL` +
        (a.engagement ? ` · ${a.engagement.followers} followers, ${a.engagement.posts} posts` : ''),
    ),
    '',
    'Recent earnings',
    ...panel.transactions.slice(0, 25).map((t) => `  ${t.at.slice(0, 10)}  ${t.kind.padEnd(12)} ${(t.aiName ?? '').slice(0, 24).padEnd(24)} ${t.you.pol} POL (${t.as})`),
  ];
  // Text in a PDF string: escape \ ( ), and keep to the characters Helvetica's standard encoding has.
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '?');
  const content = ['BT', '/F1 10 Tf', '13 TL', '50 800 Td', ...lines.slice(0, 58).map((l, i) => (i === 0 ? `/F1 14 Tf (${esc(l)}) Tj /F1 10 Tf T*` : `(${esc(l)}) Tj T*`)), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
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
