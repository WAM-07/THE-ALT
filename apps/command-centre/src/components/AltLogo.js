// ALT's logo from the logo pack (docs/brand/logo-pack): the hexagon and the A take the text colour,
// the dot the accent token. `animated` plays the pack's loop (globals.css, .brand-anim), which stops
// for reduced motion.
export function AltLogo({ animated = false, className = "mark" }) {
  return (
    <svg viewBox="0 0 100 100" className={`${animated ? "brand-anim " : ""}${className}`} aria-hidden="true">
      <path className="draw len-hex" d="M50 7 L87 28.5 L87 71.5 L50 93 L13 71.5 L13 28.5 Z" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
      <path className="drawa len-a" d="M32 71 L50 31 L68 71" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      {animated && <circle className="ping" cx="50" cy="62" r="5.5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
      <circle className="pop" cx="50" cy="62" r="5.5" fill="var(--accent)" />
    </svg>
  );
}

/** A full-screen wait: the animated logo over a mono caption. */
export function Waiting({ children }) {
  return (
    <div className="waiting">
      <AltLogo animated className="waiting-logo" />
      <span className="loader">{children}</span>
    </div>
  );
}
