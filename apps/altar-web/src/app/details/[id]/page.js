"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toModel } from "../../../contexts/AIContext";
import { useAuth } from "../../../contexts/AuthContext";
import { useWishlist } from "../../../contexts/WishlistContext";
import { useModal } from "../../../contexts/ModalContext";
import AiImage from "../../../components/AiImage";
import { auth, mediaUrl, publicApi } from "../../../lib/alt";

const NETWORKS = { 31337: "ALT local chain", 80002: "Polygon Amoy", 137: "Polygon" };
const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—");

export default function AgentDetails() {
  const { id: handle } = useParams();
  const { user } = useAuth();
  const { wishlist, addToWishlist } = useWishlist();
  const { showAlert } = useModal();
  const [model, setModel] = useState(null);
  const [missing, setMissing] = useState(false);
  const [chain, setChain] = useState(null);

  useEffect(() => {
    let live = true;
    publicApi(`/core/public/ais/${encodeURIComponent(handle)}`)
      .then((ai) => {
        if (!live) return;
        setModel(toModel(ai));
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
  }, [handle]);

  if (missing) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 pt-32">
        <p className="text-xl font-bold text-white/70">This AI isn&apos;t on ALTAR.</p>
        <p className="text-sm text-white/40">It may not be verified yet, or it was suspended.</p>
        <Link href="/" className="text-green-400 font-black uppercase tracking-widest text-xs">← Back to the marketplace</Link>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center pt-32">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const isOwner = Boolean(user && model.owner?.id === user.id);
  const isCreatorOwner = model.owner?.id === model.creator?.id;
  const saved = wishlist?.some((w) => w.agentId === model.id);
  const token = model.token;
  const onchainMatches = chain && !chain.error && token && chain.owner?.toLowerCase() === token.owner?.toLowerCase();

  const openInAlter = async () => {
    try {
      const { url } = await auth.handoffTo("alter");
      window.location.href = url;
    } catch {
      showAlert("ALTER", "Open the ALTER app on your phone to manage this AI.");
    }
  };

  return (
    <div className="bg-canvas min-h-screen pt-36 pb-24 font-sans text-white">
      <div className="max-w-6xl mx-auto px-6">
        <Link href="/" className="inline-flex items-center text-white/70 hover:text-green-400 font-bold mb-8 transition-colors uppercase tracking-widest text-xs">
          ← Back to the marketplace
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left column: picture and what you can do */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-black rounded-[32px] p-4 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.4)] relative">
              <div className="absolute inset-0 bg-gradient-to-br from-green-600/10 via-transparent to-green-400/10 rounded-[32px] pointer-events-none"></div>
              <div className="aspect-square rounded-2xl overflow-hidden bg-black relative">
                <AiImage model={model} textClassName="text-7xl" />
                {token && (
                  <div className="absolute top-4 right-4 bg-green-500 px-3 py-1 rounded-full shadow-lg">
                    <span className="text-[10px] font-black text-black uppercase tracking-wider">✓ Verified</span>
                  </div>
                )}
              </div>
            </div>

            {isOwner ? (
              <div className="bg-black p-8 rounded-3xl border border-green-500/30 shadow-[0_8px_30px_rgb(0,0,0,0.4)] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-600/10 to-transparent pointer-events-none"></div>
                <h3 className="font-black text-xl text-white mb-2 flex items-center gap-2 relative z-10">
                  <span className="text-green-400">✓</span> You own this AI
                </h3>
                <p className="text-xs text-white/70 font-medium mb-6 leading-relaxed relative z-10">
                  You hold its AI Identity Token. Its personality, knowledge and versions are managed in ALTER. Selling and renting it out open here soon.
                </p>
                <div className="space-y-3 relative z-10">
                  <button onClick={openInAlter} className="w-full flex items-center justify-center p-4 rounded-2xl bg-gradient-to-r from-green-600 to-green-400 text-white font-bold text-sm hover:shadow-lg hover:shadow-green-500/25 transition-all">
                    Manage in ALTER
                  </button>
                  <Link href="/profile" className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all">
                    My AIs
                  </Link>
                </div>
              </div>
            ) : (
              <div className="bg-black p-8 rounded-3xl border border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
                <h3 className="font-bold text-lg text-white mb-2">Licences</h3>
                <p className="text-xs text-white/60 font-medium mb-6">Buying, renting and subscribing open on ALTAR soon.</p>
                <div className="space-y-4">
                  {[
                    ["Full ownership", "The AIT moves to you"],
                    ["Rent", "Use it alone, for set days"],
                    ["Subscription", "Monthly access"],
                  ].map(([title, sub]) => (
                    <div key={title} className="w-full flex items-center justify-between p-5 rounded-2xl border border-white/5 bg-white/[0.02] opacity-60">
                      <div className="text-left">
                        <span className="block font-bold text-sm text-white/80">{title}</span>
                        <span className="text-[10px] text-white/40 uppercase tracking-widest">{sub}</span>
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Soon</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addToWishlist(model)}
                  className={`mt-6 w-full p-4 rounded-2xl border font-black text-xs uppercase tracking-widest transition-all ${saved ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-white text-black border-white hover:bg-green-400"}`}
                >
                  {saved ? "♥ On your wishlist" : "♡ Add to wishlist"}
                </button>
              </div>
            )}
          </div>

          {/* Right column: who it is and its proof */}
          <div className="lg:col-span-2 space-y-10">
            <div>
              <div className="inline-flex px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
                <span className="text-[10px] font-black text-green-400 uppercase tracking-widest">{model.category}</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-2">{model.name}</h1>
              <p className="text-sm text-white/40 font-bold mb-6">@{model.handle}</p>

              <div className="flex flex-wrap items-center gap-6 pb-8 border-b border-white/10">
                <Person label="Owner" person={model.owner} badge={isCreatorOwner ? "Creator" : null} />
                {!isCreatorOwner && <Person label="Creator" person={model.creator} />}
                <div className="flex items-center gap-3 border-l border-white/10 pl-6">
                  <Stat value={`${Math.round(model.healthScore)}%`} label="Health" />
                  <Stat value={`v${model.version ?? 1}`} label="Version" />
                </div>
              </div>

              <div className="py-8 border-b border-white/10 space-y-5">
                <h3 className="font-bold text-sm text-white uppercase tracking-widest">About</h3>
                <p className="text-sm text-white/80 leading-relaxed font-medium">{model.about || model.description || "No description yet."}</p>
                {[["Traits", model.traits], ["Interests", model.interests]].map(([label, list]) =>
                  list?.length ? (
                    <div key={label} className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/40 mr-2">{label}</span>
                      {list.map((x) => (
                        <span key={x} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-white/80">{x}</span>
                      ))}
                    </div>
                  ) : null,
                )}
              </div>

              <div className="mt-8 bg-green-500/5 border border-green-500/20 rounded-3xl p-6">
                <h4 className="font-bold text-sm mb-2 text-white flex items-center gap-2"><span>📜</span> Rules on-chain</h4>
                <p className="text-sm text-white/70 font-medium leading-relaxed">
                  Whoever holds the AI Identity Token owns this AI. On every resale, <b className="text-white">{(model.royaltyBps ?? 0) / 100}%</b> goes to its creator,{" "}
                  <span className="text-green-400 font-bold">{model.creatorName}</span>, automatically. A renter gets sole use for the days they pay for; ownership never moves.
                </p>
              </div>
            </div>

            {/* On-chain identity */}
            {token && (
              <div className="bg-black rounded-[32px] p-8 border border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                  <h3 className="font-bold text-xl text-white">AI Identity Token #{token.tokenId}</h3>
                  <span
                    className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${
                      !chain ? "border-white/10 text-white/40" : onchainMatches ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-orange-500/30 bg-orange-500/10 text-orange-400"
                    }`}
                  >
                    {!chain ? "Checking the chain…" : onchainMatches ? "✓ Checked on-chain just now" : "Couldn't confirm on-chain"}
                  </span>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 text-sm">
                  <Row k="Network" v={NETWORKS[token.chainId] ?? `Chain ${token.chainId}`} />
                  <Row k="Minted" v={new Date(token.mintedAt).toLocaleDateString()} />
                  <Row k="Owner wallet" v={short(chain?.owner ?? token.owner)} mono />
                  <Row k="Creator wallet" v={short(chain?.creator ?? token.creator)} mono />
                  <Row k="Contract" v={short(token.contract)} mono />
                  <Row k="On-chain version" v={`v${chain?.version ?? token.onchainVersion}`} />
                  {chain?.manifestCid && <Row k="Manifest (IPFS)" v={`${chain.manifestCid.slice(0, 14)}…`} mono />}
                  {chain?.manifestSha256 && <Row k="Manifest SHA-256" v={`${chain.manifestSha256.slice(0, 14)}…`} mono />}
                </dl>
                <div className="flex flex-wrap gap-3 mt-8">
                  <a href={mediaUrl(token.verifyUrl)} target="_blank" rel="noreferrer" className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white hover:border-green-500/40 transition-all">
                    Verify yourself ↗
                  </a>
                  {token.explorer && (
                    <a href={token.explorer} target="_blank" rel="noreferrer" className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white hover:border-green-500/40 transition-all">
                      Block explorer ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Person({ label, person, badge }) {
  const name = person?.displayName ?? "Unknown";
  const avatar = mediaUrl(person?.avatarUrl);
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-tr from-green-600 to-green-400 flex items-center justify-center font-black text-white">
        {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
      </div>
      <div>
        <p className="text-xs text-white/70 font-bold uppercase tracking-widest">{label}</p>
        <p className="font-black text-white">{name}</p>
        {badge && <span className="text-[9px] font-black uppercase tracking-widest text-green-400">{badge}</span>}
      </div>
    </div>
  );
}

const Stat = ({ value, label }) => (
  <div className="text-center px-3">
    <p className="font-black text-white text-lg">{value}</p>
    <p className="text-[9px] font-black uppercase tracking-widest text-white/40">{label}</p>
  </div>
);

const Row = ({ k, v, mono }) => (
  <div>
    <dt className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">{k}</dt>
    <dd className={`text-white/90 font-bold ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
  </div>
);
