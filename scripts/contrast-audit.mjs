// WCAG 2.x contrast audit for the shadcn tokens in the custom theme.
//   node scripts/contrast-audit.mjs
// Parses light-dark(oklch(...), oklch(...)) declarations, converts OKLCH to
// sRGB, and checks the foreground/background pairs the theme actually uses.
import { readFileSync } from "node:fs";

const FILE = new URL(
  "../learning-materials/custom/src/tokens/shadcn-tokens.js",
  import.meta.url,
);
const src = readFileSync(FILE, "utf8");

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/;
const tokens = { light: {}, dark: {} };
for (const m of src.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
  const [, name, value] = m;
  const ld = value.match(/light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)/);
  if (ld) {
    tokens.light[name] = ld[1];
    tokens.dark[name] = ld[2];
  } else if (OKLCH.test(value)) {
    tokens.light[name] = tokens.dark[name] = value.match(OKLCH)[0];
  }
}

const toLab = (str) => {
  const [, L, C, H] = str.match(OKLCH).map(Number);
  const h = (H * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
};

// Hover colours, as components write them: color-mix(in oklab, <token>
// <100 - share>%, <other>), where other is a token or "black"
const MIXES = {
  // ui/oer-confirm.js .btn.destructive:hover
  "destructive-hover": ["destructive", "black", 12],
};
for (const mode of ["light", "dark"]) {
  for (const [name, [base, other, share]] of Object.entries(MIXES)) {
    const from = toLab(tokens[mode][base]);
    const to = other === "black" ? [0, 0, 0] : toLab(tokens[mode][other]);
    const [L, a, b] = from.map((v, i) => v + (to[i] - v) * (share / 100));
    const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    tokens[mode][name] = `oklch(${L.toFixed(6)} ${Math.hypot(a, b).toFixed(6)} ${H.toFixed(4)})`;
  }
}

function oklchToSrgb(str) {
  const [L, a, b] = toLab(str);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => Math.min(1, Math.max(0, c)));
}

const luminance = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
function contrast(fg, bg) {
  const [a, b] = [luminance(oklchToSrgb(fg)), luminance(oklchToSrgb(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [foreground, background, minimum] - 4.5 for text, 3 for UI/non-text
const PAIRS = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["link", "background", 4.5],
  ["link", "card", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["destructive-foreground", "destructive-hover", 4.5],
  ["primary", "background", 3],
  ["ring", "background", 3],
  ["input-border", "background", 3],
  // the layers in dark mode: frame (card), menus (popover), hover (accent)
  ["foreground", "muted", 4.5],
  ["foreground", "accent", 4.5],
  ["foreground", "popover", 4.5],
  ["muted-foreground", "popover", 4.5],
  ["muted-foreground", "accent", 4.5],
  ["link", "popover", 4.5],
  ["primary", "card", 3],
  ["input-border", "card", 3],
  ["input-border", "popover", 3],
  ["ring", "card", 3],
];

let failures = 0;
for (const mode of ["light", "dark"]) {
  console.log(`\n${mode}`);
  for (const [fg, bg, min] of PAIRS) {
    const f = tokens[mode][fg];
    const b = tokens[mode][bg];
    if (!f || !b) {
      console.log(`  ?    ${fg} on ${bg}: token missing`);
      continue;
    }
    const ratio = contrast(f, b);
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "pass" : "FAIL"} ${ratio.toFixed(2).padStart(5)} (>=${min}) ${fg} on ${bg}`);
  }
}
console.log(failures ? `\n${failures} failing pair(s)` : "\nall pairs pass");
process.exitCode = failures ? 1 : 0;
