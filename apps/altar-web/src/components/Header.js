"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { useWishlist } from "../contexts/WishlistContext";
import { continueWithAlt, mediaUrl } from "../lib/alt";
import { Avatar, btnClass } from "./ui";

export function Logo({ className = "" }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label="ALTAR home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="10" fill="var(--accent)" />
        <path d="M9 23 L16 8 L23 23" fill="none" stroke="var(--accent-ink)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 18h8" stroke="var(--accent-ink)" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
      <span className="font-display text-[22px] font-extrabold tracking-tight">altar</span>
    </Link>
  );
}

const Icon = {
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4" />,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />,
  wallet: <path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zm14 7h.01" />,
};
const Svg = ({ children, className = "h-5 w-5" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

function Search({ autoFocus = false, onDone }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}#explore` : "/#explore");
        onDone?.();
      }}
      className="relative w-full"
    >
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">
        <Svg className="h-4.5 w-4.5">{Icon.search}</Svg>
      </span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Search AIs, creators and handles"
        aria-label="Search ALTAR"
        className="h-11 w-full rounded-full border border-line bg-sunken/70 pl-11 pr-4 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-ink/30 focus:bg-surface"
      />
    </form>
  );
}

export default function Header() {
  const { user } = useAuth();
  const { wishlist } = useWishlist();
  const pathname = usePathname();
  const [searching, setSearching] = useState(false);
  const [searchPath, setSearchPath] = useState(pathname);
  if (pathname !== searchPath) {
    setSearchPath(pathname);
    setSearching(false);
  }

  // A little more weight once the page scrolls under the header.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const signIn = (mode) => continueWithAlt(mode).catch(() => {});
  const navLink = (href, label) => (
    <Link href={href} className={`rounded-full px-3 py-2 text-[15px] font-medium transition hover:bg-ink/5 ${pathname === href ? "text-ink" : "text-ink-2"}`}>
      {label}
    </Link>
  );

  return (
    <header className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-[background-color,box-shadow,border-color] duration-300 ${scrolled ? "border-line bg-canvas/90 shadow-[0_6px_24px_-12px_rgb(0_0_0/0.25)]" : "border-transparent bg-canvas/60"}`}>
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Logo />
        <nav className="hidden items-center lg:flex">
          {navLink("/#explore", "Explore")}
          {navLink("/list-ai", "Sell")}
        </nav>
        <div className="mx-auto hidden w-full max-w-md md:block">
          <Search />
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 md:ml-0">
          <button onClick={() => setSearching((s) => !s)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5 md:hidden" aria-label="Search">
            <Svg>{Icon.search}</Svg>
          </button>
          {user ? (
            <>
              <Link href="/profile?tab=saved" className="relative hidden h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5 sm:flex" aria-label="Saved AIs">
                <Svg>{Icon.heart}</Svg>
                {wishlist?.length > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">{wishlist.length}</span>
                )}
              </Link>
              <Link href="/wallet" className="hidden h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:border-ink/30 sm:flex">
                <Svg className="h-4.5 w-4.5">{Icon.wallet}</Svg>
                Wallet
              </Link>
              <Link
                href="/profile"
                aria-label="Your profile"
                className={`rounded-full ring-offset-2 ring-offset-canvas transition hover:ring-2 hover:ring-ink/20 ${pathname === "/profile" ? "ring-2 ring-accent" : ""}`}
              >
                <Avatar src={mediaUrl(user.avatarUrl)} name={user.name} size={40} />
              </Link>
            </>
          ) : (
            <>
              <button onClick={() => signIn("signin")} className={btnClass("ghost", "sm", "hidden sm:inline-flex")}>
                Sign in
              </button>
              <button onClick={() => signIn("signup")} className={btnClass("pop", "sm")}>
                Get started
              </button>
            </>
          )}
        </div>
      </div>
      {searching && (
        <div className="animate-pop-in border-t border-line/70 px-4 py-3 md:hidden">
          <Search autoFocus onDone={() => setSearching(false)} />
        </div>
      )}
    </header>
  );
}
