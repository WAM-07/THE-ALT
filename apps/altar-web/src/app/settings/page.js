"use client";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";
import { useRegion } from "../../contexts/RegionContext";
import { Button, Card } from "../../components/ui";
import { continueWithAlt } from "../../lib/alt";

const COUNTRIES = [
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "UK", name: "United Kingdom", flag: "🇬🇧" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
];
const CURRENCIES = [
  { code: "PKR", symbol: "Rs", name: "Pakistani Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
];

const select = "h-11 w-full rounded-2xl border border-line bg-sunken/60 px-3 text-[15px] outline-none focus:border-ink/30";

// ALTAR's settings. Account security belongs to ALT (managed in ALTER or ALTERA); what lives here
// is per-browser: region, currency and, tucked under Advanced, the appearance lab.
export default function Settings() {
  const { user, logout } = useAuth();
  const { settings, updateSettings } = useRegion();

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <Link href="/profile" className="text-sm font-semibold text-ink-3 hover:text-ink">
        ← Profile
      </Link>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Settings</h1>

      <div className="mt-8 space-y-5">
        <Card className="p-6">
          <h2 className="font-display text-lg font-bold">Account</h2>
          {user ? (
            <>
              <dl className="mt-4 divide-y divide-line text-[15px]">
                <Item k="Name" v={user.name} />
                <Item k="Handle" v={`@${user.handle}`} />
                <Item k="Email" v={user.email ?? "—"} />
                <Item k="Two-step verification" v={user.twoFactorEnabled ? "On" : "Off"} />
              </dl>
              <p className="mt-4 text-sm text-ink-3">Your password, two-step verification and devices belong to your ALT account. Change them in the ALT Account Center inside ALTER or ALTERA.</p>
              <Button kind="outline" className="mt-5" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <p className="mt-2 text-ink-2">You&apos;re not signed in.</p>
              <Button className="mt-4" onClick={() => continueWithAlt("signin", "/settings").catch(() => {})}>
                Continue with ALT
              </Button>
            </>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">Help &amp; support</h2>
              <p className="mt-1 text-sm text-ink-3">Ask ALT for help, or follow up on a report. One place for ALTAR, ALTER and ALTERA.</p>
            </div>
            <Button href="/help" kind="outline">
              Open
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-lg font-bold">Region</h2>
          <p className="mt-1 text-sm text-ink-3">Prices on ALTAR are in POL, Polygon&apos;s coin. Showing them in your currency as well comes later. Saved in this browser.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-ink-2">
              Country
              <select
                className={`${select} mt-1.5`}
                value={settings.country.code}
                onChange={(e) => updateSettings({ ...settings, country: COUNTRIES.find((c) => c.code === e.target.value) })}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-ink-2">
              Currency
              <select
                className={`${select} mt-1.5`}
                value={settings.currency.code}
                onChange={(e) => updateSettings({ ...settings, currency: CURRENCIES.find((c) => c.code === e.target.value) })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <details className="group rounded-3xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between p-6 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block font-display text-lg font-bold">Advanced</span>
              <span className="text-sm text-ink-3">Experimental options for testing ALTAR.</span>
            </span>
            <span className="text-ink-3 transition group-open:rotate-180" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="border-t border-line px-6 py-4">
            <Link href="/settings/appearance" className="flex items-center justify-between rounded-2xl px-1 py-2 hover:text-accent-text">
              <span>
                <span className="block font-semibold">Appearance lab</span>
                <span className="text-sm text-ink-3">Try ALTAR&apos;s other looks.</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </details>
      </div>
    </div>
  );
}

const Item = ({ k, v }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <dt className="text-ink-3">{k}</dt>
    <dd className="truncate font-semibold">{v}</dd>
  </div>
);
