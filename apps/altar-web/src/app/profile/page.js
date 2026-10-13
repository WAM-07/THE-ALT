"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";
import { useModal } from "../../contexts/ModalContext";
import { toModel } from "../../contexts/AIContext";
import AiImage from "../../components/AiImage";
import { api, auth, mediaUrl } from "../../lib/alt";

const STATUS = {
  verified: ["Verified", "text-green-400 bg-green-500/10 border-green-500/20"],
  draft: ["Draft in ALTER", "text-white/60 bg-white/5 border-white/10"],
  training: ["Building", "text-white/60 bg-white/5 border-white/10"],
  ready: ["Ready to mint", "text-orange-400 bg-orange-500/10 border-orange-500/20"],
  minting: ["Minting", "text-orange-400 bg-orange-500/10 border-orange-500/20"],
  retired: ["Retired", "text-white/40 bg-white/5 border-white/10"],
  suspended: ["Suspended", "text-red-400 bg-red-500/10 border-red-500/20"],
};

// The signed-in person's ALT account and the AIs they own.
export default function Profile() {
  const { user } = useAuth();
  const { showAlert } = useModal();
  const [ais, setAis] = useState(null);

  useEffect(() => {
    if (!user) return;
    api("/core/ais")
      .then((list) => setAis(list.map(toModel)))
      .catch(() => setAis([]));
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-6 font-sans">
        <div className="bg-black p-10 rounded-[40px] shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-white/10 text-center max-w-sm">
          <h2 className="text-2xl font-black text-white">Sign in to see your AIs</h2>
          <Link href="/signin?next=/profile" className="block w-full mt-8 bg-gradient-to-r from-green-600 to-green-400 text-white py-4 rounded-2xl font-black uppercase hover:shadow-lg hover:shadow-green-500/25 transition-all">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const open = async (target, name) => {
    try {
      const { url } = await auth.handoffTo(target);
      window.location.href = url;
    } catch {
      showAlert(name, `Open the ${name} app on your phone.`);
    }
  };

  const avatar = mediaUrl(user.avatarUrl);

  return (
    <div className="min-h-screen bg-black px-6 pt-36 pb-24 font-sans text-white">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Account */}
        <div className="lg:col-span-1">
          <div className="bg-black shadow-[0_8px_30px_rgb(0,0,0,0.4)] rounded-3xl border border-white/10 p-8">
            <div className="flex flex-col items-center mb-8">
              <div className="w-28 h-28 bg-black rounded-[36px] border border-white/10 flex items-center justify-center overflow-hidden mb-5">
                {avatar ? <img src={avatar} alt={user.name} className="w-full h-full object-cover" /> : <span className="text-4xl text-white/60 font-black">{user.name?.charAt(0).toUpperCase()}</span>}
              </div>
              <h1 className="text-2xl font-black tracking-tight">{user.name}</h1>
              <p className="text-sm text-white/40 font-bold">@{user.handle}</p>
            </div>

            <div className="space-y-3">
              <Info label="Email" value={user.email ?? "—"} />
              <Info label="ALT wallet" value={user.wallet?.address ?? "—"} mono />
              <Info label="Two-step verification" value={user.twoFactorEnabled ? "On" : "Off"} />
            </div>

            <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 gap-3">
              <button onClick={() => open("alter", "ALTER")} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:border-green-500/40 transition-all">
                Open ALTER
              </button>
              <button onClick={() => open("altera", "ALTERA")} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:border-orange-500/40 transition-all">
                Open ALTERA
              </button>
            </div>
            <p className="mt-4 text-[10px] text-white/30 text-center leading-relaxed">Password, 2FA and devices are managed in the ALT Account Center inside ALTER or ALTERA.</p>
          </div>
        </div>

        {/* My AIs */}
        <div className="lg:col-span-2">
          <h2 className="text-2xl font-black mb-2 uppercase tracking-tight">
            My <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-green-400">AIs</span>
          </h2>
          <p className="text-sm text-white/50 mb-8">AIs are created and trained in ALTER. Once verified with an AI Identity Token, they can be listed here.</p>

          {ais === null ? (
            <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
          ) : ais.length === 0 ? (
            <div className="text-center py-20 rounded-[32px] border border-dashed border-white/10">
              <p className="text-white/60 font-bold uppercase tracking-widest text-sm">You don&apos;t have an AI yet</p>
              <button onClick={() => open("alter", "ALTER")} className="mt-4 text-green-400 font-black underline hover:text-white">
                Create one in ALTER
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {ais.map((ai) => {
                const [label, tone] = STATUS[ai.status] ?? [ai.status, STATUS.draft[1]];
                const card = (
                  <div className="bg-black rounded-[28px] border border-white/10 p-4 flex gap-4 items-center hover:border-green-500/30 transition-all h-full">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0">
                      <AiImage model={ai} textClassName="text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-lg truncate">{ai.name}</p>
                      <p className="text-xs text-white/40 font-bold truncate">@{ai.handle}{ai.version ? ` · v${ai.version}` : ""}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${tone}`}>{label}</span>
                        {ai.token && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-white/10 text-white/60">AIT #{ai.token.tokenId}</span>}
                      </div>
                    </div>
                  </div>
                );
                return ai.verified ? (
                  <Link key={ai.id} href={`/details/${ai.handle}`}>{card}</Link>
                ) : (
                  <div key={ai.id}>{card}</div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Info = ({ label, value, mono }) => (
  <div className="bg-black border border-white/5 p-4 rounded-2xl">
    <span className="text-[9px] font-black text-white/50 uppercase tracking-widest block mb-1">{label}</span>
    <p className={`font-bold text-white ${mono ? "font-mono text-[11px] text-green-400 break-all" : "text-sm break-words"}`}>{value}</p>
  </div>
);
