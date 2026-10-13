"use client";
import Link from "next/link";
import NextStep from "../../components/NextStep";
import { useAuth } from "../../contexts/AuthContext";

export default function Wallet() {
  const { user } = useAuth();
  return (
    <NextStep title="Your" accent="Wallet">
      {user ? (
        <>
          <p>Every ALT account has its own wallet. Payments on ALTAR are made from it, on-chain.</p>
          <p className="font-mono text-xs text-green-400 break-all bg-white/5 border border-white/10 rounded-2xl p-4">{user.wallet?.address ?? "—"}</p>
          <p>Balance, test funds on the local chain, earnings and withdrawals open here in the next ALTAR step.</p>
        </>
      ) : (
        <Link href="/signin?next=/wallet" className="inline-block bg-white text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-green-400">
          Sign in
        </Link>
      )}
    </NextStep>
  );
}
