// Markdown footnotes, which HAXcms's md-to-html leaves as text, as standard
// footnote markup (the same shape markdown-it-footnote and GitHub produce):
//
//   text[^1]            → text<sup class="fn-ref" id="fnref-P-1"><a href="#fn-P-1">1</a></sup>
//   [^1]: The source.   → <section class="footnotes" aria-labelledby="fn-P-label">
//                           <h2 id="fn-P-label">References</h2>
//                           <ol><li id="fn-P-1">The source. <a href="#fnref-P-1" class="fn-back">↩</a></li></ol>
//                         </section>
//
// P is a short page id, so ids stay unique when several pages are shown
// together (a printed book). Notes are numbered in the order they're first
// cited; a note cited twice gets a back-link for each citation; notes never
// cited are listed after the rest.

const REF = /\[\^([\w-]+)\](?!:)/g;
const DEF = /\[\^([\w-]+)\]:\s*/;

export function hasFootnotes(html) {
  return /\[\^[\w-]+\]/.test(String(html));
}

export function footnotesToHtml(html, pageId = "p") {
  let s = String(html);
  if (!hasFootnotes(s)) return s;
  const P = String(pageId).replace(/^item-/, "").slice(0, 8) || "p";
  const id = (key) => `fn-${P}-${key}`;
  const refId = (key, n) => `fnref-${P}-${key}${n > 1 ? `-${n}` : ""}`;

  // 1. definitions: paragraphs that start with "[^key]:", possibly several
  //    notes in one paragraph, one per line
  const defs = new Map();
  s = s.replace(/<p>\s*(\[\^[\w-]+\]:[\s\S]*?)<\/p>\s*/g, (all, body) => {
    const parts = body.split(/(?:^|\n)\s*(?=\[\^[\w-]+\]:)/);
    for (const part of parts) {
      const m = part.match(DEF);
      if (!m) continue;
      defs.set(m[1], part.slice(m[0].length).trim());
    }
    return "";
  });
  if (!defs.size) return html;

  // 2. citations, numbered by first appearance
  const order = [];
  const seen = new Map(); // key -> times cited so far
  s = s.replace(REF, (all, key) => {
    if (!defs.has(key)) return all;
    if (!order.includes(key)) order.push(key);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const num = order.indexOf(key) + 1;
    return `<sup class="fn-ref" id="${refId(key, n)}"><a href="#${id(key)}">${num}</a></sup>`;
  });
  for (const key of defs.keys()) if (!order.includes(key)) order.push(key);

  // 3. the references list
  const items = order.map((key, i) => {
    const times = seen.get(key) || 0;
    const back = Array.from({ length: times }, (_, k) => {
      const label = times > 1 ? `Back to citation ${i + 1}${String.fromCharCode(97 + k)}` : `Back to citation ${i + 1}`;
      return ` <a href="#${refId(key, k + 1)}" class="fn-back" aria-label="${label}">↩${times > 1 ? `<sup>${String.fromCharCode(97 + k)}</sup>` : ""}</a>`;
    }).join("");
    return `  <li id="${id(key)}">${defs.get(key)}${back}</li>`;
  });
  const section = `<section class="footnotes" aria-labelledby="fn-${P}-label">\n<h2 id="fn-${P}-label">References</h2>\n<ol>\n${items.join("\n")}\n</ol>\n</section>\n`;
  return `${s.replace(/\s*$/, "\n")}${section}`;
}
