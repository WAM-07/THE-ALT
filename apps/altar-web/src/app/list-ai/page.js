"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AitArt from "../../components/AitArt";
import ConfirmSpend from "../../components/ConfirmSpend";
import NextStep from "../../components/NextStep";
import { Avatar, Button, Card, Chip, Spinner } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { toModel, useAI } from "../../contexts/AIContext";
import { useModal } from "../../contexts/ModalContext";
import { altar, api, auth, continueWithAlt, wallet } from "../../lib/alt";
import { percent, polText } from "../../lib/format";

const STEPS = [
  ["Create it in ALTER", "Give your AI a personality, add what it should know, and chat with it until it sounds like you.", "In ALTER"],
  ["Deploy it to mint its AIT", "ALTER checks consent and safety, then mints the AI Identity Token to your ALT wallet.", "In ALTER"],
  ["Set your terms here", "A sale price, a daily rent and a monthly subscription. Royalties come back to you on every resale.", "On ALTAR"],
];
const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

export default function ListAIPage() {
  return (
    <Suspense fallback={null}>
      <ListAI />
    </Suspense>
  );
}

function ListAI() {
  const { user } = useAuth();
  const { showAlert } = useModal();
  const params = useSearchParams();
  const [mine, setMine] = useState(null);
  const [selected, setSelected] = useState(params.get("ai"));

  useEffect(() => {
    if (!user) return;
    api("/core/ais")
      .then((list) => setMine(list.map(toModel)))
      .catch(() => setMine([]));
  }, [user]);

  const openAlter = async () => {
    try {
      const { url } = await auth.handoffTo("alter");
      window.location.href = url;
    } catch {
      showAlert("Open ALTER", "Open the ALTER app on your phone to create your AI.");
    }
  };

  const verified = useMemo(() => (mine ?? []).filter((a) => a.verified), [mine]);
  const current = verified.find((a) => a.id === selected) ?? verified[0];

  if (!user || (mine && verified.length === 0)) {
    return (
      <NextStep eyebrow="Sell on ALTAR" title="List your AI" intro="On ALTAR you sell an AI you own, not a file. Its token carries the rights, so buyers know exactly what they get.">
        {STEPS.map(([title, text, where], i) => (
          <Card key={title} className="flex gap-5 p-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-display text-lg font-bold text-accent-ink">{i + 1}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-xl font-bold">{title}</p>
                <Chip tone="accent">{where}</Chip>
              </div>
              <p className="mt-1.5 text-ink-2">{text}</p>
            </div>
          </Card>
        ))}
        <div className="flex flex-wrap gap-3 pt-3">
          {user ? <Button onClick={openAlter}>Create an AI in ALTER</Button> : <Button onClick={() => continueWithAlt("signin", "/list-ai").catch(() => {})}>Continue with ALT</Button>}
        </div>
      </NextStep>
    );
  }
  if (!mine) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <p className="text-sm font-semibold text-accent-text">Sell on ALTAR</p>
      <h1 className="font-display text-4xl font-extrabold tracking-tight">List your AI</h1>
      <p className="mt-2 max-w-2xl text-ink-2">Choose how people can hold it. Sale and rent prices are written to the blockchain by your ALT wallet; ALT pays the network fee.</p>

      <div className="no-scrollbar -mx-4 mt-8 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {verified.map((a) => (
          <button
            key={a.id}
            onClick={() => setSelected(a.id)}
            className={`flex shrink-0 items-center gap-3 rounded-2xl border p-2 pr-4 text-left transition ${a.id === current.id ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-ink/30"}`}
          >
            <span className="relative h-12 w-12 overflow-hidden rounded-xl">
              <AitArt seed={a.artSeed} grain={false} motion="none" />
              <Avatar src={a.image} name={a.name} size={24} className="absolute bottom-1 right-1 ring-2 ring-white/80" />
            </span>
            <span>
              <span className="block font-semibold">{a.name}</span>
              <span className="text-xs text-ink-3">AIT #{a.token?.tokenId}</span>
            </span>
          </button>
        ))}
      </div>

      <ListingForm key={current.id} ai={current} />
    </div>
  );
}

function ListingForm({ ai }) {
  const { reload } = useAI();
  const [chain, setChain] = useState(null); // on-chain state from ALT Core
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    try {
      const [market, listing] = await Promise.all([wallet.market(ai.id), altar.listing(ai.id).catch(() => null)]);
      setChain(market);
      setForm({
        sellOn: Boolean(market.sale),
        salePrice: market.sale?.price.pol ?? "",
        rentOn: Boolean(market.rent),
        rentPrice: market.rent?.pricePerDay.pol ?? "",
        rentDays: String(market.rent?.maxDays ?? 7),
        subOn: Boolean(market.subscription),
        subPrice: market.subscription?.pricePerMonth.pol ?? "",
        pitch: listing?.pitch ?? "",
        terms: listing?.terms ?? "",
      });
    } catch (err) {
      setError(err.message);
    }
  }, [ai.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !form) return <p className="mt-8 rounded-2xl bg-rose-500/10 px-5 py-4 text-rose-600">{error}</p>;
  if (!form) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const sale = form.sellOn ? { price: form.salePrice.trim() } : null;
  const rent = form.rentOn ? { pricePerDay: form.rentPrice.trim(), maxDays: Number(form.rentDays) } : null;
  const subscription = form.subOn ? { pricePerMonth: form.subPrice.trim() } : null;
  // Compared as numbers, so "2.50" and "2.5" count as the same price.
  const same = (a, b) => (a == null ? b == null : b != null && Number(a) === Number(b));
  const chainChanged =
    !same(sale?.price, chain.sale?.price.pol) ||
    !same(rent?.pricePerDay, chain.rent?.pricePerDay.pol) ||
    !same(rent?.maxDays, chain.rent?.maxDays) ||
    !same(subscription?.pricePerMonth, chain.subscription?.pricePerMonth.pol);
  const fee = (p) => (Number(p) * chain.platformFeeBps) / 10_000;

  const problems = [
    form.sellOn && !AMOUNT.test(form.salePrice.trim()) && "Enter a sale price like 25 or 2.5.",
    form.rentOn && !AMOUNT.test(form.rentPrice.trim()) && "Enter a daily rent like 0.5.",
    form.rentOn && !(Number(form.rentDays) >= 1 && Number(form.rentDays) <= 365) && "Rentals can last 1 to 365 days.",
    form.subOn && !AMOUNT.test(form.subPrice.trim()) && "Enter a monthly price like 3.",
  ].filter(Boolean);

  const saveDetails = () =>
    altar.saveListing(ai.id, { pitch: form.pitch, terms: form.terms });

  const finish = async (txs = []) => {
    const { listing } = await saveDetails();
    await reload();
    setDone({ listing, txs });
    await load();
  };

  const save = async () => {
    if (problems.length) return setError(problems[0]);
    setError(null);
    if (chainChanged) return setConfirming(true);
    setSaving(true);
    try {
      await finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-5">
        <Offer title="Sell it" on={form.sellOn} onToggle={set("sellOn")} note="The token moves to the buyer, with every right. You keep no access.">
          <Amount label="Price" value={form.salePrice} onChange={set("salePrice")} />
          {form.salePrice && AMOUNT.test(form.salePrice) && (
            <p className="mt-2 text-sm text-ink-3">
              You receive about {polText(String(Number(form.salePrice) - fee(form.salePrice)))} after ALTAR&apos;s {percent(chain.platformFeeBps)} fee. On later resales you earn your {percent(ai.royaltyBps)} royalty.
            </p>
          )}
        </Offer>

        <Offer title="Rent it out" on={form.rentOn} onToggle={set("rentOn")} note="One person uses it for the days they pay for. You keep the token.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Amount label="Price per day" value={form.rentPrice} onChange={set("rentPrice")} />
            <label className="block text-sm font-semibold text-ink-2">
              Longest rental (days)
              <input type="number" min="1" max="365" value={form.rentDays} onChange={set("rentDays")} className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-sunken/60 px-4 text-[15px] text-ink outline-none focus:border-ink/30" />
            </label>
          </div>
        </Offer>

        <Offer title="Offer a subscription" on={form.subOn} onToggle={set("subOn")} note="Any number of people use it, a month (30 days) at a time. You keep the token.">
          <Amount label="Price per month" value={form.subPrice} onChange={set("subPrice")} />
          <p className="mt-2 text-sm text-ink-3">Subscribers can renew; each renewal adds to their time. If you sell the AI, they keep the time they paid for.</p>
        </Offer>

        <Card className="p-6">
          <h2 className="font-display text-lg font-bold">Describe the offer</h2>
          <label className="mt-4 block text-sm font-semibold text-ink-2">
            Short pitch <span className="font-normal text-ink-3">({form.pitch.length}/280)</span>
            <input maxLength={280} value={form.pitch} onChange={set("pitch")} placeholder="What makes this AI worth having?" className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-sunken/60 px-4 text-[15px] text-ink outline-none focus:border-ink/30" />
          </label>
          <label className="mt-4 block text-sm font-semibold text-ink-2">
            Terms <span className="font-normal text-ink-3">(optional)</span>
            <textarea maxLength={2000} rows={4} value={form.terms} onChange={set("terms")} placeholder="Anything buyers and renters should know." className="mt-1.5 w-full rounded-2xl border border-line bg-sunken/60 px-4 py-3 text-[15px] text-ink outline-none focus:border-ink/30" />
          </label>
        </Card>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <div className="relative h-36">
            <AitArt seed={ai.artSeed} motion="always" />
            <Avatar src={ai.image} name={ai.name} size={56} className="absolute -bottom-7 left-5 ring-4 ring-surface" />
          </div>
          <div className="p-6 pt-10">
            <p className="font-display text-xl font-bold">{ai.name}</p>
            <p className="text-sm text-ink-3">AIT #{ai.token?.tokenId}</p>
            <dl className="mt-5 space-y-2 text-sm">
              <Line k="Sale" v={sale && AMOUNT.test(sale.price) ? polText(sale.price) : "Not for sale"} />
              <Line k="Rent" v={rent && AMOUNT.test(rent.pricePerDay) ? polText(rent.pricePerDay, ` / day, up to ${rent.maxDays} days`) : "Not for rent"} />
              <Line k="Subscription" v={form.subOn && AMOUNT.test(form.subPrice) ? polText(form.subPrice, " / month") : "None"} />
            </dl>
            {chain.rentedTo && <p className="mt-4 rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-2">Rented until {new Date(chain.rentedTo.until).toLocaleString()}. It can&apos;t be sold until then.</p>}
            {error && <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>}
            {done && (
              <p className="animate-page-in mt-4 rounded-2xl bg-accent/15 px-4 py-3 text-sm text-ink">
                {done.listing ? "Saved. " : "Taken off the market. "}
                {done.txs.length > 0 && `${done.txs.length} transaction${done.txs.length === 1 ? "" : "s"} confirmed on the chain. `}
                <Link href={`/details/${ai.handle}`} className="font-semibold underline underline-offset-4">
                  See it on ALTAR →
                </Link>
              </p>
            )}
            <Button size="lg" className="mt-5 w-full" onClick={save} disabled={saving}>
              {saving ? "Saving…" : chainChanged ? "Save and sign on-chain" : "Save"}
            </Button>
            <p className="mt-3 text-xs text-ink-3">{chainChanged ? "Changing a price needs your password; ALT signs with your wallet and pays the network fee." : "The pitch and terms save without signing."}</p>
          </div>
        </Card>
      </div>

      {confirming && (
        <ConfirmSpend
          title="Confirm your listing"
          action="Sign and list"
          intent={{
            action: "list",
            ai: { id: ai.id, handle: ai.handle },
            params: {
              salePrice: sale ? sale.price : "off",
              rentPricePerDay: rent ? rent.pricePerDay : "off",
              rentMaxDays: rent ? rent.maxDays : "off",
              subscriptionPricePerMonth: subscription ? subscription.pricePerMonth : "off",
            },
          }}
          onClose={() => setConfirming(false)}
          onConfirm={async (confirm) => {
            const r = await wallet.setMarket(ai.id, { sale, rent, subscription }, confirm);
            await finish(r.txs);
          }}
        >
          ALT will write{" "}
          {[sale && `a sale price of ${polText(sale.price)}`, rent && `a rent of ${polText(rent.pricePerDay)} a day`, subscription && `a subscription of ${polText(subscription.pricePerMonth)} a month`]
            .filter(Boolean)
            .join(", ") || "the removal of your offers"}{" "}
          to the blockchain for {ai.name}.
        </ConfirmSpend>
      )}
    </div>
  );
}

function Offer({ title, on, onToggle, note, badge, children }) {
  return (
    <Card className={`p-6 transition ${on ? "" : "opacity-90"}`}>
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="flex items-center gap-2 font-display text-lg font-bold">
            {title} {badge}
          </span>
          <span className="mt-0.5 block text-sm text-ink-3">{note}</span>
        </span>
        <span className="relative mt-1 inline-flex shrink-0">
          <input type="checkbox" checked={on} onChange={onToggle} className="peer sr-only" />
          <span className="h-7 w-12 rounded-full bg-sunken transition peer-checked:bg-accent" />
          <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-surface shadow transition peer-checked:translate-x-5" />
        </span>
      </label>
      {on && <div className="animate-page-in mt-5">{children}</div>}
    </Card>
  );
}

const Amount = ({ label, value, onChange }) => (
  <label className="block text-sm font-semibold text-ink-2">
    {label}
    <span className="relative mt-1.5 block">
      <input inputMode="decimal" value={value} onChange={onChange} placeholder="0.0" className="h-12 w-full rounded-2xl border border-line bg-sunken/60 pl-4 pr-14 text-[15px] text-ink outline-none focus:border-ink/30" />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">POL</span>
    </span>
  </label>
);

const Line = ({ k, v }) => (
  <div className="flex justify-between gap-4">
    <dt className="text-ink-3">{k}</dt>
    <dd className="text-right font-semibold">{v}</dd>
  </div>
);
