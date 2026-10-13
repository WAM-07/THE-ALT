"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, takeNextPath } from "../../lib/alt";
import { AuthCard } from "../../components/AuthCard";
import { Spinner } from "../../components/ui";

// "Open ALTAR" in ALTER or ALTERA, and the ALT Account window when popups are blocked, land here
// with a one-time code: no password needed.
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
      .then(() => router.replace(takeNextPath()))
      .catch((err) => setError(err.message));
  }, [router]);

  return (
    <AuthCard title={error ? "That didn't work" : "Signing you in"}>
      {error ? (
        <>
          <p role="alert" className="text-ink-2">{error}</p>
          <Link href="/signin" className="font-semibold text-ink underline underline-offset-4">
            Sign in with ALT instead
          </Link>
        </>
      ) : (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
    </AuthCard>
  );
}
