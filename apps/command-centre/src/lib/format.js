export const KIND = { report: "Report", flag: "Flag", support: "Support", dispute: "Dispute", appeal: "Appeal" };
export const STATUS = { open: "Open", in_progress: "In progress", waiting: "Waiting on person", resolved: "Resolved", dismissed: "Dismissed" };
export const PRIORITY = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const PLATFORM = { core: "ALT", alter: "ALTER", altera: "ALTERA", altar: "ALTAR", admin: "Command Centre" };
export const ROLES = ["admin", "moderator", "support", "auditor", "creator", "consumer", "participant"];
export const STAFF_ROLES = ["admin", "moderator", "support", "auditor"];

/** Case numbers read like ledger entries: #0042. */
export const caseNo = (n) => `#${String(n).padStart(4, "0")}`;

export const words = (s) => (s ?? "").replaceAll("_", " ");

/** "now", "4m", "3h", "2d", "5w" */
export function ago(iso) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 7))}w`;
}

const pad = (n) => String(n).padStart(2, "0");
/** 2026-10-15 16:42 (local time) */
export function stamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const short = (id, n = 8) => (id ? String(id).slice(0, n) : "—");
