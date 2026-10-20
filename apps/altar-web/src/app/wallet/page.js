"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AitArt from "../../components/AitArt";
import ConfirmSpend from "../../components/ConfirmSpend";
import LinkedWallets from "../../components/LinkedWallets";
import { Avatar, Button, Card, Chip, Shape, Spinner } from "../../components/ui";
import { CountUp } from "../../components/motion";
import { useAuth } from "../../contexts/AuthContext";
import { useAI } from "../../contexts/AIContext";
import { altar, continueWithAlt, mediaUrl, wallet as altWallet } from "../../lib/alt";
import { networkName, percent, polText, shortAddress, timeAgo } from "../../lib/format";
import { PageLoader } from "../../components/BrandLogo";

const FAUCET = "https://faucet.polygon.technology/";

// The ALT wallet every account has. ALT keeps its keys and signs for you after you confirm, so
// there is nothing to install. Balances are read live from the chain.
export default function WalletPage() {
  const { user } = useAuth();
  const { aiModels } = useAI();
  const [w, setW] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null); // "withdraw" | "send"
  const [send, setSend] = useState({ to: "", amount: "" });
  const [copied, setCopied] = useState(false);
  const [activity, setActivity] = useState(null);
  const [royalties, setRoyalties] = useState(null);

  const load = useCallback(async () => {
    try {
      setW(await altWallet.get());
      setError(null);
      altar
        .myActivity()
        .then(setActivity)
        .catch(() => setActivity([]));
      altar
        .myRoyalties()
        .then(setRoyalties)
        .catch(() => setRoyalties(null));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">Your ALT wallet</p>
        <p className="mt-2 text-ink-2">Sign in to see your balance, earnings and AI tokens.</p>
        <Button className="mt-6" onClick={() => continueWithAlt("signin", "/wallet").catch(() => {})}>
          Continue with ALT
        </Button>
      </div>
    );
  }

  const getTestFunds = async () => {
    setBusy("funds");
    setNotice(null);
    try {
      const r = await altWallet.testFunds();
      setNotice(`${polText(r.amount)} of test funds arrived. They only work on this test network.`);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(w.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address is on screen.
    }
  };

  if (error && !w) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="font-display text-2xl font-bold">Couldn&apos;t open your wallet</p>
        <p className="mt-2 text-ink-2">{error}</p>
        <Button className="mt-6" kind="outline" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }
  if (!w) {
    return (
      <PageLoader />
    );
  }

  const balance = Number(w.balance.pol);
  const earnings = Number(w.earnings.pol);
  const tokens = w.tokens.map((t) => ({ ...t, model: aiModels?.find((m) => m.id === t.aiId) }));

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-accent-text">Wallet</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Your ALT wallet</h1>
        </div>
        <Chip className="py-1">
          <span className="h-2 w-2 rounded-full bg-accent" /> {networkName(w.chainId)}
        </Chip>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Balance */}
        <div className="relative overflow-hidden rounded-[32px] bg-pop p-7 text-pop-ink sm:p-9">
          <Shape variant={0} className="absolute -right-16 -top-20 h-64 w-64 animate-morph text-accent opacity-90" />
          <Shape variant={1} className="absolute -bottom-10 right-28 h-24 w-24 animate-spin-slow text-b4 opacity-80" />
          <div className="relative">
            <p className="text-sm font-semibold opacity-70">Balance</p>
            <p className="mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
              <CountUp value={Math.round(balance * 10000) / 10000} />
              <span className="ml-2 text-2xl font-bold opacity-70">POL</span>
            </p>
            <button onClick={copy} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 font-mono text-sm hover:bg-white/20" title={w.address}>
              {copied ? "Copied" : shortAddress(w.address)}
            </button>
            <div className="mt-7 flex flex-wrap gap-2">
              {w.testFunds && (
                <button onClick={getTestFunds} disabled={busy === "funds"} className="inline-flex h-11 items-center rounded-full bg-accent px-5 font-semibold text-accent-ink transition hover:brightness-105 disabled:opacity-60">
                  {busy === "funds" ? "Sending…" : `Get ${polText(w.testFunds)} test funds`}
                </button>
              )}
              <button onClick={() => setDialog("send")} disabled={balance <= 0} className="inline-flex h-11 items-center rounded-full border border-white/25 px-5 font-semibold transition hover:bg-white/10 disabled:opacity-40">
                Send
              </button>
              {w.explorer && (
                <a href={w.explorer} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full border border-white/25 px-5 font-semibold transition hover:bg-white/10">
                  Explorer ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Earnings */}
        <Card className="flex flex-col p-7">
          <p className="text-sm font-semibold text-ink-3">Earnings from sales, rentals and royalties</p>
          <p className="mt-1 font-display text-4xl font-extrabold tracking-tight">{polText(w.earnings)}</p>
          <p className="mt-2 text-sm text-ink-2">They wait in the marketplace contract until you move them into your wallet.</p>
          <div className="mt-auto pt-6">
            <Button onClick={() => setDialog("withdraw")} disabled={earnings <= 0}>
              Withdraw to my wallet
            </Button>
            {w.platformFeeBps !== null && <p className="mt-3 text-xs text-ink-3">ALTAR keeps {percent(w.platformFeeBps)} of each sale or rental; creators get their royalty on resales.</p>}
          </div>
        </Card>
      </div>

      {notice && <p className="animate-page-in mt-5 rounded-2xl border border-line bg-surface px-5 py-4 text-ink-2">{notice}</p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Tokens */}
        <Card className="p-7">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">Your AI tokens</h2>
            <Link href="/list-ai" className="text-sm font-semibold text-accent-text hover:underline">
              List one →
            </Link>
          </div>
          {tokens.length === 0 ? (
            <p className="mt-3 text-ink-2">No AI tokens yet. Create an AI in ALTER and deploy it to mint its token.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {tokens.map((t) => (
                <li key={t.aiId}>
                  <Link href={`/details/${t.handle}`} className="group flex items-center gap-4 py-3">
                    <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                      <AitArt seed={t.model?.artSeed ?? t.handle} grain={false} />
                      <Avatar src={mediaUrl(t.avatarUrl)} name={t.name} size={26} className="absolute bottom-1 right-1 ring-2 ring-white/80" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold group-hover:underline">{t.name}</span>
                      <span className="block text-sm text-ink-3">AIT #{t.tokenId}</span>
                    </span>
                    <span className="text-sm font-semibold text-ink-2">{t.model?.listing?.sale ? polText(t.model.listing.sale.price) : t.model?.listing ? "Listed" : "Not listed"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Adding funds */}
        <Card className="p-7">
          <h2 className="font-display text-lg font-bold">Adding funds</h2>
          {w.testFunds ? (
            <p className="mt-2 text-ink-2">This is ALT&apos;s local test network. Its POL has no value: use &quot;Get test funds&quot; as often as you like to try buying and renting.</p>
          ) : (
            <p className="mt-2 text-ink-2">
              This is {networkName(w.chainId)}, a test network. Get free test POL from the{" "}
              <a href={FAUCET} target="_blank" rel="noreferrer" className="font-semibold text-accent-text underline underline-offset-4">
                Polygon faucet ↗
              </a>{" "}
              by pasting your wallet address.
            </p>
          )}
          <div className="mt-5 space-y-3 text-sm">
            <Row label="Network fees for listing" value="Paid by ALT" />
            <Row label="Send POL to MetaMask" value="Use Send, with your MetaMask address" />
            <Row label="Connect MetaMask" value="Below, under Your wallets" />
            <Row label="Buy POL with a card" value={<Chip tone="soon">Not planned for the FYP</Chip>} />
          </div>
        </Card>
      </div>

      <LinkedWallets />

      {royalties?.ais.length > 0 && (
        <Card className="mt-5 p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold">Royalties as a creator</h2>
            <p className="font-display text-2xl font-extrabold text-accent-text">{polText(royalties.total)}</p>
          </div>
          <p className="mt-1 text-sm text-ink-2">What you earned when AIs you made were resold, rented or subscribed to by their later owners. It arrives in your earnings above.</p>
          <ul className="mt-3 divide-y divide-line">
            {royalties.ais.map((r) => (
              <li key={r.aiId} className="flex items-center justify-between gap-4 py-3">
                <Link href={`/details/${r.handle}`} className="min-w-0 hover:underline">
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="text-sm text-ink-3">
                    {r.payments} {r.payments === 1 ? "payment" : "payments"} · last {timeAgo(r.lastAt)}
                  </span>
                </Link>
                <span className="font-semibold text-accent-text">+{polText(r.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5 p-7">
        <h2 className="font-display text-lg font-bold">Activity</h2>
        {activity === null ? (
          <Spinner className="mt-4" />
        ) : activity.length === 0 ? (
          <p className="mt-2 text-ink-2">Your purchases, sales, rentals and royalties will appear here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {activity.map((a) => {
              const [label, sign] = {
                bought: [`Bought ${a.ai?.name ?? "an AI"}`, "−"],
                sold: [`Sold ${a.ai?.name ?? "an AI"}`, "+"],
                rented: [`Rented ${a.ai?.name ?? "an AI"} for ${a.days} ${a.days === 1 ? "day" : "days"}`, "−"],
                rented_out: [`${a.ai?.name ?? "Your AI"} was rented for ${a.days} ${a.days === 1 ? "day" : "days"}`, "+"],
                subscribed: [`Subscribed to ${a.ai?.name ?? "an AI"} for ${a.months} ${a.months === 1 ? "month" : "months"}`, "−"],
                subscribed_out: [`New subscriber to ${a.ai?.name ?? "your AI"} (${a.months} ${a.months === 1 ? "month" : "months"})`, "+"],
                royalty: [`Royalty from ${a.ai?.name ?? "your AI"}`, "+"],
              }[a.role];
              // What reached (or left) this person: the seller's share after fee and royalty, the royalty itself, or the full price.
              const amount =
                a.role === "royalty"
                  ? a.royalty.pol
                  : a.role === "sold" || a.role === "rented_out" || a.role === "subscribed_out"
                    ? String(Number(a.amount.pol) - Number(a.fee.pol) - Number(a.royalty.pol))
                    : a.amount.pol;
              return (
                <li key={`${a.id}-${a.role}`} className="flex items-center gap-4 py-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold ${sign === "+" ? "bg-accent/15 text-accent-text" : "bg-sunken text-ink-2"}`}>{sign}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{label}</p>
                    <p className="text-sm text-ink-3">{timeAgo(a.occurredAt)}</p>
                  </div>
                  <span className={`font-semibold ${sign === "+" ? "text-accent-text" : ""}`}>
                    {sign}
                    {polText(amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {dialog === "withdraw" && (
        <ConfirmSpend title={`Withdraw ${polText(w.earnings)}`} action="Withdraw" intent={{ action: "withdraw" }} onClose={() => setDialog(null)} onConfirm={(confirm) => altWallet.withdraw(confirm)} onDone={(r) => (setNotice(`${polText(r.amount)} moved into your wallet.`), load())}>
          Your earnings move from the marketplace contract into your ALT wallet.
        </ConfirmSpend>
      )}
      {dialog === "send" && (
        <ConfirmSpend
          title="Send POL"
          action="Send"
          intent={{ action: "send", params: { to: send.to.trim(), amount: send.amount.trim() } }}
          onClose={() => setDialog(null)}
          onConfirm={(confirm) => altWallet.send(send.to.trim(), send.amount.trim(), confirm)}
          onDone={(r) => (setNotice(`${polText(r.amount)} sent to ${shortAddress(send.to.trim())}.`), setSend({ to: "", amount: "" }), load())}
        >
          <label className="block text-sm font-semibold">
            To (a wallet address, like your MetaMask)
            <input value={send.to} onChange={(e) => setSend({ ...send, to: e.target.value })} placeholder="0x…" className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-sunken/60 px-4 font-mono text-sm text-ink outline-none focus:border-ink/30" />
          </label>
          <label className="mt-3 block text-sm font-semibold">
            Amount (you have {polText(w.balance)})
            <input value={send.amount} onChange={(e) => setSend({ ...send, amount: e.target.value })} inputMode="decimal" placeholder="1.5" className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-sunken/60 px-4 text-ink outline-none focus:border-ink/30" />
          </label>
          <p className="mt-2 text-xs text-ink-3">A small network fee comes out of your balance too. Sending can&apos;t be undone.</p>
        </ConfirmSpend>
      )}
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 border-b border-line pb-3 last:border-0">
    <span className="text-ink-3">{label}</span>
    <span className="text-right font-semibold">{value}</span>
  </div>
);
