"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAI } from "../contexts/AIContext";
import { useTheme } from "../contexts/ThemeContext";
import AICard from "../components/AICard";
import AitArt from "../components/AitArt";
import { Avatar, Button, Chip, Empty, SectionHead, Shape, VerifiedTick } from "../components/ui";
import { CountUp, Reveal, useParallax } from "../components/motion";
import { mediaUrl, publicApi } from "../lib/alt";
import { networkName, timeAgo } from "../lib/format";
import { PageLoader } from "../components/BrandLogo";

const SORTS = {
  newest: ["Newest", (a, b) => new Date(b.token?.mintedAt ?? b.createdAt) - new Date(a.token?.mintedAt ?? a.createdAt)],
  health: ["Healthiest", (a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0)],
  name: ["A–Z", (a, b) => a.name.localeCompare(b.name)],
};

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const { aiModels, error } = useAI();
  const { theme } = useTheme();
  const params = useSearchParams();
  const router = useRouter();
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("newest");

  // The header's search box sends people here with ?q=…
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setQuery(urlQuery);
  }

  const models = useMemo(() => aiModels ?? [], [aiModels]);
  const byNewest = useMemo(() => [...models].sort(SORTS.newest[1]), [models]);
  const categories = useMemo(() => ["All", ...new Set(models.map((m) => m.category))], [models]);
  const creators = useMemo(() => {
    const map = new Map();
    for (const m of byNewest) {
      if (!m.creator) continue;
      const entry = map.get(m.creator.id) ?? { person: m.creator, ais: [] };
      entry.ais.push(m);
      map.set(m.creator.id, entry);
    }
    return [...map.values()].sort((a, b) => b.ais.length - a.ais.length);
  }, [byNewest]);

  // ALT's embedding model also finds AIs by what they are about ("help with maths"), not only by name.
  const [byMeaning, setByMeaning] = useState({ q: "", ids: new Set() });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const timer = setTimeout(() => {
      publicApi(`/core/public/search/ais?q=${encodeURIComponent(q)}&platform=altar`)
        .then((r) => setByMeaning({ q, ids: new Set(r.by === "meaning" ? r.results.map((x) => x.id) : []) }))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const { shown, matchedByMeaning } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const meaning = byMeaning.q.toLowerCase() === q ? byMeaning.ids : new Set();
    const byText = (m) => [m.name, m.handle, m.category, m.description, m.creatorName, m.ownerName, m.creator?.handle].some((v) => String(v ?? "").toLowerCase().includes(q));
    const list = models
      .filter((m) => category === "All" || m.category === category)
      .filter((m) => !q || byText(m) || meaning.has(m.id))
      .sort(SORTS[sort][1]);
    return { shown: list, matchedByMeaning: q ? list.filter((m) => !byText(m)).length : 0 };
  }, [models, category, query, sort, byMeaning]);

  const network = models.find((m) => m.token)?.token.chainId;
  const clearSearch = () => {
    setQuery("");
    if (urlQuery) router.replace("/#explore", { scroll: false });
  };

  return (
    <>
      <Hero models={byNewest} count={models.length} creators={creators.length} network={network} />
      <Ticker models={byNewest} />

      {aiModels === null ? (
        <PageLoader className="py-24" />
      ) : (
        <>
          {byNewest.length > 0 && <NewlyMinted models={byNewest.slice(0, 5)} />}

          <WaysToHold dark={theme === "studio"} />

          <section id="explore" className="mx-auto max-w-[1320px] scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
            <Reveal>
              <SectionHead eyebrow="Explore" title="Verified AIs" />
            </Reveal>
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-1 lg:px-0">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${category === c ? "bg-pop text-pop-ink" : "border border-line bg-surface text-ink-2 hover:border-ink/30"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, or describe an AI"
                  aria-label="Search AIs"
                  className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm outline-none placeholder:text-ink-3 focus:border-ink/30 lg:w-64"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort"
                  className="h-10 rounded-full border border-line bg-surface px-4 text-sm font-semibold outline-none focus:border-ink/30"
                >
                  {Object.entries(SORTS).map(([k, [label]]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {matchedByMeaning > 0 && (
              <p className="-mt-4 mb-6 text-sm text-ink-3">
                {matchedByMeaning === 1 ? "1 AI matches" : `${matchedByMeaning} AIs match`} by meaning (ALT&apos;s search model), not by name.
              </p>
            )}
            {error && models.length === 0 ? (
              <Empty title="Couldn't reach ALT">Check that the ALT services are running, then refresh the page.</Empty>
            ) : shown.length === 0 ? (
              models.length === 0 ? (
                <Empty title="No verified AIs yet" action={<Button href="/list-ai">How to list yours</Button>}>
                  AIs appear here once they&apos;re built in ALTER and verified with an AI Identity Token.
                </Empty>
              ) : (
                <Empty title="Nothing matches" action={<Button kind="outline" onClick={clearSearch}>Clear the search</Button>}>
                  Try another name, handle or category.
                </Empty>
              )
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                {shown.map((m, i) => (
                  <Reveal key={m.id} delay={(i % 4) * 70}>
                    <AICard model={m} />
                  </Reveal>
                ))}
              </div>
            )}
          </section>

          {creators.length > 0 && <Creators creators={creators.slice(0, 8)} />}
          <SellBand />
        </>
      )}
    </>
  );
}

function Hero({ models, count, creators, network }) {
  const featured = models.slice(0, 3);
  const parallax = useParallax();
  // Staggers the hero's lines as they rise in.
  const rise = (ms) => ({ animationDelay: `${ms}ms` });
  return (
    <section className="relative overflow-hidden" {...parallax}>
      <Shape variant={0} className="absolute -bottom-24 -right-40 h-[440px] w-[440px] animate-morph text-b1 lg:-right-24 lg:-top-24 lg:bottom-auto lg:h-[640px] lg:w-[640px]" />
      <Shape variant={2} className="absolute -bottom-56 -left-40 h-[300px] w-[300px] animate-spin-slow text-b2" />
      <div className="absolute left-[46%] top-16 hidden animate-float lg:block">
        <Shape variant={1} className="h-14 w-14 animate-spin-slow text-b4 [animation-duration:14s]" />
      </div>
      <Shape variant={3} className="absolute bottom-16 left-[40%] hidden h-10 w-10 animate-float text-b3 [--r:18deg] [animation-delay:-3s] lg:block" />

      <div className="relative mx-auto grid max-w-[1320px] items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
        <div className="max-w-2xl">
          <Chip className="mb-6 animate-rise border border-line bg-surface/80 py-1 text-ink-2 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Every AI here holds an AI Identity Token
          </Chip>
          <h1 className="font-display text-[42px] font-extrabold leading-[0.98] tracking-tight min-[400px]:text-5xl sm:text-6xl lg:text-[76px]">
            <span className="inline-block animate-rise" style={rise(60)}>
              Personal AIs,
            </span>
            <br />
            <span className="relative inline-block animate-rise" style={rise(160)}>
              <span className="absolute inset-x-[-0.1em] bottom-[0.06em] top-[0.2em] -rotate-1 animate-swipe rounded-[0.25em] bg-accent" aria-hidden="true" />
              <span className="relative text-accent-ink">owned</span>
            </span>{" "}
            <span className="inline-block animate-rise" style={rise(240)}>
              on-chain.
            </span>
          </h1>
          <p className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-ink-2" style={rise(340)}>
            An AIT is like an NFT for an AI: it proves who made it and who owns it. On ALTAR you can own an AI outright, rent it for a few days, or subscribe monthly.
          </p>
          <div className="mt-8 flex animate-rise flex-wrap gap-3" style={rise(420)}>
            <Button href="#explore" size="lg" className="group/cta">
              Explore AIs
              <span className="transition-transform duration-300 group-hover/cta:translate-x-1" aria-hidden="true">
                →
              </span>
            </Button>
            <Button href="/list-ai" kind="outline" size="lg">
              Sell your AI
            </Button>
          </div>
          <dl className="mt-10 grid max-w-md animate-rise grid-cols-3 gap-4" style={rise(500)}>
            <Stat value={count} label={count === 1 ? "Verified AI" : "Verified AIs"} />
            <Stat value={creators} label={creators === 1 ? "Creator" : "Creators"} />
            <Stat value="≤10%" label="Creator royalty" />
          </dl>
          {network && (
            <p className="mt-4 animate-rise text-sm text-ink-3" style={rise(560)}>
              Tokens live on {networkName(network)}.
            </p>
          )}
        </div>

        <div className="relative mx-auto h-[360px] w-full max-w-[480px] sm:h-[440px]">
          {featured.length === 0 ? (
            <TokenCard className="absolute left-1/2 top-1/2 w-[230px] -translate-x-1/2 -translate-y-1/2 rotate-3 sm:w-[270px]" seed="altar" title="Your AI here" subtitle="Built in ALTER, verified on-chain" />
          ) : (
            featured.map((m, i) => {
              // Fan the newest cards like a hand; the newest sits in front.
              const place = (
                featured.length === 1
                  ? ["z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-3"]
                  : featured.length === 2
                    ? ["z-30 right-[4%] top-[10%] rotate-[5deg]", "z-20 left-[4%] top-[4%] -rotate-[7deg]"]
                    : [
                        "z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-2",
                        "z-20 left-[2%] top-[8%] -rotate-[9deg] sm:left-0",
                        "z-10 right-[2%] top-[14%] rotate-[10deg] sm:right-0",
                      ]
              )[i];
              // Cards nearer the front follow the mouse more, which gives the stack depth.
              const depth = [22, 12, 8][i];
              return (
                <Link
                  key={m.id}
                  href={`/details/${m.handle}`}
                  className={`absolute block w-[200px] animate-deal transition-[scale] duration-300 hover:z-40 hover:scale-[1.04] sm:w-[250px] ${place}`}
                  style={{ animationDelay: `${250 + (featured.length - 1 - i) * 160}ms` }}
                >
                  <div className="transition-transform duration-500 ease-out" style={{ transform: `translate3d(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px), 0)` }}>
                    <div className="animate-float" style={{ animationDelay: `${-i * 2.3}s`, animationDuration: `${7 + i}s` }}>
                      <TokenCard seed={m.artSeed} title={m.name} subtitle={`AIT #${m.token?.tokenId} · by ${m.creatorName}`} avatar={m.image} verified />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

/** A ribbon of the latest mints that keeps moving (it pauses under the mouse). Real tokens only. */
function Ticker({ models }) {
  if (models.length === 0) return null;
  const items = models.slice(0, 12);
  // Enough copies to fill wide screens; the strip slides by exactly half its width, then loops.
  const copies = Math.max(2, Math.ceil(8 / items.length) * 2);
  const strip = Array.from({ length: copies }, () => items).flat();
  return (
    <section className="overflow-hidden py-6" aria-label="Latest mints">
      <div className="-mx-4 -rotate-[1.5deg] bg-pop py-3 text-pop-ink">
        <div className="flex w-max animate-marquee items-center" style={{ "--marquee-duration": `${strip.length * 3}s` }}>
          {strip.map((m, i) => (
            <Link
              key={i}
              href={`/details/${m.handle}`}
              tabIndex={i < items.length ? 0 : -1}
              aria-hidden={i >= items.length || undefined}
              className="flex shrink-0 items-center gap-3 px-6 text-sm font-semibold hover:text-accent"
            >
              <span className="h-7 w-7 overflow-hidden rounded-lg">
                <AitArt seed={m.artSeed} grain={false} motion="none" className="h-full w-full" />
              </span>
              {m.name}
              <span className="font-normal opacity-60">
                AIT #{m.token?.tokenId} · minted {timeAgo(m.token?.mintedAt)}
              </span>
              <span className="pl-3 text-accent" aria-hidden="true">
                ✦
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function TokenCard({ seed, title, subtitle, avatar, verified, className = "" }) {
  return (
    <div className={`rounded-[28px] border border-line bg-surface p-2.5 shadow-card ${className}`}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[20px]">
        <AitArt seed={seed} motion="always" />
        {avatar !== undefined && <Avatar src={avatar} name={title} size={52} className="absolute bottom-3 left-3 ring-[3px] ring-white/80" />}
      </div>
      <div className="px-1.5 pb-1 pt-3">
        <p className="flex items-center gap-1.5 truncate font-display text-lg font-bold leading-tight">
          <span className="truncate">{title}</span>
          {verified && <VerifiedTick />}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-3">{subtitle}</p>
      </div>
    </div>
  );
}

const Stat = ({ value, label }) => (
  <div>
    <dd className="font-display text-3xl font-bold tracking-tight">
      <CountUp value={value} />
    </dd>
    <dt className="mt-0.5 text-sm text-ink-3">{label}</dt>
  </div>
);

function NewlyMinted({ models }) {
  return (
    <Reveal as="section" className="mx-auto max-w-[1320px] px-4 pb-4 sm:px-6">
      <SectionHead
        eyebrow="Fresh on-chain"
        title="Newly minted"
        action={
          <Link href="#explore" className="text-sm font-semibold text-ink-2 hover:text-ink">
            See all →
          </Link>
        }
      />
      <div className="overflow-hidden rounded-3xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-sunken/60 text-xs font-semibold text-ink-3">
            <tr>
              <th className="w-10 py-3 pl-5 font-semibold">#</th>
              <th className="py-3 pr-3 font-semibold">AI</th>
              <th className="hidden py-3 pr-3 font-semibold md:table-cell">Creator</th>
              <th className="hidden py-3 pr-3 font-semibold sm:table-cell">Token</th>
              <th className="hidden py-3 pr-3 font-semibold lg:table-cell">Version</th>
              <th className="hidden py-3 pr-3 font-semibold lg:table-cell">Royalty</th>
              <th className="py-3 pr-3 font-semibold">Health</th>
              <th className="hidden py-3 pr-5 text-right font-semibold sm:table-cell">Minted</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => (
              <tr key={m.id} className="group border-t border-line">
                <td className="py-3 pl-5 text-ink-3">{i + 1}</td>
                <td className="py-3 pr-3">
                  <Link href={`/details/${m.handle}`} className="flex min-w-0 items-center gap-3">
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                      <AitArt seed={m.artSeed} grain={false} />
                      <Avatar src={m.image} name={m.name} size={24} className="absolute bottom-1 right-1 ring-2 ring-white/80" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-semibold group-hover:underline">
                        <span className="truncate">{m.name}</span>
                        <VerifiedTick className="h-3.5 w-3.5" />
                      </span>
                      <span className="block truncate text-xs text-ink-3">@{m.handle}</span>
                    </span>
                  </Link>
                </td>
                <td className="hidden py-3 pr-3 text-ink-2 md:table-cell">{m.creatorName}</td>
                <td className="hidden py-3 pr-3 font-mono text-xs text-ink-2 sm:table-cell">#{m.token?.tokenId}</td>
                <td className="hidden py-3 pr-3 text-ink-2 lg:table-cell">v{m.version ?? 1}</td>
                <td className="hidden py-3 pr-3 text-ink-2 lg:table-cell">{(m.royaltyBps ?? 0) / 100}%</td>
                <td className="py-3 pr-3">
                  <HealthBar value={m.healthScore} />
                </td>
                <td className="hidden py-3 pr-5 text-right text-ink-2 sm:table-cell">{timeAgo(m.token?.mintedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Reveal>
  );
}

function HealthBar({ value }) {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <span className="flex items-center gap-2">
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-sunken min-[380px]:block">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${v}%` }} />
      </span>
      <span className="font-semibold">{v}%</span>
    </span>
  );
}

function WaysToHold({ dark }) {
  const ways = [
    ["Own it", "text-b1", "The AI's token moves to your wallet. You hold every right; the seller loses all access.", "The AIT transfers to you"],
    ["Rent it", "text-b3", "Sole use for the days you pay for. The owner keeps the token, and access ends on time by itself.", "One renter at a time"],
    ["Subscribe", "text-b2", "Monthly access alongside other subscribers, for AIs whose owners offer it.", "Many people, monthly"],
  ];
  return (
    <section data-theme={dark ? "night" : undefined} className={`my-12 bg-canvas text-ink ${dark ? "" : "border-y border-line"}`}>
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 lg:py-20">
        <div className="mb-10 max-w-2xl">
          <p className="mb-1 text-sm font-semibold text-accent-text">How ALTAR works</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Three ways to hold an AI</h2>
          <p className="mt-3 text-ink-2">An AI never leaves ALT as a file. Rights follow its token, so what you buy is enforced on-chain, not by trust.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {ways.map(([title, color, text, tag], i) => (
            <Reveal key={title} delay={i * 120} className="group relative overflow-hidden rounded-3xl border border-line bg-surface p-7">
              <Shape variant={i} className={`absolute -right-10 -top-10 h-36 w-36 ${color} opacity-90 transition-[scale] duration-500 group-hover:scale-125 ${i === 1 ? "animate-spin-slow" : "animate-morph"}`} />
              <p className="relative font-display text-2xl font-bold">{title}</p>
              <p className="relative mt-3 text-ink-2">{text}</p>
              <p className="relative mt-6 text-sm font-semibold text-accent-text">{tag}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-3 rounded-3xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-2">
            <b className="text-ink">Creators earn a royalty on every resale</b>, set when the AI is minted (up to 10%) and paid by the token itself.
          </p>
          <Chip tone="soon" className="shrink-0 self-start sm:self-auto">Buying and renting open soon</Chip>
        </div>
      </div>
    </section>
  );
}

function Creators({ creators }) {
  return (
    <Reveal as="section" className="mx-auto max-w-[1320px] px-4 pb-16 sm:px-6 lg:pb-24">
      <SectionHead eyebrow="The people behind them" title="Creators" />
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {creators.map(({ person, ais }) => (
          <Link key={person.id} href={`/creator/${person.handle}`} className="group overflow-hidden rounded-3xl border border-line bg-surface transition hover:-translate-y-1 hover:shadow-card">
            <div className="flex h-20">
              {ais.slice(0, 3).map((m) => (
                <AitArt key={m.id} seed={m.artSeed} grain={false} className="h-full flex-1" />
              ))}
            </div>
            <div className="px-5 pb-5">
              <Avatar src={mediaUrl(person.avatarUrl)} name={person.displayName} size={56} className="relative -mt-7 ring-4 ring-surface" />
              <p className="mt-2 truncate font-display text-lg font-bold">{person.displayName}</p>
              <p className="truncate text-sm text-ink-3">@{person.handle}</p>
              <p className="mt-3 text-sm font-semibold text-ink-2">
                {ais.length} verified {ais.length === 1 ? "AI" : "AIs"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}

function SellBand() {
  return (
    <Reveal as="section" className="mx-auto max-w-[1320px] px-4 pb-20 sm:px-6">
      <div className="relative overflow-hidden rounded-[36px] bg-accent px-6 py-12 text-accent-ink sm:px-12 sm:py-16">
        <Shape variant={1} className="absolute -right-16 -top-16 h-64 w-64 animate-spin-slow text-b4 opacity-90" />
        <Shape variant={0} className="absolute -bottom-24 right-40 hidden h-56 w-56 animate-morph text-b2 md:block" />
        <div className="relative max-w-xl">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Built an AI in ALTER?</h2>
          <p className="mt-4 text-lg opacity-80">Deploy it there to mint its AI Identity Token. Then set a price, a daily rent or a subscription here, and earn royalties when it changes hands.</p>
          <Link href="/list-ai" className="mt-8 inline-flex h-12 items-center rounded-full bg-[#131613] px-7 font-semibold text-white transition hover:opacity-90">
            List your AI
          </Link>
        </div>
      </div>
    </Reveal>
  );
}
