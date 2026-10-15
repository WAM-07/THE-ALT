"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { redeemHandoff } from "../../lib/alt";

// When the browser blocks the sign-in popup, the ALT Account window opens full-page and comes back
// here with a one-time code.
export default function Handoff() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React runs effects twice in development; a code works once.
    started.current = true;
    const code = new URLSearchParams(window.location.search).get("code");
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(null, "", "/portal/handoff");
    if (!code) return setError("This link is missing its sign-in code.");
    redeemHandoff(code)
      .then(() => router.replace("/"))
      .catch((e) => setError(e.message));
  }, [router]);

  return (
    <div className="center">
      {error ? (
        <div style={{ maxWidth: 420 }}>
          <div className="error">{error}</div>
          <button className="btn" onClick={() => router.replace("/")}>
            Sign in again
          </button>
        </div>
      ) : (
        <span className="loader">Signing you in</span>
      )}
    </div>
  );
}
