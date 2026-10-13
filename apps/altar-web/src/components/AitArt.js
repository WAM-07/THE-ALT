"use client";
import { useId, useMemo } from "react";

// Each AI Identity Token gets its own artwork, drawn from its token id: the same token always
// gets the same picture, and no two look alike. Like the art on an NFT, it is a visual identity
// for the token, not a picture of the AI (that is the AI's own avatar, shown on top).

const PALETTES = [
  // background, main shape, second shape, motif, deep tone
  ["#0f3d2e", "#4ae68e", "#ffb5ea", "#f3f1ec", "#0a2a1f"],
  ["#f3f1ec", "#4ae68e", "#7aa9ff", "#ffd04a", "#131613"],
  ["#131613", "#3ddc84", "#ffb5ea", "#7aa9ff", "#f3f1ec"],
  ["#ffd04a", "#138a45", "#ff8a5c", "#fff6dc", "#2b2410"],
  ["#dff7e8", "#1f9a5c", "#ff7eb6", "#ffffff", "#0c3b22"],
  ["#173a63", "#4ae68e", "#7aa9ff", "#ffd04a", "#e8f0ff"],
  ["#ffb5ea", "#138a45", "#ffd04a", "#fff0fa", "#3a0f2c"],
  ["#d9f3f0", "#0f8a7a", "#3ddc84", "#ffffff", "#0b3b35"],
  ["#082318", "#2fbf71", "#c4e86b", "#7fd9a2", "#d9f5e4"],
  ["#ff8a5c", "#fff1e6", "#138a45", "#ffd04a", "#3b1406"],
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 100) / 100;

/** A soft, closed organic shape through `n` points around (cx, cy). */
function blob(rand, cx, cy, r, n = 7) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.72 + rand() * 0.5);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

function motif(rand, kind, color) {
  const x = 30 + rand() * 40;
  const y = 30 + rand() * 40;
  switch (kind) {
    case 0: // rings
      return (
        <g fill="none" stroke={color} strokeWidth="1.3" opacity="0.9">
          {[6, 11, 16, 21].slice(0, 2 + Math.floor(rand() * 3)).map((r) => (
            <circle key={r} cx={f(x)} cy={f(y)} r={r} />
          ))}
        </g>
      );
    case 1: {
      // dot grid
      const dots = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) dots.push(<circle key={`${i}-${j}`} cx={f(x - 12.5 + i * 5)} cy={f(y - 12.5 + j * 5)} r="1.05" />);
      return (
        <g fill={color} opacity="0.85">
          {dots}
        </g>
      );
    }
    case 2: {
      // half moon
      const r = 14 + rand() * 8;
      const rot = Math.floor(rand() * 4) * 90;
      return <path d={`M${f(x - r)},${f(y)} A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)} Z`} fill={color} transform={`rotate(${rot} ${f(x)} ${f(y)})`} opacity="0.95" />;
    }
    case 3: {
      // sparkle
      const s = 10 + rand() * 8;
      return <path d={`M${f(x)},${f(y - s)} Q${f(x)},${f(y)} ${f(x + s)},${f(y)} Q${f(x)},${f(y)} ${f(x)},${f(y + s)} Q${f(x)},${f(y)} ${f(x - s)},${f(y)} Q${f(x)},${f(y)} ${f(x)},${f(y - s)} Z`} fill={color} />;
    }
    default: {
      // stripes
      const rot = Math.round(rand() * 180);
      return (
        <g stroke={color} strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${rot} ${f(x)} ${f(y)})`} opacity="0.9">
          {[-8, -2.7, 2.7, 8].map((o) => (
            <line key={o} x1={f(x - 12)} y1={f(y + o)} x2={f(x + 12)} y2={f(y + o)} />
          ))}
        </g>
      );
    }
  }
}

export default function AitArt({ seed, className = "w-full h-full", grain = true }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const art = useMemo(() => {
    const h = hash(String(seed ?? "alt"));
    const rand = random(h);
    const [bg, a, b, c, deep] = PALETTES[h % PALETTES.length];
    return {
      bg,
      glow: { d: blob(rand, 15 + rand() * 70, 10 + rand() * 30, 34 + rand() * 12, 8), color: a },
      main: { d: blob(rand, 20 + rand() * 60, 50 + rand() * 35, 22 + rand() * 12, 7), color: a },
      second: { d: blob(rand, 20 + rand() * 60, 20 + rand() * 60, 12 + rand() * 10, 6), color: b },
      motif: motif(rand, Math.floor(rand() * 5), rand() > 0.5 ? c : deep),
    };
  }, [seed]);

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <filter id={`g${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        {grain && (
          <filter id={`n${uid}`}>
            <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" />
          </filter>
        )}
      </defs>
      <rect width="100" height="100" fill={art.bg} />
      <path d={art.glow.d} fill={art.glow.color} filter={`url(#g${uid})`} opacity="0.75" />
      <path d={art.main.d} fill={art.main.color} />
      <path d={art.second.d} fill={art.second.color} />
      {art.motif}
      {grain && <rect width="100" height="100" filter={`url(#n${uid})`} />}
    </svg>
  );
}
