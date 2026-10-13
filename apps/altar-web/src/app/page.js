"use client";
import { useState, useMemo, useEffect } from "react";
import { useAI } from "../contexts/AIContext";
import { useAuth } from "../contexts/AuthContext";
import AICard from "../components/AICard";
import AiImage from "../components/AiImage";
import Link from "next/link";

/** Fixed scatter for the decorative stars (the same on every render). */
const noise = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export default function Home() {
  const { aiModels, error } = useAI();
  const { user } = useAuth();
  const [activeCategory, setSearchCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("marketplace");
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Categories come from the AIs themselves.
  const categories = useMemo(() => ["All", ...new Set((aiModels ?? []).map((m) => m.category))], [aiModels]);

  const filteredModels = useMemo(() => {
    if (!aiModels) return [];
    const q = searchQuery.trim().toLowerCase();
    return aiModels.filter((model) => {
      if (viewMode === "my_listings" && model.owner?.id !== user?.id) return false;
      if (activeCategory !== "All" && model.category !== activeCategory) return false;
      if (!q) return true;
      return [model.name, model.handle, model.category, model.description, model.creatorName, model.ownerName]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [aiModels, viewMode, user, activeCategory, searchQuery]);

  if (!mounted) return null;

  if (!aiModels) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#1dbf73] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#62646a] font-bold animate-pulse">Loading verified AIs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black min-h-screen font-sans text-white selection:bg-green-500/30">
      <section className="relative pt-40 pb-28 px-6 overflow-hidden">
        {/* Animated Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-20 pointer-events-none"></div>

        {/* Aesthetic Blinking Data Nodes (Stars) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-15">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-green-500 rounded-full animate-flicker opacity-20"
              style={{
                top: `${noise(i, 1) * 100}%`,
                left: `${noise(i, 2) * 100}%`,
                animationDelay: `${noise(i, 3) * 5}s`,
                animationDuration: `${2 + noise(i, 4) * 3}s`
              }}
            ></div>
          ))}
        </div>

        <div className="max-w-[1400px] mx-auto text-center relative z-10 pt-12 pb-24">
          {/* Cybernetic Machine Cores - Clean Visuals */}
          <div className="hidden lg:block absolute left-4 top-1/2 -translate-y-1/2 w-48 h-64 pointer-events-none group/machine">
            <div className="relative w-full h-full border border-white/10 rounded-3xl bg-black/40 backdrop-blur-xl shadow-[0_0_40px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.05)_0%,transparent_70%)]"></div>
              {/* Rotating Mechanical Core */}
              <div className="absolute top-12 left-1/2 -translate-x-1/2 w-24 h-24">
                <div className="absolute inset-0 border-4 border-dashed border-white/5 rounded-full animate-[spin_10s_linear_infinite]"></div>
                <div className="absolute inset-2 border-2 border-green-500/20 rounded-full animate-[spin-reverse_5s_linear_infinite]"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-flicker shadow-[0_0_20px_rgba(34,197,94,1)]"></div>
                </div>
              </div>
              {/* Status Lines - Text Removed */}
              <div className="absolute bottom-12 left-6 right-6 space-y-4">
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500/50 animate-[ping_2s_linear_infinite] origin-left"></div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-2 bg-white/10 rounded-sm animate-flicker" style={{ animationDelay: `${i * 0.2}s` }}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="hidden lg:block absolute right-4 top-1/2 -translate-y-1/2 w-48 h-64 pointer-events-none group/machine">
            <div className="relative w-full h-full border border-white/10 rounded-3xl bg-black/40 backdrop-blur-xl shadow-[0_0_40px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.05)_0%,transparent_70%)]"></div>
              {/* Vertical Uplink Machine */}
              <div className="absolute top-12 left-6 right-6 h-32 flex justify-between items-end">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 bg-gradient-to-t from-green-500/40 to-transparent rounded-full animate-pulse"
                    style={{ height: `${30 + noise(i, 5) * 70}%`, animationDelay: `${i * 0.3}s` }}
                  ></div>
                ))}
              </div>
              {/* Status Nodes - Text Removed */}
              <div className="absolute bottom-12 left-6 right-6">
                <div className="flex gap-2">
                  <div className="flex-1 h-1.5 bg-green-500 animate-flicker"></div>
                  <div className="flex-1 h-1.5 bg-white/10"></div>
                  <div className="flex-1 h-1.5 bg-green-500 animate-flicker [animation-delay:0.4s]"></div>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                  <div className="flex-1 h-[1px] bg-white/10"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Global AI Nucleus - Re-scaled to be more compact */}
          <div className="relative w-[300px] h-[300px] md:w-[480px] md:h-[480px] mx-auto flex flex-col items-center justify-center animate-fade-in-up">
            {/* Rotating Atomic Orbitals - Scaled Down */}
            <div className="absolute inset-[-30px] rounded-full border border-white/5 animate-[spin_15s_linear_infinite] opacity-20">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-green-500 rounded-full shadow-[0_0_15px_rgba(34,197,94,1)] animate-pulse"></div>
            </div>
            <div className="absolute inset-[-15px] rounded-full border border-white/5 animate-[spin-reverse_25s_linear_infinite] opacity-20">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_15px_rgba(34,197,94,1)]"></div>
            </div>
            <div className="absolute inset-8 rounded-full border border-white/5 animate-[spin_35s_linear_infinite] opacity-10">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-green-300 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.8)]"></div>
            </div>

            {/* Core Nucleus Glow */}
            <div className="absolute inset-0 rounded-full border border-white/5 bg-white/[0.01] backdrop-blur-[1px] shadow-[0_0_60px_rgba(34,197,94,0.03)]"></div>

            {/* Pulsing Neural Core */}
            <div className="absolute inset-[25%] rounded-full bg-gradient-to-br from-green-500/5 to-transparent border border-green-500/10 animate-pulse"></div>

            <div className="relative z-20 flex flex-col items-center">
              <h1 className="text-3xl md:text-[64px] font-black tracking-tighter text-white mb-6 leading-[0.95] flex flex-col items-center group">
                <span className="opacity-40 block mb-3 text-sm md:text-base uppercase tracking-[0.6em] animate-fade-in-up [animation-delay:200ms]">Own the</span>
                <span className="relative inline-block text-transparent bg-clip-text bg-gradient-to-r from-green-300 via-green-500 to-emerald-500 animate-text-shimmer drop-shadow-[0_0_20px_rgba(34,197,94,0.3)] px-4">
                  Future of AI
                  <div className="absolute -bottom-1 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-green-500/50 to-transparent animate-scanline"></div>
                </span>
              </h1>

              <div className="max-w-md px-10 animate-fade-in-up [animation-delay:600ms]">
                <div className="relative py-6">
                  {/* Glowing Corner Accents */}
                  <div className="absolute left-0 top-0 w-8 h-[1px] bg-gradient-to-r from-green-500 to-transparent"></div>
                  <div className="absolute left-0 top-0 w-[1px] h-8 bg-gradient-to-b from-green-500 to-transparent"></div>
                  <div className="absolute right-0 bottom-0 w-8 h-[1px] bg-gradient-to-l from-green-500 to-transparent"></div>
                  <div className="absolute right-0 bottom-0 w-[1px] h-8 bg-gradient-to-t from-green-500 to-transparent"></div>

                  <p className="text-[10px] md:text-[12px] font-black text-white/60 uppercase tracking-[0.45em] leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    A Marketplace Where You Can <br />
                    <span className="text-green-400">Buy, Sell, and Rent</span> <br />
                    Your AI Agents
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* High-Tech Search Bar - NOW FUNCTIONAL */}
          <div className="mt-20 max-w-2xl mx-auto px-6 animate-fade-in-up [animation-delay:800ms]">
            <div className="relative group">
              <div className="absolute inset-0 bg-green-500/10 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              <div className="relative flex items-center bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[30px] p-2 pl-8 focus-within:border-green-500/50 transition-all duration-500 shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
                <div className="w-10 h-6 flex items-center justify-center relative">
                  <div className="absolute inset-0 bg-green-500/20 blur-md rounded-full animate-pulse"></div>
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-flicker relative z-10 shadow-[0_0_10px_rgba(34,197,94,1)]"></div>
                </div>
                <input
                  type="text"
                  placeholder="Search here..."
                  className="bg-transparent border-none outline-none text-white text-[11px] font-black w-full px-4 placeholder:text-white/10 uppercase tracking-[0.3em] transition-all focus:placeholder:text-green-500/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button className="relative group/btn overflow-hidden bg-white text-black font-black text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.25em] px-5 sm:px-12 py-5 rounded-[20px] whitespace-nowrap transition-all duration-500 hover:text-white hover:bg-green-500 hover:shadow-[0_0_40px_rgba(34,197,94,0.5)] active:scale-95">
                  <span className="relative z-10">Search</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"></div>
                </button>
              </div>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-center animate-fade-in-up [animation-delay:1000ms]">
            <div className="relative flex p-1.5 bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[28px] shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
              {/* Sliding Active Indicator */}
              <div
                className="absolute top-1.5 bottom-1.5 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] bg-white rounded-[22px] shadow-[0_10px_25px_rgba(255,255,255,0.2)]"
                style={{
                  left: viewMode === "marketplace" ? "6px" : "calc(50% + 3px)",
                  width: "calc(50% - 9px)"
                }}
              ></div>

              <button
                onClick={() => setViewMode("marketplace")}
                className={`relative z-10 flex items-center gap-2 sm:gap-3 px-4 sm:px-10 py-4 rounded-[22px] whitespace-nowrap transition-all duration-500 ${viewMode === "marketplace" ? "text-black" : "text-white/40 hover:text-white"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20" /></svg>
                <span className="text-[9px] font-black uppercase tracking-[0.12em] sm:tracking-[0.3em]">Marketplace</span>
              </button>

              <button
                onClick={() => setViewMode("my_listings")}
                className={`relative z-10 flex items-center gap-2 sm:gap-3 px-4 sm:px-10 py-4 rounded-[22px] whitespace-nowrap transition-all duration-500 ${viewMode === "my_listings" ? "text-black" : "text-white/40 hover:text-white"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M16 11h6" /></svg>
                <span className="text-[9px] font-black uppercase tracking-[0.12em] sm:tracking-[0.3em]">My AIs</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Marquee Ad Slider for Top Agents - Elegant Glass Display */}
      {viewMode === "marketplace" && aiModels.length > 2 && (
        <div className="w-full bg-black border-y border-white/5 py-16 relative z-10 overflow-hidden">
          <div className="max-w-[1400px] mx-auto px-6 mb-12">
            <div className="flex items-center justify-center gap-6">
              <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-green-500/50"></div>
              <h2 className="text-[10px] font-black text-white/40 uppercase tracking-[0.8em]">Top Performers</h2>
              <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-green-500/50"></div>
            </div>
          </div>

          <div className="relative">
            {/* Soft Edge Vignettes */}
            <div className="absolute left-0 top-0 bottom-0 w-48 bg-gradient-to-r from-black via-black/80 to-transparent z-10 pointer-events-none"></div>
            <div className="absolute right-0 top-0 bottom-0 w-48 bg-gradient-to-l from-black via-black/80 to-transparent z-10 pointer-events-none"></div>

            <div className="animate-marquee flex gap-x-8 items-center">
              {(() => {
                const topSellers = [...aiModels].sort((a, b) => b.healthScore - a.healthScore).slice(0, 10);
                return [...topSellers, ...topSellers].map((model, i) => (
                  <Link
                    href={`/details/${model.handle}`}
                    key={`${model.id}-${i}`}
                    className="flex-shrink-0 flex items-center gap-5 bg-white/[0.02] backdrop-blur-md border border-white/5 p-2 pr-8 rounded-full hover:border-green-500/30 hover:bg-white/[0.05] transition-all duration-500 cursor-pointer group hover:-translate-y-1"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 bg-green-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                      <AiImage model={model} textClassName="text-sm" className="w-14 h-14 rounded-full object-cover shadow-2xl border border-white/10 relative z-10" />
                      <div className="absolute -top-1 -right-1 bg-green-500 text-[7px] font-black px-2 py-0.5 rounded-full text-white shadow-[0_0_15px_rgba(34,197,94,0.5)] z-20">#{i % 10 + 1}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-bold text-[13px] tracking-tight group-hover:text-green-400 transition-colors">{model.name}</p>
                        {model.token && (
                          <div className="flex items-center gap-0.5 bg-green-500/10 px-1.5 py-0.5 rounded text-[8px] text-green-400 font-black border border-green-500/20">
                            <span>AIT #{model.token.tokenId}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-1 h-1 bg-green-500 rounded-full animate-flicker"></div>
                        <p className="text-green-400 text-[9px] font-black uppercase tracking-[0.2em]">
                          Health {Math.round(model.healthScore)}%
                        </p>
                      </div>
                    </div>
                  </Link>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-6 py-12 relative z-10">
        {/* Category Filter Bar - Elegant Minimalist Design */}
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 mb-20 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-1000 px-10">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSearchCategory(cat)}
              className="group relative py-2"
            >
              <span className={`text-[10px] font-black uppercase tracking-[0.4em] transition-all duration-500 ${activeCategory === cat ? "text-white" : "text-white/20 hover:text-white/60"}`}>
                {cat}
              </span>

              {/* Elegant Active Indicator */}
              <div className={`absolute -bottom-1 left-0 right-0 h-[2px] bg-green-500 transition-all duration-700 ease-out ${activeCategory === cat ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0 group-hover:opacity-20 group-hover:scale-x-50"} shadow-[0_0_15px_rgba(34,197,94,0.8)]`}></div>

              {/* Subtle Hover Glow */}
              <div className="absolute inset-0 bg-white/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-10">
          {filteredModels.length === 0 ? (
            <div className="col-span-full text-center py-32 bg-black rounded-[40px] border border-dashed border-white/10">
              <p className="text-white/60 font-bold uppercase tracking-widest text-sm">
                {error ? "ALT can't be reached right now. Try again in a moment." : viewMode === "my_listings" ? (user ? "You don't own a verified AI yet." : "Sign in to see your AIs.") : aiModels.length ? "No matching AIs found." : "No verified AIs yet."}
              </p>
              {viewMode === "my_listings" && user && (
                <Link href="/profile" className="mt-4 inline-block text-green-400 font-black underline hover:text-white transition-colors">
                  Create and verify one in ALTER
                </Link>
              )}
            </div>
          ) : (
            filteredModels.map((model) => (
              <AICard key={model.id} model={model} />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
