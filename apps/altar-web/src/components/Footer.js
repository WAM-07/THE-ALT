"use client";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-black border-t border-white/5 py-12 px-6 mt-auto">
      <div className="max-w-[1400px] mx-auto flex flex-col items-center gap-6">

        {/* Aesthetic Divider with Glow */}
        <div className="w-24 h-[1px] bg-gradient-to-r from-transparent via-green-500/50 to-transparent shadow-[0_0_10px_rgba(34,197,94,0.3)]"></div>

        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-white font-black text-xl tracking-tighter">
              ALTAR<span className="text-green-500">.</span>
            </span>
          </div>

          <p className="text-[10px] uppercase tracking-[0.4em] text-white/30 font-bold mb-4">
            AI Marketplace
          </p>

          <div className="flex flex-col items-center gap-1">
            <p className="text-[11px] font-medium text-white/40 uppercase tracking-widest">
              © {currentYear} THE ALT ECOSYSTEM
            </p>
            <p className="text-[9px] font-black text-green-500/60 uppercase tracking-[0.5em] mt-1">
              All Rights Reserved
            </p>
          </div>
        </div>


      </div>
    </footer>
  );
}
