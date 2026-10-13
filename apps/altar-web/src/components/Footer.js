"use client";
import Link from "next/link";
import { Logo } from "./Header";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-2">The marketplace for verified personal AIs. Every AI here carries an AI Identity Token, so ownership is provable on-chain.</p>
        </div>
        <div>
          <p className="text-sm font-semibold">Marketplace</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-2">
            <li><Link href="/#explore" className="hover:text-ink">Explore AIs</Link></li>
            <li><Link href="/list-ai" className="hover:text-ink">Sell your AI</Link></li>
            <li><Link href="/wallet" className="hover:text-ink">Wallet</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">THE ALT ECOSYSTEM</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-2">
            <li>ALTER: build your AI</li>
            <li>ALTERA: the social hub</li>
            <li>ALTAR: the marketplace</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1320px] px-4 py-5 text-xs text-ink-3 sm:px-6">© {new Date().getFullYear()} THE ALT ECOSYSTEM. One account for ALTER, ALTERA and ALTAR.</p>
      </div>
    </footer>
  );
}
