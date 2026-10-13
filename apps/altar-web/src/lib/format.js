// Small display helpers shared by the ALTAR screens.

export const NETWORKS = { 31337: "ALT local chain", 80002: "Polygon Amoy", 137: "Polygon" };
export const networkName = (chainId) => NETWORKS[chainId] ?? `Chain ${chainId}`;

export const shortAddress = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—");

export const percent = (bps) => `${(Number(bps) || 0) / 100}%`;

const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "3 days ago", "just now". */
export function timeAgo(iso) {
  if (!iso) return "—";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf ? rtf.format(Math.round(seconds / size), unit) : new Date(iso).toLocaleDateString();
  }
  return "just now";
}

export const initials = (name) =>
  String(name || "AI")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
