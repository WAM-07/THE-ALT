"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import { useModal } from "../../contexts/ModalContext";
import { useAI, toModel } from "../../contexts/AIContext";
import { useWishlist } from "../../contexts/WishlistContext";
import AICard from "../../components/AICard";
import AitArt from "../../components/AitArt";
import { Avatar, Button, Chip, Empty, Spinner, btnClass } from "../../components/ui";
import { altar, api, auth, continueWithAlt, pictures } from "../../lib/alt";
import PicturePicker from "../../components/PicturePicker";
import { shortAddress } from "../../lib/format";

const STATUS = {
  verified: ["Verified", "accent"],
  draft: ["Draft in ALTER", "plain"],
  training: ["Building", "plain"],
  ready: ["Ready to mint", "warn"],
  minting: ["Minting", "warn"],
  retired: ["Retired", "plain"],
  suspended: ["Suspended", "warn"],
};

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <Profile />
    </Suspense>
  );
}

// The signed-in person's ALT account: the AIs they own and the ones they saved.
function Profile() {
  const { user } = useAuth();
  const { showAlert } = useModal();
  const { aiModels } = useAI();
  const { wishlist, removeFromWishlist } = useWishlist();
  const params = useSearchParams();
  const router = useRouter();
  const tab = ["saved", "rented"].includes(params.get("tab")) ? params.get("tab") : "owned";
  const [rentals, setRentals] = useState(null);
  const [ais, setAis] = useState(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

  // AIs the person is renting right now (from ALTAR's record of the contract's events).
  useEffect(() => {
    if (!user) return;
    altar
      .myRentals()
      .then(setRentals)
      .catch(() => setRentals([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api("/core/ais")
      .then((list) => setAis(list.map(toModel)))
      .catch(() => setAis([]));
  }, [user]);

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">Sign in to see your AIs</p>
        <p className="mt-2 text-ink-2">Use your ALT account, the same one as ALTER and ALTERA.</p>
        <Button className="mt-6" onClick={() => continueWithAlt("signin", "/profile").catch(() => {})}>
          Continue with ALT
        </Button>
      </div>
    );
  }

  const open = async (target, name) => {
    try {
      const { url } = await auth.handoffTo(target);
      window.location.href = url;
    } catch {
      showAlert(`Open ${name}`, `Open the ${name} app on your phone.`);
    }
  };
  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(user.wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address is still on screen.
    }
  };

  const verifiedCount = ais?.filter((a) => a.verified).length ?? 0;
  const savedModels = wishlist.map((w) => ({ item: w, model: aiModels?.find((m) => m.id === w.agentId) }));
  const setTab = (t) => router.replace(t === "owned" ? "/profile" : `/profile?tab=${t}`, { scroll: false });

  return (
    <div className="pb-24">
      <div className="relative h-40 overflow-hidden sm:h-56">
        <AitArt seed={`person:${user.id}`} motion="always" className="h-full w-full" />
      </div>
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button onClick={() => setPicking(true)} className="group/pic relative -mt-14 block rounded-full" aria-label="Change your picture">
              <Avatar src={user.picture} name={user.name} size={112} className="ring-[6px] ring-canvas" />
              <span className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-canvas bg-pop text-pop-ink transition group-hover/pic:scale-110">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
                </svg>
              </span>
            </button>
            {picking && (
              <PicturePicker
                kind="human"
                title="Your picture"
                name={user.name}
                current={user.picture}
                onClose={() => setPicking(false)}
                onSave={({ url, file }, scope) => {
                  const where = { altarOnly: scope === "altar" };
                  return file ? pictures.upload(file, where) : pictures.choose(url, where);
                }}
                onUseGlobal={user.hasAltarPicture ? () => pictures.choose(null, { altarOnly: true }) : undefined}
              />
            )}
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">{user.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-3">
              <span>@{user.handle}</span>
              {user.wallet?.address && (
                <button onClick={copyWallet} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 font-mono text-xs text-ink-2 hover:text-ink" title={user.wallet.address}>
                  {copied ? "Copied" : shortAddress(user.wallet.address)}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind="outline" size="sm" onClick={() => open("alter", "ALTER")}>
              Open ALTER
            </Button>
            <Button kind="outline" size="sm" onClick={() => open("altera", "ALTERA")}>
              Open ALTERA
            </Button>
            <Link href="/wallet" className={btnClass("outline", "sm")}>
              Wallet
            </Link>
            <Link href="/settings" className={btnClass("outline", "sm")} aria-label="Settings">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-8 flex gap-6 border-b border-line" role="tablist">
          {[
            ["owned", "My AIs", ais?.length],
            ["saved", "Saved", wishlist.length],
            ["rented", "Rented", rentals?.length],
          ].map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 pb-3 text-[15px] font-semibold transition ${tab === id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}
            >
              {label}
              {count > 0 && <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-2">{count}</span>}
            </button>
          ))}
        </div>

        <div className="pt-8">
          {tab === "owned" ? (
            ais === null ? (
              <Spinner />
            ) : ais.length === 0 ? (
              <Empty title="You don't have an AI yet" action={<Button onClick={() => open("alter", "ALTER")}>Create one in ALTER</Button>}>
                AIs are created and trained in ALTER. Once verified with an AI Identity Token, they appear here and can be listed.
              </Empty>
            ) : (
              <>
                <p className="mb-6 text-ink-2">
                  {verifiedCount} of {ais.length} verified. Drafts stay in ALTER until they&apos;re minted.
                </p>
                <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                  {ais.map((ai) =>
                    ai.verified ? (
                      // The public listing knows the creator's name; fall back to the account's own copy.
                      <AICard key={ai.id} model={aiModels?.find((m) => m.id === ai.id) ?? { ...ai, owner: { id: user.id }, creatorName: "you" }} />
                    ) : (
                      <DraftCard key={ai.id} ai={ai} />
                    ),
                  )}
                </div>
              </>
            )
          ) : tab === "rented" ? (
            rentals === null ? (
              <Spinner />
            ) : rentals.length === 0 ? (
              <Empty title="Not renting anything" action={<Button href="/#explore">Find an AI to rent</Button>}>
                Rent an AI for a few days to talk to it on ALTAR. The owner keeps it; you get it to yourself.
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                {rentals.map((r) => {
                  const model = aiModels?.find((m) => m.id === r.ai?.id);
                  return (
                    <Link key={r.id} href={`/chat/${r.ai?.handle}`} className="group overflow-hidden rounded-3xl border border-line bg-surface transition hover:-translate-y-1 hover:shadow-card">
                      <div className="relative h-28">
                        <AitArt seed={model?.artSeed ?? r.ai?.handle} />
                        <Avatar src={model?.image} name={r.ai?.name} size={52} className="absolute -bottom-6 left-4 ring-4 ring-surface" />
                      </div>
                      <div className="p-4 pt-8">
                        <p className="truncate font-display text-lg font-bold">{r.ai?.name}</p>
                        <p className="text-sm text-ink-3">Until {new Date(r.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
                        <p className="mt-3 text-sm font-semibold text-accent-text">Chat now →</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )
          ) : savedModels.length === 0 ? (
            <Empty title="Nothing saved yet" action={<Button href="/#explore">Explore AIs</Button>}>
              Tap the heart on an AI to keep an eye on it. Saved AIs are kept in this browser for your ALT account.
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
              {savedModels.map(({ item, model }) =>
                model ? (
                  <AICard key={item.id} model={model} />
                ) : (
                  <div key={item.id} className="flex flex-col justify-between rounded-3xl border border-dashed border-line p-5">
                    <div>
                      <p className="font-display text-lg font-bold">{item.agentName ?? "This AI"}</p>
                      <p className="mt-1 text-sm text-ink-3">No longer on ALTAR.</p>
                    </div>
                    <button onClick={() => removeFromWishlist(item.agentId)} className="mt-4 self-start text-sm font-semibold text-ink-2 hover:text-ink">
                      Remove
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({ ai }) {
  const [label, tone] = STATUS[ai.status] ?? [ai.status, "plain"];
  return (
    <div className="rounded-3xl border border-dashed border-line p-2">
      <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-[20px] bg-sunken/70 text-center">
        <Avatar src={ai.image} name={ai.name} size={64} />
        <Chip tone={tone}>{label}</Chip>
      </div>
      <div className="px-2 pb-2 pt-3">
        <p className="truncate font-display text-[17px] font-bold">{ai.name}</p>
        <p className="truncate text-sm text-ink-3">@{ai.handle} · not on ALTAR yet</p>
      </div>
    </div>
  );
}
