import { footnotesToHtml } from "./footnotes.mjs";
// Decap markdown → HAX page HTML. md-to-html (a HAXcms system action)
// escapes raw HTML, so MDC components are swapped for placeholder
// paragraphs before conversion and restored as web components afterwards.
// Each Decap component maps to the site block that ports it.
export const MDC_BLOCKS = {
  "rubric-component": { tag: "oer-rubric", attrs: { id: "rubric-id" } },
  "iframe-component": { tag: "oer-iframe" },
  "video-component": { tag: "oer-video" },
  "google-slides-component": { tag: "oer-google-slides", attrs: { id: "slides" } },
  "sketchfab-component": { tag: "oer-sketchfab" },
  "threed-viewer-component": { tag: "oer-3d-viewer" },
  "code-embed-component": { tag: "oer-code-embed" },
  "content-divider": { tag: "oer-divider" },
  spacer: { tag: "oer-spacer" },
};
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const escapeAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function mdcToElement(name, attrText, table = MDC_BLOCKS) {
  const map = table[name];
  if (!map) return null;
  const attrs = [];
  // key="value", key='value', :key="value" (bound) or bare boolean keys
  for (const m of attrText.matchAll(/:?([A-Za-z][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
    const key = m[1];
    const value = m[2] ?? m[3];
    const attr = map.attrs?.[key] || kebab(key);
    if (value === undefined || value === "true") attrs.push(attr);
    else attrs.push(`${attr}="${escapeAttr(value)}"`);
  }
  return `<${map.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}></${map.tag}>`;
}

// container components (:::name{…} markdown :::) → opening/closing tags
// around the normally converted markdown inside
export const MDC_CONTAINERS = {
  callout: { tag: "oer-callout" },
  accordion: { tag: "a11y-collapse", attrs: { title: "heading" } },
};

export function extractMdc(md) {
  const blocks = [];
  const stash = (tag) => `\n\nHAXBLOCK${blocks.push(tag) - 1}\n\n`;
  md = md.replace(/^:::([a-z][a-z0-9-]*)\{([^}]*)\}\s*\n([\s\S]*?)\n:::\s*$/gm, (whole, name, attrText, inner) => {
    const map = MDC_CONTAINERS[name];
    if (!map) return whole;
    const open = mdcToElement(name, attrText, { [name]: map }).replace(/<\/[a-z0-9-]+>$/, "");
    return `${stash(open)}${inner}${stash(`</${map.tag}>`)}`;
  });
  const out = md.replace(/::([a-z][a-z0-9-]*)\{([^}]*)\}\s*\n::/g, (whole, name, attrText) => {
    const el = mdcToElement(name, attrText);
    return el ? stash(el) : whole;
  });
  return { md: out, blocks };
}
export function restoreMdc(html, blocks) {
  return html.replace(/<p>HAXBLOCK(\d+)<\/p>/g, (_, i) => blocks[Number(i)]);
}


/**
 * Markdown with MDC components → HTML, through the site's md-to-html action.
 * Footnotes ("[^1]"), which md-to-html leaves as text, become footnote
 * markup with a References list; pageId keeps their ids unique.
 */
export async function decapMarkdownToHtml(api, md, pageId = "p") {
  const { md: plain, blocks } = extractMdc(md);
  const r = await api.call("POST", "/system/api/v1/actions/md-to-html", { headers: api.userHeaders, body: { md: plain } });
  if (!r.ok) throw new Error(`md-to-html failed (${r.status})`);
  return footnotesToHtml(restoreMdc(r.json.data.contents, blocks), pageId);
}
