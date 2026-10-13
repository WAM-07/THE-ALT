"use client";
import React from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { useRegion } from "../contexts/RegionContext";
import { useWishlist } from "../contexts/WishlistContext";
import AiImage from "./AiImage";

export default function AICard({ model }) {
  const { user } = useAuth();
  const { wishlist, addToWishlist } = useWishlist();
  const { t } = useRegion();

  if (!model || typeof model !== 'object') return null;

  // Ownership comes from ALT (the AIT holder), never from a display name.
  const isOwner = Boolean(user && model.owner?.id === user.id);
  const saved = wishlist?.some(item => item.agentId === model.id);

  return (
    <div className="group bg-black rounded-[32px] border border-white/5 shadow-[0_8px_30px_rgb(0,0,0,0.4)] hover:shadow-[0_20px_60px_rgb(0,0,0,0.6)] hover:-translate-y-2 hover:border-green-500/30 transition-all duration-500 overflow-hidden flex flex-col h-full cursor-pointer relative">

      {/* Decorative Gradient Glow on Hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-600/0 via-transparent to-green-400/0 group-hover:from-green-600/10 group-hover:to-green-400/5 transition-all duration-500 pointer-events-none z-0"></div>

      {/* 1. IMAGE & BADGE SECTION */}
      <div className="relative aspect-[4/3] overflow-hidden m-3 rounded-[24px] bg-black z-10">
        <AiImage model={model} textClassName="text-5xl" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ease-out opacity-90 group-hover:opacity-100" />

        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-sm">
          <span className="text-[10px] font-bold text-green-400 uppercase tracking-[0.1em]">
            {String(model.category || "AI")}
          </span>
        </div>

        {model.token && (
          <div className="absolute top-4 right-4 bg-green-500 px-3 py-1 rounded-full shadow-lg" title="Verified: this AI has an AI Identity Token on-chain">
            <span className="text-[9px] font-black text-black uppercase tracking-wider">✓ AIT #{model.token.tokenId}</span>
          </div>
        )}
      </div>

      {/* 2. CORE INFO SECTION */}
      <div className="p-6 pt-4 flex-grow z-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-green-600 to-green-400 flex items-center justify-center text-[10px] font-black text-white shadow-md shadow-green-500/30">
            {String(model.creatorName || "A").charAt(0).toUpperCase()}
          </div>
          <p className="text-[10px] font-semibold text-white/70 uppercase tracking-wider group-hover:text-green-400 transition-colors">
            by {String(model.creatorName || "Unknown")}
          </p>
        </div>

        <h2 className="text-white text-xl font-bold leading-tight tracking-tight line-clamp-2 min-h-[56px] group-hover:text-green-400 transition-colors duration-300">
          {String(model.name || "Untitled Agent")}
        </h2>

        <p className="mt-2 text-xs text-white/50 line-clamp-2 min-h-[32px]">{model.description || "A verified personal AI."}</p>

        <div className="flex items-center gap-2 mt-4">
          <div className="flex items-center bg-raised px-2.5 py-1 rounded-xl border border-white/10">
            <span className="text-[10px] font-black text-white">v{model.version ?? 1}</span>
          </div>
          <span className="text-[11px] font-bold text-white/60 tracking-wide truncate">
            {isOwner ? "Owned by you" : `Owned by ${model.ownerName}`}
          </span>
        </div>

        {/* HEALTH BAR */}
        <div className="mt-4">
          <div className="flex justify-between text-[10px] font-bold text-white/60 mb-1.5">
            <span className="uppercase tracking-wider">{t('health')}</span>
            <span className="text-green-400">{Math.round(model.healthScore ?? 0)}%</span>
          </div>
          <div className="w-full bg-raised rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-green-600 to-green-400 h-1.5 rounded-full"
              style={{ width: `${Math.round(model.healthScore ?? 0)}%` }}
            ></div>
          </div>
        </div>

      </div>

      {/* 3. FOOTER SECTION */}
      <div className="px-6 pb-6 flex justify-between items-end z-10 border-t border-white/5 pt-4 mt-2">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium text-white/60 mb-1 uppercase tracking-wider">
            Market
          </span>
          <div className="flex items-baseline gap-1">
            <p className="text-white/70 font-black text-base tracking-tight">Not listed yet</p>
          </div>

          <Link
            href={`/details/${model.handle}`}
            className="text-[10px] font-bold text-green-400 mt-2 group-hover:text-white flex items-center gap-1 uppercase tracking-widest transition-colors"
          >
            {t('viewDetails')} <span className="text-xs transition-transform group-hover:translate-x-1">→</span>
          </Link>
        </div>

        {!isOwner ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addToWishlist(model);
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border ${saved
                ? 'bg-red-500/10 border-red-500/40 text-red-500'
                : 'bg-white/5 border-white/10 text-white/40 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-500'
              }`}
            title="Add to wishlist"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
        ) : (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-2.5 rounded-xl text-[10px] font-bold tracking-wide uppercase">
            {t('yourAi')}
          </div>
        )}
      </div>
    </div>
  );
}