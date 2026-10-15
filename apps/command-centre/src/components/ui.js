import { KIND, PLATFORM, PRIORITY, STATUS } from "../lib/format";

export const Pri = ({ level }) => <span className={`pri ${level}`} title={`${PRIORITY[level] ?? level} priority`} aria-label={`${PRIORITY[level] ?? level} priority`} />;

export function StatusBadge({ status }) {
  const tone = status === "resolved" ? "ok" : status === "dismissed" ? "" : status === "open" ? "accent" : "";
  return <span className={`badge ${tone}`}>{STATUS[status] ?? status}</span>;
}

export const KindBadge = ({ kind }) => <span className={`badge ${kind === "flag" ? "solid" : ""}`}>{KIND[kind] ?? kind}</span>;

export const PlatformBadge = ({ platform }) => <span className="badge">{PLATFORM[platform] ?? platform}</span>;

/** A page heading: a numbered eyebrow, the title, one line saying what the page is for. */
export function Heading({ n, eyebrow, title, lede, children }) {
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>
        <div className="eyebrow">
          <b>{n}</b> / {eyebrow}
        </div>
        <h1 className="title">{title}</h1>
        {lede && (
          <p className="lede" style={{ margin: 0 }}>
            {lede}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error.message}
      {error.code && <span className="mono muted"> · {error.code}</span>}
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Loader = ({ children = "Loading" }) => <div className="empty loader">{children}</div>;
