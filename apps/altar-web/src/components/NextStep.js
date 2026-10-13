"use client";
import Link from "next/link";

// A page whose real version arrives in a later ALTAR step. Says so plainly instead of faking it.
export default function NextStep({ title, accent, children }) {
  return (
    <div className="min-h-screen bg-canvas px-6 pt-40 pb-24 font-sans text-white">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">
          {title} <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-green-400">{accent}</span>
        </h1>
        <div className="mt-10 bg-black rounded-[32px] border border-white/10 p-8 text-left space-y-4 text-sm text-white/70 leading-relaxed">{children}</div>
        <Link href="/" className="inline-block mt-10 text-[10px] font-black uppercase tracking-widest text-green-400 hover:text-white">
          ← Back to the marketplace
        </Link>
      </div>
    </div>
  );
}
