"use client";

// The sign-in, sign-up and handoff screens share Soban's ALTAR card.
export function AuthCard({ badge, subtitle, children }) {
  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 pt-32 font-sans text-white overflow-hidden relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-green-500/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-green-500/5 rounded-full blur-[150px] animate-flicker"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-20">
          <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
        </div>
      </div>

      <div className="w-full max-w-[400px] animate-in fade-in zoom-in duration-700 relative">
        <div className="absolute -inset-1 bg-gradient-to-r from-green-500/20 via-green-400/10 to-green-600/20 rounded-[44px] blur-xl opacity-50"></div>
        <div className="relative bg-black/60 backdrop-blur-3xl p-8 sm:p-10 border border-white/10 rounded-[40px] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite] pointer-events-none"></div>

          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/5 border border-green-500/20 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-ping"></span>
              <span className="text-[10px] font-black text-green-400 uppercase tracking-[0.3em]">{badge}</span>
            </div>
          </div>

          <div className="text-center mb-10">
            <h1 className="text-5xl font-black text-white tracking-tighter mb-2 group">
              ALTAR<span className="text-green-500 inline-block group-hover:scale-125 transition-transform duration-300">.</span>
            </h1>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.4em]">{subtitle}</p>
          </div>

          <div className="relative flex flex-col gap-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export const ErrorText = ({ children }) =>
  children ? <p role="alert" className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">{children}</p> : null;

export const OneAccountNote = () => (
  <div className="flex items-center gap-4 py-2">
    <div className="h-px bg-white/10 flex-1"></div>
    <span className="text-[9px] text-white/30 font-black uppercase tracking-widest text-center">One ALT account · ALTER · ALTERA · ALTAR</span>
    <div className="h-px bg-white/10 flex-1"></div>
  </div>
);

