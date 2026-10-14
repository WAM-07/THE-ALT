"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toModel } from "../../../contexts/AIContext";
import { useAuth } from "../../../contexts/AuthContext";
import { useWishlist } from "../../../contexts/WishlistContext";
import { useModal } from "../../../contexts/ModalContext";
import AitArt from "../../../components/AitArt";
import { Avatar, Button, Card, Chip, Spinner, VerifiedTick } from "../../../components/ui";
import { useTilt } from "../../../components/motion";
import { altar, auth, continueWithAlt, conversations, mediaUrl, pictures, publicApi, wallet } from "../../../lib/alt";
import ConfirmSpend from "../../../components/ConfirmSpend";
import Reviews from "../../../components/Reviews";
import PicturePicker from "../../../components/PicturePicker";
import { useAI } from "../../../contexts/AIContext";
import { networkName, percent, polText, shortAddress, timeAgo } from "../../../lib/format";

const OFFERS = [
  ["own", "Own", "The AIT moves to your wallet, with every right."],
  ["rent", "Rent", "Sole use for the days you choose."],
  ["subscribe", "Subscribe", "Monthly access, shared with others."],
];

export default function AgentDetails() {
  const { id: handle } = useParams();
  const { user } = useAuth();
  const { wishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { showAlert } = useModal();
  const [model, setModel] = useState(null);
  const [missing, setMissing] = useState(false);
  const [chain, setChain] = useState(null);
  const [listing, setListing] = useState(null);
  const [activity, setActivity] = useState([]);
  const [access, setAccess] = useState(null);
  const [days, setDays] = useState(1);
  const [months, setMonths] = useState(1);
  const [checkout, setCheckout] = useState(null); // "buy" | "rent"
  const [notice, setNotice] = useState(null);
  // Bumped after a purchase or rental, to read everything again.
  const [version, setVersion] = useState(0);
  const router = useRouter();
  const [offer, setOffer] = useState("own");
  const [picking, setPicking] = useState(false);
  const { reload: reloadCatalog } = useAI();
  const tilt = useTilt(5);

  useEffect(() => {
    let live = true;
    publicApi(`/core/public/ais/${encodeURIComponent(handle)}?platform=altar`)
      .then((ai) => {
        if (!live) return;
        setModel(toModel(ai));
        altar
          .listing(ai.id)
          .then((l) => live && setListing(l))
          .catch(() => live && setListing(null));
        altar
          .activity(ai.id)
          .then((a) => live && setActivity(a))
          .catch(() => live && setActivity([]));
        // Read the token straight from the chain, so the page shows what is true right now.
        if (ai.token) {
          publicApi(`/core/verify/token/${ai.token.tokenId}`)
            .then((v) => live && setChain(v))
            .catch(() => live && setChain({ error: true }));
        }
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [handle, version]);

  // Whether the signed-in person may talk to it (owner, or renter until when).
  useEffect(() => {
    if (!user || !model?.id) return;
    let live = true;
    conversations
      .access(model.id)
      .then((a) => live && setAccess(a))
      .catch(() => live && setAccess(null));
    return () => {
      live = false;
    };
  }, [user, model?.id, version]);

  if (missing) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">This AI isn&apos;t on ALTAR</p>
        <p className="mt-2 text-ink-2">It may not be verified yet, or it was suspended.</p>
        <Button href="/" kind="outline" className="mt-6">
          Back to the marketplace
        </Button>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const isOwner = Boolean(user && model.owner?.id === user.id);
  const sameMaker = model.owner?.id === model.creator?.id;
  const saved = wishlist?.some((w) => w.agentId === model.id);
  const token = model.token;
  const onchainOk = chain && !chain.error && token && chain.owner?.toLowerCase() === token.owner?.toLowerCase();

  const openInAlter = async () => {
    try {
      const { url } = await auth.handoffTo("alter");
      window.location.href = url;
    } catch {
      showAlert("Open ALTER", "Open the ALTER app on your phone to manage this AI.");
    }
  };

  const savePicture = async ({ url, file }) => {
    if (file) await pictures.uploadForAi(model.id, file);
    else await pictures.chooseForAi(model.id, url);
    setModel(toModel(await publicApi(`/core/public/ais/${encodeURIComponent(handle)}?platform=altar`)));
    reloadCatalog();
  };

  // The price for the chosen way of holding it, from ALTAR's listing (a mirror of the contract).
  const price =
    offer === "own" && listing?.sale
      ? polText(listing.sale.price)
      : offer === "rent" && listing?.rent
        ? polText(listing.rent.pricePerDay)
        : offer === "subscribe" && listing?.subscription
          ? polText(listing.subscription.pricePerMonth)
          : null;

  const traits = [
    ["Category", model.category],
    ["Version", `v${model.version ?? 1}`],
    ["Health", `${Math.round(model.healthScore ?? 0)}%`],
    ["Creator royalty", percent(model.royaltyBps)],
    ...(model.traits ?? []).slice(0, 4).map((t) => ["Trait", t]),
    ...(model.interests ?? []).slice(0, 4).map((t) => ["Interest", t]),
  ];

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-6 sm:px-6 lg:pt-10">
      {checkout === "buy" && listing?.sale && (
        <ConfirmSpend
          title={`Buy ${model.name}`}
          action={`Pay ${polText(listing.sale.price)}`}
          intent={{ action: "buy", ai: { id: model.id, handle: model.handle }, params: { price: listing.sale.price.pol } }}
          onClose={() => setCheckout(null)}
          onConfirm={(confirm) => wallet.buy(model.id, confirm, listing.sale.price.pol)}
          onDone={() => {
            setNotice(null);
            reloadCatalog();
            setVersion((v) => v + 1);
          }}
        >
          You pay <b className="text-ink">{polText(listing.sale.price)}</b> from your ALT wallet and {model.name}&apos;s identity token moves to you, with every right. ALT pays the network fee.
        </ConfirmSpend>
      )}
      {checkout === "rent" && listing?.rent && (
        <ConfirmSpend
          title={`Rent ${model.name}`}
          action={`Pay ${polText(String(Number(listing.rent.pricePerDay.pol) * days))}`}
          intent={{ action: "rent", ai: { id: model.id, handle: model.handle }, params: { days, pricePerDay: listing.rent.pricePerDay.pol } }}
          onClose={() => setCheckout(null)}
          onConfirm={(confirm) => wallet.rent(model.id, days, confirm, listing.rent.pricePerDay.pol)}
          onDone={() => router.push(`/chat/${model.handle}`)}
        >
          You pay <b className="text-ink">{polText(String(Number(listing.rent.pricePerDay.pol) * days))}</b> for {days} {days === 1 ? "day" : "days"} of sole use. You can talk to {model.name} on ALTAR until then; the owner keeps the token.
        </ConfirmSpend>
      )}
      {checkout === "subscribe" && listing?.subscription && (
        <ConfirmSpend
          title={`Subscribe to ${model.name}`}
          action={`Pay ${polText(String(Number(listing.subscription.pricePerMonth.pol) * months))}`}
          intent={{ action: "subscribe", ai: { id: model.id, handle: model.handle }, params: { months, pricePerMonth: listing.subscription.pricePerMonth.pol } }}
          onClose={() => setCheckout(null)}
          onConfirm={(confirm) => wallet.subscribe(model.id, months, confirm, listing.subscription.pricePerMonth.pol)}
          onDone={() => router.push(`/chat/${model.handle}`)}
        >
          You pay <b className="text-ink">{polText(String(Number(listing.subscription.pricePerMonth.pol) * months))}</b> for {months} {months === 1 ? "month" : "months"} (30 days each). You can talk to {model.name} on ALTAR until then, alongside other subscribers; renewing adds to your time.
        </ConfirmSpend>
      )}
      {picking && <PicturePicker kind="ai" title={`${model.name}'s picture`} name={model.name} current={model.image} onClose={() => setPicking(false)} onSave={savePicture} />}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ink-3" aria-label="Breadcrumb">
        <Link href="/#explore" className="hover:text-ink">
          Explore
        </Link>
        <span>/</span>
        <span className="truncate text-ink-2">{model.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
        {/* The token: its artwork with the AI's picture on top */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div {...tilt} className="tilt animate-rise rounded-[32px] border border-line bg-surface p-3 shadow-card">
            <div className="relative aspect-square overflow-hidden rounded-[24px]">
              <span className="tilt-shine absolute inset-0 z-10" />
              <AitArt seed={model.artSeed} motion="always" />
              {token && <Chip tone="glass" className="absolute left-4 top-4 py-1">AIT #{token.tokenId}</Chip>}
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl bg-black/45 p-3 text-white backdrop-blur-md">
                <Avatar src={model.image} name={model.name} size={52} className="ring-2 ring-white/70" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-display text-lg font-bold">
                    <span className="truncate">{model.name}</span>
                    <VerifiedTick />
                  </p>
                  <p className="truncate text-sm text-white/70">@{model.handle}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Who it is, how to get it, and its proof */}
        <div className="min-w-0 space-y-6">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Chip tone="accent">
                <VerifiedTick className="h-3.5 w-3.5" /> Verified AI
              </Chip>
              <Chip>{model.category}</Chip>
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{model.name}</h1>
            <p className="mt-1 text-ink-3">@{model.handle}</p>
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
              <Person label={sameMaker ? "Creator and owner" : "Owner"} person={model.owner} you={isOwner} />
              {!sameMaker && <Person label="Creator" person={model.creator} you={user && model.creator?.id === user.id} />}
            </div>
          </div>

          {(access?.role === "renter" || access?.role === "subscriber") && (
            <Card className="animate-page-in flex flex-wrap items-center justify-between gap-4 border-accent/40 bg-accent/10 p-6">
              <div>
                <p className="font-display text-xl font-bold">
                  {access.role === "renter" ? "You're renting" : "You're subscribed to"} {model.name}
                </p>
                <p className="mt-1 text-ink-2">Talk to it until {new Date(access.until).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</p>
              </div>
              <Button href={`/chat/${model.handle}`}>Chat now</Button>
            </Card>
          )}

          {isOwner ? (
            <Card style={{ animationDelay: "120ms" }} className="animate-rise p-6">
              <p className="font-display text-xl font-bold">You own this AI</p>
              <p className="mt-2 text-ink-2">
                You hold its AI Identity Token, so you can talk to it any time. Its personality, knowledge and versions are managed in ALTER.{" "}
                {listing ? "It's listed on ALTAR:" : "It isn't listed yet."}
              </p>
              {listing && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {listing.sale && <Chip tone="accent">For sale · {polText(listing.sale.price)}</Chip>}
                  {listing.rent && <Chip tone="accent">For rent · {polText(listing.rent.pricePerDay, " / day")}</Chip>}
                  {listing.subscription && <Chip>Subscription · {polText(listing.subscription.pricePerMonth, " / month")}</Chip>}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button href={`/chat/${model.handle}`}>Chat now</Button>
                <Button href={`/list-ai?ai=${model.id}`} kind="outline">
                  {listing ? "Edit listing" : "List it"}
                </Button>
                <Button kind="outline" onClick={openInAlter}>
                  Manage in ALTER
                </Button>
                <Button kind="outline" onClick={() => setPicking(true)}>
                  Change picture
                </Button>
                <Button href="/profile" kind="outline">
                  My AIs
                </Button>
              </div>
            </Card>
          ) : (
            <Card style={{ animationDelay: "210ms" }} className="animate-rise p-2">
              <div className="relative grid grid-cols-3 gap-1 rounded-[20px] bg-sunken p-1" role="tablist" aria-label="Ways to hold this AI">
                <span
                  className="absolute inset-y-1 left-1 w-[calc((100%-1rem)/3)] rounded-2xl bg-surface shadow-sm transition-transform duration-300 ease-out"
                  style={{ transform: `translateX(calc(${OFFERS.findIndex(([id]) => id === offer)} * (100% + 0.25rem)))` }}
                  aria-hidden="true"
                />
                {OFFERS.map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={offer === id}
                    onClick={() => setOffer(id)}
                    className={`relative h-10 rounded-2xl text-sm font-semibold transition-colors ${offer === id ? "text-ink" : "text-ink-2 hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-4 sm:p-5">
                <p key={offer} className="animate-rise text-sm text-ink-2">
                  {OFFERS.find(([id]) => id === offer)[2]}
                </p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-ink-3">{offer === "own" ? "Price" : offer === "rent" ? "Per day" : "Per month"}</p>
                    <p key={offer} className={`animate-rise font-display text-3xl font-bold ${price ? "text-ink" : "text-ink-3"}`}>
                      {price ?? "Not offered"}
                    </p>
                    {offer === "rent" && listing?.rent && <p className="mt-1 text-sm text-ink-3">Up to {listing.rent.maxDays} days</p>}
                    {offer === "subscribe" && listing?.subscription && listing.activeSubscribers > 0 && (
                      <p className="mt-1 text-sm text-ink-3">
                        {listing.activeSubscribers} {listing.activeSubscribers === 1 ? "person subscribes" : "people subscribe"} now
                      </p>
                    )}
                  </div>
                </div>
                {offer === "subscribe" && listing?.subscription && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken/60 p-3">
                    <div className="flex items-center gap-2" role="group" aria-label="Months">
                      <button onClick={() => setMonths((m) => Math.max(1, m - 1))} className="h-9 w-9 rounded-full border border-line bg-surface font-bold" aria-label="One month less">
                        −
                      </button>
                      <span className="min-w-24 text-center font-semibold">
                        {months} {months === 1 ? "month" : "months"}
                      </span>
                      <button onClick={() => setMonths((m) => Math.min(12, m + 1))} className="h-9 w-9 rounded-full border border-line bg-surface font-bold" aria-label="One month more">
                        +
                      </button>
                    </div>
                    <p className="text-sm text-ink-2">
                      Total <b className="text-ink">{polText(String(Number(listing.subscription.pricePerMonth.pol) * months))}</b>
                    </p>
                  </div>
                )}
                {offer === "rent" && listing?.rent && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken/60 p-3">
                    <div className="flex items-center gap-2" role="group" aria-label="Days">
                      <button onClick={() => setDays((d) => Math.max(1, d - 1))} className="h-9 w-9 rounded-full border border-line bg-surface font-bold" aria-label="One day less">
                        −
                      </button>
                      <span className="min-w-20 text-center font-semibold">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                      <button onClick={() => setDays((d) => Math.min(listing.rent.maxDays, d + 1))} className="h-9 w-9 rounded-full border border-line bg-surface font-bold" aria-label="One day more">
                        +
                      </button>
                    </div>
                    <p className="text-sm text-ink-2">
                      Total <b className="text-ink">{polText(String(Number(listing.rent.pricePerDay.pol) * days))}</b>
                    </p>
                  </div>
                )}
                {notice && <p className="animate-page-in mt-4 rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-2">{notice}</p>}
                <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
                  <Button
                    size="lg"
                    disabled={!price || (offer === "rent" && access?.role === "renter")}
                    onClick={() => (user ? setCheckout({ own: "buy", rent: "rent", subscribe: "subscribe" }[offer]) : continueWithAlt("signin", `/details/${model.handle}`).catch(() => {}))}
                  >
                    {!user && price ? "Sign in to " : ""}
                    {offer === "own"
                      ? user && price
                        ? `Buy for ${price}`
                        : "Buy"
                      : offer === "rent"
                        ? user && price
                          ? `Rent for ${days} ${days === 1 ? "day" : "days"}`
                          : "Rent"
                        : user && price
                          ? `Subscribe for ${months} ${months === 1 ? "month" : "months"}`
                          : "Subscribe"}
                  </Button>
                  <Button
                    kind="outline"
                    size="lg"
                    onClick={() => (saved ? removeFromWishlist(model.id) : addToWishlist(model))}
                    aria-pressed={saved}
                    aria-label={saved ? "Remove from saved" : "Save"}
                    className="w-13 shrink-0 px-0!"
                  >
                    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${saved ? "text-rose-500" : ""}`} fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2">
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
                    </svg>
                  </Button>
                </div>
                {listing?.pitch && <p className="mt-4 text-[15px] font-medium">“{listing.pitch}”</p>}
                {listing?.terms && <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{listing.terms}</p>}
                <p className="mt-4 text-xs leading-relaxed text-ink-3">
                  Whenever a later owner sells, rents out or takes subscriptions for it, {percent(model.royaltyBps)} goes to the creator, {model.creatorName}, automatically.
                </p>
              </div>
            </Card>
          )}

          <Card style={{ animationDelay: "300ms" }} className="animate-rise p-6">
            <h2 className="font-display text-lg font-bold">About</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-2">{model.description || model.about || "No description yet."}</p>
            {model.description && model.about && model.about !== model.description && <p className="mt-3 text-sm leading-relaxed text-ink-3">Its creator: {model.about}</p>}
          </Card>

          <Reviews ai={model} onChange={reloadCatalog} />

          <Card style={{ animationDelay: "390ms" }} className="animate-rise p-6">
            <h2 className="font-display text-lg font-bold">Traits</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {traits.map(([k, v], i) => (
                <div key={`${k}-${i}`} className="rounded-2xl bg-sunken/60 px-4 py-3">
                  <p className="text-xs font-medium text-ink-3">{k}</p>
                  <p className="mt-0.5 truncate font-semibold">{v}</p>
                </div>
              ))}
            </div>
          </Card>

          {token && (
            <Card style={{ animationDelay: "480ms" }} className="animate-rise p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">AI Identity Token #{token.tokenId}</h2>
                <Chip tone={!chain ? "plain" : onchainOk ? "accent" : "warn"}>{!chain ? "Checking the chain…" : onchainOk ? "✓ Checked on-chain just now" : "Couldn't confirm on-chain"}</Chip>
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <Row k="Network" v={networkName(token.chainId)} />
                <Row k="Minted" v={new Date(token.mintedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} />
                <Row k="Owner wallet" v={shortAddress(chain?.owner ?? token.owner)} mono />
                <Row k="Creator wallet" v={shortAddress(chain?.creator ?? token.creator)} mono />
                <Row k="Contract" v={shortAddress(token.contract)} mono />
                <Row k="On-chain version" v={`v${chain?.version ?? token.onchainVersion}`} />
                {chain?.manifestCid && <Row k="Manifest (IPFS)" v={`${chain.manifestCid.slice(0, 16)}…`} mono />}
                {chain?.manifestSha256 && <Row k="Manifest SHA-256" v={`${chain.manifestSha256.slice(0, 16)}…`} mono />}
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button href={mediaUrl(token.verifyUrl)} kind="outline" size="sm" target="_blank" rel="noreferrer">
                  Verify it yourself ↗
                </Button>
                {token.explorer && (
                  <Button href={token.explorer} kind="outline" size="sm" target="_blank" rel="noreferrer">
                    Block explorer ↗
                  </Button>
                )}
              </div>
            </Card>
          )}

          {token && (
            <Card style={{ animationDelay: "570ms" }} className="animate-rise p-6">
              <h2 className="font-display text-lg font-bold">Activity</h2>
              {activity.map((a) => (
                <div key={a.id} className="mt-3 flex items-center gap-4 rounded-2xl bg-sunken/60 p-4 text-sm">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold ${a.kind === "sale" ? "bg-pop text-pop-ink" : "bg-b3 text-white"}`}>{a.kind === "sale" ? "⇄" : "⏱"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {a.kind === "sale" ? `Sold to ${a.to.name ?? shortAddress(a.to.address)}` : `Rented by ${a.to.name ?? shortAddress(a.to.address)} for ${a.days} ${a.days === 1 ? "day" : "days"}`} · {polText(a.amount)}
                    </p>
                    <p className="truncate text-ink-3">
                      {a.kind === "sale" ? `from ${a.from.name ?? shortAddress(a.from.address)}` : `from ${a.from.name ?? shortAddress(a.from.address)}`}
                      {Number(a.royalty.pol) > 0 && ` · ${polText(a.royalty)} royalty to the creator`}
                    </p>
                  </div>
                  <span className="shrink-0 text-ink-3">{timeAgo(a.occurredAt)}</span>
                </div>
              ))}
              <div className="mt-3 flex items-center gap-4 rounded-2xl bg-sunken/60 p-4 text-sm">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-ink">✦</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Minted by {model.creatorName}</p>
                  <p className="truncate text-ink-3">{token.mintTxExplorer ? <a href={token.mintTxExplorer} target="_blank" rel="noreferrer" className="font-mono hover:underline">{shortAddress(token.mintTx)} ↗</a> : <span className="font-mono">{shortAddress(token.mintTx)}</span>}</p>
                </div>
                <span className="shrink-0 text-ink-3">{timeAgo(token.mintedAt)}</span>
              </div>
              <p className="mt-3 text-xs text-ink-3">Read from the marketplace contract&apos;s events.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Person({ label, person, you }) {
  const name = person?.displayName ?? "Unknown";
  const Wrap = person?.handle ? Link : "div";
  return (
    <Wrap {...(person?.handle ? { href: `/creator/${person.handle}` } : {})} className="group flex items-center gap-3">
      <Avatar src={mediaUrl(person?.avatarUrl)} name={name} size={44} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-3">{label}</p>
        <p className="truncate font-semibold group-hover:underline">
          {name}
          {you && <span className="ml-1.5 text-sm font-medium text-accent-text">(you)</span>}
        </p>
      </div>
    </Wrap>
  );
}

const Row = ({ k, v, mono }) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium text-ink-3">{k}</dt>
    <dd className={`mt-0.5 truncate font-semibold ${mono ? "font-mono text-[13px]" : ""}`}>{v}</dd>
  </div>
);
