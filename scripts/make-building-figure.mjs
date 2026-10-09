// The loading figure: an isometric page assembling block by block on a
// plate (a header bar, lines of text, an image, a second column, then a
// blinking caret), drawn in the style of hairline (hairline.lucasmarkes.com):
// thin grey strokes, white faces, one dark accent. Writes
//   learning-materials/theme/building.svg and building-dark.svg, the empty
//     plate, which theme/theme.css shows while the site's code loads, and
//   learning-materials/custom/src/loader/building-figure.generated.js, the
//     animated figure, which site-loader.js draws in the page once it runs.
//   node scripts/make-building-figure.mjs
import { writeFileSync } from "node:fs";

const W = 400;
const H = 300;
const CX = 200;
const CY = 158;
const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
const iso = (x, y, z = 0) => [CX + (x - y) * C30, CY + (x + y) * S30 - z];
const f = (n) => Math.round(n * 100) / 100;
const pts = (list) => list.map(([x, y]) => `${f(x)} ${f(y)}`);

// a rounded rectangle in the plane (x, y), as points around it
function roundRect(x0, y0, w, d, r, steps = 4) {
  r = Math.min(r, w / 2, d / 2);
  const out = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x0 + w - r, y0 + r, -Math.PI / 2);
  corner(x0 + w - r, y0 + d - r, 0);
  corner(x0 + r, y0 + d - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  return out;
}

// a slab: its top face, the visible front of its sides, and its silhouette
// edges, filled so it hides what's behind it
function slab({ x, y, w, d, z = 0, h, r = 2, top = "front", side = "mid", extra = "" }) {
  const plane = roundRect(x, y, w, d, r);
  const topPts = plane.map(([px, py]) => iso(px, py, z + h));
  const botPts = plane.map(([px, py]) => iso(px, py, z));
  let li = 0;
  let ri = 0;
  topPts.forEach((p, i) => {
    if (p[0] < topPts[li][0]) li = i;
    if (p[0] > topPts[ri][0]) ri = i;
  });
  // the front chain: from the leftmost point to the rightmost, along the
  // side nearer the viewer (lower on screen)
  const chain = (list) => {
    const n = list.length;
    const a = [];
    for (let i = li; ; i = (i - 1 + n) % n) {
      a.push(list[i]);
      if (i === ri) break;
    }
    const b = [];
    for (let i = li; ; i = (i + 1) % n) {
      b.push(list[i]);
      if (i === ri) break;
    }
    const meanY = (c) => c.reduce((s, p) => s + p[1], 0) / c.length;
    return meanY(a) > meanY(b) ? a : b;
  };
  const topFront = chain(topPts);
  const botFront = chain(botPts);
  const sideFill = [...topFront, ...botFront.slice().reverse()];
  return `<g>
    ${h > 0 ? `<path class="fill" d="M${pts(sideFill).join("L")}Z"/>
    <path class="${side}" d="M${pts(botFront).join("L")}"/>
    <path class="${side}" d="M${pts([topPts[li], botPts[li]]).join("L")}M${pts([topPts[ri], botPts[ri]]).join("L")}"/>` : ""}
    <path class="fill ${top}" d="M${pts(topPts).join("L")}Z"/>${extra}
  </g>`;
}

// the page lies on the plate; things on it sit on its top face
const PAGE = { x: -56, y: -72, w: 112, d: 144 };
const ON = 6 + 3; // plate + page thickness
const at = (x, y) => [PAGE.x + x, PAGE.y + y];
const bar = (x, y, w, d, h) => slab({ x: at(x, y)[0], y: at(x, y)[1], w, d, z: ON, h, r: Math.min(1.5, d / 2), top: "front", side: "mid" });

// the image: a box with a sun and a hill drawn on its top face
const imgX = 10;
const imgY = 68;
const imgW = 44;
const imgD = 36;
const imgH = 9;
const [ix, iy] = at(imgX, imgY);
const sun = iso(ix + 31, iy + 10, ON + imgH);
const hill = [
  [ix + 5, iy + imgD - 6],
  [ix + 17, iy + 14],
  [ix + 26, iy + 24],
  [ix + 33, iy + 18],
  [ix + imgW - 4, iy + imgD - 6],
].map(([px, py]) => iso(px, py, ON + imgH));
const imageExtra = `<ellipse class="mid" cx="${f(sun[0])}" cy="${f(sun[1])}" rx="${f(4 * C30 * 1.15)}" ry="${f(4 * S30 * 1.15)}"/><path class="mid" d="M${pts(hill).join("L")}"/>`;

// layers in the order they arrive; each group animates in turn
const layers = [
  { name: "header", svg: bar(10, 10, 92, 16, 4) },
  { name: "line1", svg: bar(10, 36, 84, 5, 1.5) },
  { name: "line2", svg: bar(10, 46, 92, 5, 1.5) },
  { name: "line3", svg: bar(10, 56, 62, 5, 1.5) },
  { name: "image", svg: slab({ x: ix, y: iy, w: imgW, d: imgD, z: ON, h: imgH, r: 2, top: "front", side: "mid", extra: imageExtra }) },
  { name: "col1", svg: bar(62, 70, 40, 5, 1.5) },
  { name: "col2", svg: bar(62, 80, 40, 5, 1.5) },
  { name: "col3", svg: bar(62, 90, 28, 5, 1.5) },
  { name: "line4", svg: bar(10, 114, 88, 5, 1.5) },
  { name: "line5", svg: bar(10, 124, 56, 5, 1.5) },
];
// the caret: a small dark mark after the last line
const [cx0, cy0] = at(70, 124);
const caret = iso(cx0, cy0 + 2.5, ON + 1.5);

// each layer is drawn as its own small <svg>, cropped to what it covers,
// so the browser can move and fade it on the compositor: animating shapes
// inside one SVG repaints it every frame on the main thread, which is busy
// starting the site and made the figure stutter
const DROP = 14;
function box(markup) {
  const xs = [];
  const ys = [];
  for (const [, d] of markup.matchAll(/ d="([^"]+)"/g)) {
    const n = d.match(/-?[\d.]+/g).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) {
      xs.push(n[i]);
      ys.push(n[i + 1]);
    }
  }
  for (const [, cx, cy, rx, ry] of markup.matchAll(/cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.-]+)" ry="([\d.-]+)"/g)) {
    xs.push(+cx - +rx, +cx + +rx);
    ys.push(+cy - +ry, +cy + +ry);
  }
  const pad = 2;
  const x = Math.floor(Math.min(...xs) - pad);
  const y = Math.floor(Math.min(...ys) - pad);
  return { x, y, w: Math.ceil(Math.max(...xs) + pad) - x, h: Math.ceil(Math.max(...ys) + pad) - y };
}
const pc = (n, of) => `${f((n / of) * 100)}%`;
const piece = (cls, markup) => {
  const b = box(markup);
  return { b, svg: `<svg class="l ${cls}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" style="left:${pc(b.x, W)};top:${pc(b.y, H)};width:${pc(b.w, W)};height:${pc(b.h, H)}">${markup}</svg>` };
};

// timing, as fractions of one cycle: each layer drops in over `dur`
const CYCLE = 5.6;
const dur = 0.07;
const starts = [0.04, 0.13, 0.19, 0.25, 0.33, 0.43, 0.49, 0.55, 0.62, 0.68];
const caretFrom = 0.76;
const fadeAt = 0.92;
// the page is complete here (every layer down, the caret showing): where
// site-loader.js holds the figure before dissolving the loading screen
const builtAt = 0.86;
const pct = (n) => `${f(n * 100)}%`;

const pieces = layers.map((l) => piece(l.name, l.svg));
const caretMark = `<ellipse class="caret" cx="${f(caret[0])}" cy="${f(caret[1])}" rx="2.6" ry="2.6"/>`;
const caretPiece = piece("caret", caretMark);
// the drop is a share of each piece's own height, so it stays a transform
const keyframes = layers
  .map((l, i) => {
    const up = `translateY(${f((-DROP / pieces[i].b.h) * 100)}%)`;
    return `@keyframes ${l.name}{0%,${pct(starts[i])}{opacity:0;transform:${up}}${pct(starts[i] + dur)}{opacity:1;transform:translateY(0)}${pct(fadeAt)}{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(0)}}
.${l.name}{animation:${l.name} ${CYCLE}s cubic-bezier(.2,.7,.2,1) infinite}`;
  })
  .join("\n");
const caretKeys = `@keyframes caret{0%,${pct(caretFrom)}{opacity:0}${pct(caretFrom + 0.005)},${pct(caretFrom + 0.04)}{opacity:1}${pct(caretFrom + 0.045)},${pct(caretFrom + 0.08)}{opacity:0}${pct(caretFrom + 0.085)},${pct(fadeAt)}{opacity:1}100%{opacity:0}}
svg.caret{animation:caret ${CYCLE}s steps(1,end) infinite}`;

// the faces are filled with the site's own background, so the figure reads
// as lines on the page (theme.css paints the loading screen the same)
const colours = {
  light: "--fill:#f7f8f8;--front:#85858f;--mid:#ababb4;--faint:#cfcfd6;--accent:#18181b",
  dark: "--fill:#17181c;--front:#8a8a94;--mid:#5c5c66;--faint:#3a3a42;--accent:#f4f4f5",
};
const strokes = `path,ellipse{vector-effect:non-scaling-stroke;stroke-width:1;stroke-linejoin:round;stroke-linecap:round;fill:none}
.fill{fill:var(--fill)}
.front{stroke:var(--front)}
.mid{stroke:var(--mid)}
.faint{stroke:var(--faint)}
.caret{fill:var(--accent)}`;
const base = `${slab({ x: -88, y: -100, w: 176, d: 200, z: 0, h: 6, r: 12, top: "faint", side: "faint" })}
${slab({ x: PAGE.x, y: PAGE.y, w: PAGE.w, d: PAGE.d, z: 6, h: 3, r: 4, top: "front", side: "mid" })}`;

// as images, the empty plate the figure starts from, shown until the
// site's code runs: one per colour scheme, since an image can't see the
// page's (theme.css picks one)
const file = (scheme) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="A page about to be built">
<style>
svg{${colours[scheme]}}
${strokes}
</style>
${base}
</svg>
`;
// in the page: inside a shadow root, coloured by its host's [dark]
const css = `:host{display:block;position:relative;${colours.light}}
:host([dark]){${colours.dark}}
svg{position:absolute;display:block;overflow:visible}
svg.base{inset:0;width:100%;height:100%}
.l{will-change:transform,opacity}
${strokes}
${keyframes}
${caretKeys}
@media (prefers-reduced-motion:reduce){.l{animation:none!important;opacity:1!important;transform:none!important}}`;
const markup = `<svg class="base" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${base}
</svg>
${pieces.map((p) => p.svg).join("\n")}
${caretPiece.svg}`;
const module = `// Generated by nu-hax/scripts/make-building-figure.mjs; don't edit.
export const CYCLE_MS = ${CYCLE * 1000};
export const BUILT_AT = ${builtAt};
export const FIGURE_CSS = ${JSON.stringify(css)};
export const FIGURE_HTML = ${JSON.stringify(markup)};
`;
const out = (rel, text) => {
  writeFileSync(new URL(`../learning-materials/${rel}`, import.meta.url), text);
  console.log(`wrote ${rel} (${text.length} bytes)`);
};
out("theme/building.svg", file("light"));
out("theme/building-dark.svg", file("dark"));
out("custom/src/loader/building-figure.generated.js", module);
