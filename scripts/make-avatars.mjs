// Builds ALT's ready-made profile pictures: services/core/public/avatars/<kind>/<set>/<nn>.png and
// manifest.json. People ("human") and AIs ("ai") get separate sets so they are easy to tell apart.
//
//   node scripts/make-avatars.mjs
//
// The "ALT originals" (chibi people, mecha minis, androids, AI cores) are drawn here, so ALT owns
// them. The others come from DiceBear styles whose licences allow this use; credits are kept in the
// manifest and shown in the picture picker. Output is committed; run this only to change the sets.
import { createAvatar } from '@dicebear/core';
import { adventurer, bigSmile, bottts, lorelei, notionists } from '@dicebear/collection';
import { Resvg } from '@resvg/resvg-js';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const OUT = new URL('../services/core/public/avatars/', import.meta.url);
const SIZE = 256;

// ---------------------------------------------------------------- ALT originals: chibi people

const SKIN = ['#ffe0cf', '#f8d2b8', '#eab48f', '#c98d63', '#9a6440', '#f3c9a8'];
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const HAIR_BACK = {
  bob: 'M50 122 C46 60 90 40 128 40 C166 40 210 60 206 122 L210 196 C192 206 178 200 172 190 L84 190 C78 200 64 206 46 196 Z',
  long: 'M48 120 C44 58 90 38 128 38 C166 38 212 58 208 120 L216 240 L40 240 Z',
  buns: 'M70 58 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0 M186 58 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0',
  pony: 'M178 66 C238 62 246 150 222 206 C214 172 206 134 184 112 Z',
  puff: 'M64 96 a34 34 0 1 1 40 -44 a34 34 0 1 1 48 0 a34 34 0 1 1 40 44 a30 30 0 1 1 -6 56 L70 152 a30 30 0 1 1 -6 -56 Z',
  none: '',
};
const HAIR_FRONT = {
  // A cap over the head with a jagged fringe.
  fringe: 'M52 140 C48 68 92 44 128 44 C164 44 208 68 204 140 L192 112 L178 124 L166 100 L150 120 L136 98 L120 120 L106 100 L92 122 L78 104 L64 126 Z',
  swept: 'M52 142 C48 66 92 42 132 44 C170 46 210 70 204 142 L196 116 C172 112 148 96 132 76 C120 100 96 116 64 120 Z',
  straight: 'M52 140 C48 68 92 44 128 44 C164 44 208 68 204 140 L200 108 L56 108 Z',
  spiky: 'M52 140 C48 72 70 60 74 66 L60 26 L98 50 L104 14 L128 44 L152 12 L160 50 L198 28 L184 66 C190 62 208 76 204 140 L190 110 L172 124 L160 98 L144 118 L128 96 L112 118 L96 98 L84 124 L66 110 Z',
};
const ahoge = 'M128 46 C116 18 146 6 152 22 C140 16 130 28 134 46 Z';
const sideLocks = 'M52 104 L76 104 L82 204 L58 204 Z M180 104 L204 104 L198 204 L174 204 Z';

function face({ eyes = '#3b2a20', mouth = 'smile', visor = null }) {
  const eye = (x) =>
    visor
      ? ''
      : `<ellipse cx="${x}" cy="140" rx="13" ry="17" fill="${eyes}"/>
         <ellipse cx="${x}" cy="146" rx="8" ry="10" fill="${shade(eyes, 0.55)}"/>
         <circle cx="${x - 5}" cy="133" r="5" fill="#fff"/>
         <circle cx="${x + 5}" cy="150" r="2.4" fill="#fff"/>
         <path d="M${x - 16} 124 Q${x} 116 ${x + 16} 124" stroke="#2a1d1a" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const mouths = {
    smile: '<path d="M118 166 Q128 176 138 166" stroke="#7a3b2e" stroke-width="4" fill="none" stroke-linecap="round"/>',
    open: '<path d="M116 164 Q128 186 140 164 Z" fill="#7a3b2e"/><path d="M121 172 Q128 180 135 172" fill="#ff8e8e"/>',
    cat: '<path d="M114 166 Q121 174 128 166 Q135 174 142 166" stroke="#7a3b2e" stroke-width="4" fill="none" stroke-linecap="round"/>',
    calm: '<path d="M121 168 L135 168" stroke="#7a3b2e" stroke-width="4" stroke-linecap="round"/>',
  };
  const visorBand = visor
    ? `<rect x="66" y="118" width="124" height="40" rx="20" fill="#0f1a24"/>
       <rect x="72" y="124" width="112" height="28" rx="14" fill="${visor}" opacity="0.9" filter="url(#glow)"/>
       <rect x="80" y="129" width="40" height="6" rx="3" fill="#fff" opacity="0.7"/>`
    : '';
  return `${eye(100)}${eye(156)}${visorBand}
    <ellipse cx="84" cy="160" rx="11" ry="6" fill="#ff8fa3" opacity="0.45"/>
    <ellipse cx="172" cy="160" rx="11" ry="6" fill="#ff8fa3" opacity="0.45"/>
    ${mouths[mouth]}`;
}

const DEFS = `<defs><filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

function chibi(p) {
  const skin = SKIN[p.skin];
  const hair = p.hair;
  const accessory = {
    none: '',
    headphones: `<path d="M50 132 C46 54 210 54 206 132" stroke="#26313c" stroke-width="12" fill="none"/><rect x="38" y="118" width="26" height="44" rx="12" fill="${p.accent}"/><rect x="192" y="118" width="26" height="44" rx="12" fill="${p.accent}"/>`,
    star: `<path d="M182 70 l7 14 15 2 -11 10 3 15 -14 -7 -14 7 3 -15 -11 -10 15 -2 Z" fill="#ffd34d" stroke="#e6a800" stroke-width="2"/>`,
    glasses: `<g stroke="#2a2a2a" stroke-width="4" fill="none"><circle cx="100" cy="142" r="21"/><circle cx="156" cy="142" r="21"/><path d="M121 140 L135 140"/></g>`,
    catears: `<path d="M62 78 L66 26 L106 56 Z M194 78 L190 26 L150 56 Z" fill="${hair}"/><path d="M72 66 L74 40 L94 56 Z M184 66 L182 40 L162 56 Z" fill="#ffb3c6"/>`,
    band: `<path d="M54 100 C80 70 176 70 202 100" stroke="${p.accent}" stroke-width="10" fill="none" stroke-linecap="round"/>`,
  }[p.accessory ?? 'none'];
  const front = p.accessory === 'catears' ? accessory : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
    <rect width="256" height="256" fill="${p.bg}"/>
    ${p.back ? `<path d="${HAIR_BACK[p.back]}" fill="${shade(hair, 0.85)}"/>` : ''}
    ${front}
    <path d="M40 256 C44 214 80 196 128 196 C176 196 212 214 216 256 Z" fill="${p.shirt}"/>
    <path d="M104 198 L128 226 L152 198" fill="none" stroke="${shade(p.shirt, 0.75)}" stroke-width="6" stroke-linejoin="round"/>
    <rect x="114" y="178" width="28" height="26" rx="8" fill="${shade(skin, 0.9)}"/>
    <ellipse cx="128" cy="126" rx="72" ry="68" fill="${skin}"/>
    ${face({ eyes: p.eyes, mouth: p.mouth })}
    <path d="${HAIR_FRONT[p.front]}" fill="${hair}"/>
    ${p.locks ? `<path d="${sideLocks}" fill="${hair}"/>` : ''}
    ${p.ahoge ? `<path d="${ahoge}" fill="${hair}"/>` : ''}
    ${p.accessory !== 'catears' ? accessory : ''}
  </svg>`;
}

const CHIBI_PEOPLE = [
  { bg: '#e1f4ff', skin: 0, hair: '#2b2d42', back: null, front: 'spiky', eyes: '#2f6fd1', mouth: 'open', shirt: '#ff7a45', accessory: 'band', accent: '#2f6fd1' },
  { bg: '#ffe1ec', skin: 1, hair: '#e86a92', back: 'buns', front: 'fringe', eyes: '#b0306a', mouth: 'cat', shirt: '#ffffff', accessory: 'star' },
  { bg: '#e6f9ec', skin: 2, hair: '#3d2a22', back: 'bob', front: 'straight', eyes: '#2a9d6f', mouth: 'smile', shirt: '#1f9a5c', accessory: 'glasses' },
  { bg: '#fff2cc', skin: 0, hair: '#f2c14e', back: 'long', front: 'swept', eyes: '#2f6fd1', mouth: 'smile', shirt: '#5b8def', ahoge: true },
  { bg: '#efe6ff', skin: 3, hair: '#1d1d28', back: 'long', front: 'straight', eyes: '#7a3db8', mouth: 'calm', shirt: '#2b2d42', locks: true },
  { bg: '#dff7f3', skin: 4, hair: '#16161c', back: 'puff', front: 'fringe', eyes: '#3b2a20', mouth: 'open', shirt: '#ffcf4a', accessory: 'headphones', accent: '#1f9a5c' },
  { bg: '#ffe8d6', skin: 5, hair: '#d9432f', back: 'pony', front: 'swept', eyes: '#2a9d6f', mouth: 'smile', shirt: '#ffffff', accessory: 'band', accent: '#ffcf4a' },
  { bg: '#f0f0f0', skin: 1, hair: '#c9d1d9', back: 'bob', front: 'fringe', eyes: '#d98e04', mouth: 'cat', shirt: '#ff8fa3', accessory: 'catears', ahoge: true },
];

// ---------------------------------------------------------------- ALT originals: for AIs

/** Chibi robots: a round metal head with a screen face. */
function mecha(p) {
  const eyes = {
    dots: `<circle cx="104" cy="122" r="13" fill="${p.glow}" filter="url(#glow)"/><circle cx="152" cy="122" r="13" fill="${p.glow}" filter="url(#glow)"/>`,
    happy: `<path d="M90 128 Q104 108 118 128 M138 128 Q152 108 166 128" stroke="${p.glow}" stroke-width="8" fill="none" stroke-linecap="round" filter="url(#glow)"/>`,
    bars: `<rect x="88" y="114" width="32" height="12" rx="6" fill="${p.glow}" filter="url(#glow)"/><rect x="136" y="114" width="32" height="12" rx="6" fill="${p.glow}" filter="url(#glow)"/>`,
    mono: `<circle cx="128" cy="120" r="22" fill="${p.glow}" opacity="0.35"/><circle cx="128" cy="120" r="14" fill="${p.glow}" filter="url(#glow)"/><circle cx="123" cy="115" r="4" fill="#fff"/>`,
    wink: `<circle cx="104" cy="122" r="13" fill="${p.glow}" filter="url(#glow)"/><path d="M138 124 L166 124" stroke="${p.glow}" stroke-width="8" stroke-linecap="round" filter="url(#glow)"/>`,
  }[p.eyes];
  const top = {
    ball: `<path d="M128 56 L128 30" stroke="#5b6773" stroke-width="6"/><circle cx="128" cy="26" r="10" fill="${p.accent}" filter="url(#glow)"/>`,
    twin: `<path d="M96 60 L84 30 M160 60 L172 30" stroke="#5b6773" stroke-width="6" stroke-linecap="round"/><circle cx="84" cy="28" r="8" fill="${p.accent}"/><circle cx="172" cy="28" r="8" fill="${p.accent}"/>`,
    halo: `<ellipse cx="128" cy="36" rx="44" ry="10" fill="none" stroke="${p.accent}" stroke-width="6" filter="url(#glow)"/>`,
    fin: `<path d="M110 58 Q128 10 146 58 Z" fill="${p.accent}"/>`,
    none: '',
  }[p.top];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
    <rect width="256" height="256" fill="${p.bg}"/>
    <rect x="92" y="186" width="72" height="80" rx="22" fill="${shade(p.metal, 0.9)}"/>
    <circle cx="128" cy="222" r="10" fill="${p.accent}" filter="url(#glow)"/>
    <rect x="112" y="172" width="32" height="20" rx="6" fill="#3a4651"/>
    ${top}
    <circle cx="50" cy="118" r="16" fill="${p.accent}"/><circle cx="206" cy="118" r="16" fill="${p.accent}"/>
    <rect x="54" y="54" width="148" height="128" rx="44" fill="${p.metal}"/>
    <rect x="54" y="54" width="148" height="128" rx="44" fill="none" stroke="${shade(p.metal, 0.8)}" stroke-width="4"/>
    <rect x="74" y="80" width="108" height="78" rx="28" fill="#111b26"/>
    ${eyes}
    <path d="M114 144 Q128 152 142 144" stroke="${p.glow}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.8"/>
    <rect x="62" y="150" width="14" height="7" rx="3" fill="#ff8fa3" opacity="0.8"/><rect x="180" y="150" width="14" height="7" rx="3" fill="#ff8fa3" opacity="0.8"/>
  </svg>`;
}

const MECHA = [
  { bg: '#dff3ff', metal: '#e8eef4', glow: '#3de0ff', accent: '#ff7a45', eyes: 'dots', top: 'ball' },
  { bg: '#e6f9ec', metal: '#5ad1a5', glow: '#d6ff6b', accent: '#ffffff', eyes: 'happy', top: 'twin' },
  { bg: '#fff2cc', metal: '#ffcf5a', glow: '#62f0ff', accent: '#2b2d42', eyes: 'bars', top: 'fin' },
  { bg: '#1b2433', metal: '#9fb3c8', glow: '#ff5c8a', accent: '#ff5c8a', eyes: 'mono', top: 'halo' },
  { bg: '#ffe8d6', metal: '#ff8a65', glow: '#fff36b', accent: '#3d5afe', eyes: 'wink', top: 'ball' },
  { bg: '#e8ecff', metal: '#6f86ff', glow: '#7dffcf', accent: '#ffd34d', eyes: 'happy', top: 'halo' },
  { bg: '#10202a', metal: '#2fbf71', glow: '#c4ff4d', accent: '#c4ff4d', eyes: 'dots', top: 'twin' },
  { bg: '#f0f0f0', metal: '#ffffff', glow: '#3ddc84', accent: '#3ddc84', eyes: 'bars', top: 'none' },
];

/** Androids: chibi people with a glowing visor, a headset and a suit. */
function android(p) {
  const skin = p.skin;
  const hair = p.hair;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
    <rect width="256" height="256" fill="${p.bg}"/>
    ${p.back ? `<path d="${HAIR_BACK[p.back]}" fill="${shade(hair, 0.8)}"/>` : ''}
    <path d="M40 256 C44 214 80 196 128 196 C176 196 212 214 216 256 Z" fill="#1c2633"/>
    <path d="M86 256 L104 204 M170 256 L152 204" stroke="${p.glow}" stroke-width="4" filter="url(#glow)"/>
    <rect x="110" y="174" width="36" height="32" rx="8" fill="#2c3a4a"/>
    <path d="M110 186 L146 186 M110 196 L146 196" stroke="${p.glow}" stroke-width="2" opacity="0.7"/>
    <ellipse cx="128" cy="126" rx="72" ry="68" fill="${skin}"/>
    <path d="M70 172 L88 160 M186 172 L168 160" stroke="${shade(skin, 0.8)}" stroke-width="3" stroke-linecap="round"/>
    ${face({ mouth: p.mouth, visor: p.glow })}
    <path d="${HAIR_FRONT[p.front]}" fill="${hair}"/>
    ${p.streak ? `<path d="M150 46 C160 60 166 80 166 100 L152 120 C154 96 150 70 140 52 Z" fill="${p.glow}" opacity="0.85"/>` : ''}
    <circle cx="52" cy="134" r="18" fill="#2c3a4a"/><circle cx="52" cy="134" r="8" fill="${p.glow}" filter="url(#glow)"/>
    <circle cx="204" cy="134" r="18" fill="#2c3a4a"/><circle cx="204" cy="134" r="8" fill="${p.glow}" filter="url(#glow)"/>
  </svg>`;
}

const ANDROIDS = [
  { bg: '#dff3ff', skin: '#eef3f8', hair: '#ffffff', back: 'bob', front: 'fringe', glow: '#3de0ff', mouth: 'smile', streak: true },
  { bg: '#10202a', skin: '#dbe4ee', hair: '#20e3b2', back: 'long', front: 'straight', glow: '#20e3b2', mouth: 'calm' },
  { bg: '#ffe1ec', skin: '#f6e6ee', hair: '#ff5c8a', back: 'buns', front: 'fringe', glow: '#ff5c8a', mouth: 'cat' },
  { bg: '#1b2433', skin: '#c9d6e3', hair: '#1a1f2b', back: null, front: 'spiky', glow: '#ffb020', mouth: 'open', streak: true },
  { bg: '#e6f9ec', skin: '#e9f2ec', hair: '#2fbf71', back: 'pony', front: 'swept', glow: '#d6ff6b', mouth: 'smile' },
  { bg: '#e8ecff', skin: '#e4e9ff', hair: '#c9d1d9', back: 'long', front: 'swept', glow: '#7d8bff', mouth: 'calm', streak: true },
  { bg: '#fff2cc', skin: '#f3ece0', hair: '#2b2d42', back: 'bob', front: 'straight', glow: '#ff7a45', mouth: 'smile' },
  { bg: '#0c0d10', skin: '#d5dde6', hair: '#3ddc84', back: null, front: 'spiky', glow: '#3ddc84', mouth: 'open' },
];

/** AI cores: a glowing orb with orbiting rings. */
function core(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
    <defs><radialGradient id="o" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="${p.light}"/><stop offset="1" stop-color="${p.deep}"/></radialGradient>
    <radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="${p.light}" stop-opacity="0.45"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient></defs>
    <rect width="256" height="256" fill="${p.bg}"/>
    <circle cx="128" cy="128" r="118" fill="url(#h)"/>
    <ellipse cx="128" cy="128" rx="104" ry="34" fill="none" stroke="${p.ring}" stroke-width="5" opacity="0.8" transform="rotate(${p.tilt} 128 128)"/>
    <circle cx="128" cy="128" r="64" fill="url(#o)"/>
    <path d="M${128 - 104} 128 A104 34 0 0 0 ${128 + 104} 128" fill="none" stroke="${p.ring}" stroke-width="5" transform="rotate(${p.tilt} 128 128)"/>
    <ellipse cx="128" cy="128" rx="90" ry="22" fill="none" stroke="${p.ring}" stroke-width="2" opacity="0.6" transform="rotate(${-p.tilt * 1.6} 128 128)"/>
    <circle cx="${128 + 98 * Math.cos((p.tilt * Math.PI) / 180)}" cy="${128 + 98 * Math.sin((p.tilt * Math.PI) / 180)}" r="8" fill="#fff" filter="url(#glow)"/>
  </svg>`;
}

const CORES = [
  { bg: '#0c1620', light: '#6ff0ff', deep: '#0b5a8a', ring: '#9ff7ff', tilt: -18 },
  { bg: '#0b1a12', light: '#7dffb0', deep: '#0d6b3a', ring: '#c4ff4d', tilt: 14 },
  { bg: '#1a1020', light: '#ff9ad5', deep: '#8a1f5a', ring: '#ffd1ec', tilt: -30 },
  { bg: '#1c1608', light: '#ffd76a', deep: '#a8580c', ring: '#fff1b3', tilt: 22 },
  { bg: '#0e1024', light: '#9aa8ff', deep: '#2a2f9a', ring: '#3de0ff', tilt: -8 },
  { bg: '#e8f6ff', light: '#5fd3ff', deep: '#0d6fb8', ring: '#0d6fb8', tilt: 26 },
  { bg: '#ecfff4', light: '#4cef8b', deep: '#0e7a43', ring: '#138a45', tilt: -24 },
  { bg: '#120c0c', light: '#ff8a65', deep: '#9a2a12', ring: '#ffcf5a', tilt: 10 },
];

// ---------------------------------------------------------------- DiceBear sets

const PASTELS = ['ffe1ec', 'e1f4ff', 'e6f9ec', 'fff2cc', 'efe6ff', 'ffe8d6', 'dff7f3', 'f0f0f0'];
const SCIFI = ['10202a', 'dff3ff', '1b2433', 'e6f9ec', '0c1620', 'e8ecff', 'fff2cc', '0b1a12'];
const NAMES = ['Ayan', 'Mira', 'Zoya', 'Kian', 'Noor', 'Rafi', 'Lina', 'Omar'];
const dice = (style, options = {}, bgs = PASTELS) =>
  NAMES.map((seed, i) => createAvatar(style, { seed, size: SIZE, backgroundColor: [bgs[i % bgs.length]], ...options }).toString());

const SETS = [
  { kind: 'human', id: 'chibi', name: 'Chibi crew', credit: 'ALT original', items: CHIBI_PEOPLE.map(chibi) },
  { kind: 'human', id: 'lorelei', name: 'Lorelei', credit: 'Lorelei by Lisa Wischofsky (CC0 1.0), via DiceBear', items: dice(lorelei) },
  { kind: 'human', id: 'adventurer', name: 'Adventurer', credit: 'Adventurer by Lisa Wischofsky, licensed CC BY 4.0, via DiceBear', items: dice(adventurer) },
  { kind: 'human', id: 'notionists', name: 'Notionists', credit: 'Notionists by Zoish (CC0 1.0), via DiceBear', items: dice(notionists) },
  { kind: 'human', id: 'big-smile', name: 'Big Smile', credit: 'Big Smile by Ashley Seo, licensed CC BY 4.0, via DiceBear', items: dice(bigSmile) },
  { kind: 'ai', id: 'mecha', name: 'Mecha minis', credit: 'ALT original', items: MECHA.map(mecha) },
  { kind: 'ai', id: 'androids', name: 'Androids', credit: 'ALT original', items: ANDROIDS.map(android) },
  { kind: 'ai', id: 'cores', name: 'AI cores', credit: 'ALT original', items: CORES.map(core) },
  { kind: 'ai', id: 'bottts', name: 'Bottts', credit: 'Bottts by Pablo Stanley (free for personal and commercial use), via DiceBear', items: dice(bottts, {}, SCIFI) },
];

await rm(OUT, { recursive: true, force: true });
const manifest = { generatedBy: 'scripts/make-avatars.mjs', sets: [] };
for (const set of SETS) {
  const dir = new URL(`${set.kind}/${set.id}/`, OUT);
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const [i, svg] of set.items.entries()) {
    const file = `${String(i + 1).padStart(2, '0')}.png`;
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
    await writeFile(new URL(file, dir), png);
    files.push(file);
  }
  manifest.sets.push({ kind: set.kind, id: set.id, name: set.name, credit: set.credit, files });
  console.log(`${set.kind}/${set.id}: ${files.length}`);
}
await writeFile(new URL('manifest.json', OUT), `${JSON.stringify(manifest, null, 2)}\n`);
