"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "../../lib/alt";
import { AuthCard } from "../../components/AuthCard";

// "Open ALTAR" in ALTER or ALTERA lands here with a one-time code: no password needed.
export default function Handoff() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React runs effects twice in development; a code works once.
    started.current = true;
    const code = new URLSearchParams(window.location.search).get("code");
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(null, "", "/handoff");
    if (!code) return setError("This link is missing its code. Open ALTAR again from ALTER or ALTERA.");
    auth
      .redeemHandoff(code)
      .then(() => router.replace("/profile"))
      .catch((err) => setError(err.message));
  }, [router]);

  return (
    <AuthCard badge="ALT Handoff" subtitle="Signing you in">
      {error ? (
        <>
          <p role="alert" className="text-sm text-center text-white/70 leading-relaxed">{error}</p>
          <Link href="/signin" className="text-center text-[10px] font-black uppercase tracking-widest text-green-400 hover:text-white">
            Sign in with your password instead
          </Link>
        </>
      ) : (
        <div className="flex justify-center py-6">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </AuthCard>
  );
}
