"use client";
import React from "react";
import { useWishlist } from "../contexts/WishlistContext";
import AiImage from "./AiImage";
import { useAI } from "../contexts/AIContext";

export default function WishlistModal({ isOpen, onClose }) {
  const { wishlist, removeFromWishlist } = useWishlist();
  const { aiModels } = useAI();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={onClose}></div>
      <div className="relative w-full max-w-[600px] bg-[#050505] border border-white/10 rounded-[40px] shadow-[0_0_100px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in duration-300">

        {/* Header */}
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-black/40">
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter">Wishlist</h2>
            <p className="text-[10px] text-green-400 uppercase tracking-[0.3em] font-bold mt-1">AIs you are watching</p>
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all border border-white/5"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-8 space-y-4 custom-scrollbar">
          {wishlist.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 border border-white/5">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/20"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </div>
              <p className="text-white/40 text-sm font-bold uppercase tracking-widest">Your wishlist is empty</p>
            </div>
          ) : (
            wishlist.map((item) => {
              const model = aiModels?.find(m => String(m.id) === String(item.agentId));
              return (
                <div key={item.id} className="bg-white/5 border border-white/5 p-6 rounded-3xl flex items-center gap-6 group hover:border-green-500/30 transition-all">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 border border-white/10">
                    <AiImage model={model ?? { name: item.agentName }} />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-white font-black text-lg">{item.agentName}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      {!model && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-orange-500/10 border-orange-500/20 text-orange-400">
                          No longer available
                        </span>
                      )}
                      <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">Added: {new Date(item.addedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <button
                      onClick={() => removeFromWishlist(item.agentId)}
                      className="text-[10px] font-black uppercase tracking-widest text-red-500/60 hover:text-red-500 transition-colors"
                    >
                      Untrack
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-white/5 bg-black/40">
          <p className="text-[10px] text-white/30 text-center uppercase tracking-[0.2em] font-medium italic">
            Saved in this browser for your ALT account.
          </p>
        </div>
      </div>
    </div>
  );
}
