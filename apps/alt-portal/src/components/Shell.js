"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/alt";
import { useStaff } from "./Staff";

const NAV = [
  { href: "/", n: "01", label: "Overview" },
  { href: "/queue", n: "02", label: "Queue" },
  { href: "/people", n: "03", label: "People", roles: ["admin"] },
  { href: "/audit", n: "04", label: "Audit log", roles: ["admin", "auditor"] },
];

const section = (path) => (path.startsWith("/cases") ? "Case" : NAV.find((i) => i.href !== "/" && path.startsWith(i.href))?.label ?? "Overview");

/** Everything around a page: the gate when signed out, otherwise the rail, top bar and status bar. */
export function Shell({ children }) {
  const s = useStaff();
  const path = usePathname();
  // The popup-blocked sign-in comes back to /handoff before there is a session.
  if (path === "/handoff") return children;
  if (s.state === "signedOut" || s.state === "notStaff") return <Gate />;
  if (s.state === "checking")
    return (
      <div className="center">
        <span className="loader">Checking staff access</span>
      </div>
    );
  if (s.state === "error")
    return (
      <div className="center">
        <div style={{ maxWidth: 420 }}>
          <div className="error">{s.error?.message}</div>
          <button className="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  return <Frame>{children}</Frame>;
}

function Frame({ children }) {
  const s = useStaff();
  const path = usePathname();
  const nav = NAV.filter((i) => !i.roles || s.has(...i.roles));
  return (
    <div className="frame">
      <aside className="rail">
        <Link href="/" className="rail-brand">
          <span className="mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="wordmark">
            ALT<span>/</span>PORTAL
          </span>
        </Link>
        <nav aria-label="Portal">
          {nav.map((i) => {
            const on = i.href === "/" ? path === "/" : path.startsWith(i.href) || (i.href === "/queue" && path.startsWith("/cases"));
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>
                <small>{i.n}</small>
                <b>{i.label}</b>
                <small />
              </Link>
            );
          })}
        </nav>
        <div className="rail-foot">
          <div className="who">{s.user?.displayName ?? s.user?.handle}</div>
          <div className="mono">@{s.user?.handle}</div>
          <button onClick={s.signOut}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="crumbs">
            ALT / Portal / <b>{section(path)}</b>
          </div>
          <Jump />
        </div>
        <main className="page">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}

/** Type a case number, press Enter, land on the case. */
function Jump() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [miss, setMiss] = useState(false);
  async function go(e) {
    e.preventDefault();
    const n = value.replace(/\D/g, "");
    if (!n) return;
    try {
      const { items } = await api(`/core/staff/cases?status=all&q=${n}&limit=1`);
      const hit = items.find((c) => String(c.number) === String(Number(n)));
      if (hit) {
        setValue("");
        router.push(`/cases/${hit.id}`);
        return;
      }
    } catch {
      // fall through to "not found"
    }
    setMiss(true);
    setTimeout(() => setMiss(false), 1500);
  }
  return (
    <form className="jump" onSubmit={go} role="search" style={miss ? { borderColor: "var(--urgent)" } : undefined}>
      <span>#</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={miss ? "not found" : "case no."} aria-label="Go to case number" inputMode="numeric" />
    </form>
  );
}

function StatusBar() {
  const s = useStaff();
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const utc = now ? now.toISOString().slice(11, 19) : "--:--:--";
  return (
    <footer className="statusbar">
      <span className="live">Connected</span>
      <span>@{s.user?.handle}</span>
      <span>{s.staff?.roles.join(" · ")}</span>
      <span>Session: this tab only</span>
      <span className="end num">UTC {utc}</span>
    </footer>
  );
}

/** The sign-in screen. Staff sign in with their ALT account, in the ALT Account window. */
function Gate() {
  const s = useStaff();
  const [busy, setBusy] = useState(false);
  const notStaff = s.state === "notStaff";
  async function go() {
    setBusy(true);
    await s.signIn();
    setBusy(false);
  }
  return (
    <div className="gate">
      <section className="gate-art" aria-hidden="true">
        <span className="mark">
          <i />
          <i />
          <i />
        </span>
        <div className="big">
          ALT<span>/</span>
          <br />
          PORTAL
        </div>
        <div className="legend">
          Moderation · Support · People · Audit
          <br />
          One queue for ALTER, ALTERA and ALTAR
        </div>
      </section>
      <section className="gate-form">
        <div className="eyebrow">
          <b>00</b> / Staff sign-in
        </div>
        <h1 className="title">{notStaff ? "This account isn't staff" : "Sign in to the ALT Portal"}</h1>
        <p className="lede">
          {notStaff
            ? `@${s.user?.handle ?? "you"} has no staff role. An admin can give one in People; then sign in again.`
            : "Use your ALT account. Only people with a staff role get in: admin, moderator, support or auditor."}
        </p>
        {s.error && !notStaff && <div className="error">{s.error.message}</div>}
        {notStaff ? (
          <button className="btn" onClick={s.signOut}>
            Sign out
          </button>
        ) : (
          <button className="btn primary" onClick={go} disabled={busy}>
            {busy ? "Waiting for ALT…" : "Continue with ALT"}
          </button>
        )}
        <ul className="rules">
          <li>
            <span>01</span>Your password and 2FA code go to the ALT Account window, never to this page.
          </li>
          <li>
            <span>02</span>The session lives in this tab only: closing or reloading it signs you out.
          </li>
          <li>
            <span>03</span>Everything you do here is written to ALT&apos;s tamper-evident audit log.
          </li>
        </ul>
      </section>
    </div>
  );
}
