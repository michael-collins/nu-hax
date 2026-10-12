// WebVTT captions: read them (YouTube's manual or automatic captions, or a
// speech-to-text tool's output), clean them up, and turn them into the
// shapes scripts/video-*.mjs need: one line per caption, paragraphs for a
// page's transcript, and "[m:ss] text" for reading.
//
// YouTube's automatic captions repeat themselves: each cue shows the line
// before it plus the new line, with word timings (<00:00:01.230><c> word</c>)
// inline. clean() strips the tags and keeps each line once, at the time it
// first appears.

/** "00:01:02.500" or "01:02.5" → 62.5 */
export function seconds(stamp) {
  const parts = String(stamp).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** 62.5 → "1:02"; 3750 → "1:02:30" */
export function clock(t) {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 62.5 → "00:01:02.500" (a VTT cue time) */
export function vttTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** The cues of a VTT file: [{ start, end, lines: [text] }] */
export function parse(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [from, to] = lines[at].split("-->");
    const start = seconds(from);
    const end = seconds(to.trim().split(/\s+/)[0]);
    if (start === null || end === null) continue;
    const body = lines
      .slice(at + 1)
      .map((l) => decode(l.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (body.length) cues.push({ start, end, lines: body });
  }
  return cues;
}

/**
 * One entry per spoken line, in order: [{ start, end, text }]. Drops the
 * repeats of rolling captions and joins a cue's lines when they aren't
 * repeats. Corrections ({ "Hack CMS": "HAXcms" }) are applied to the text.
 */
export function clean(cues, corrections = {}) {
  const out = [];
  const recent = [];
  for (const cue of cues) {
    const fresh = cue.lines.filter((l) => !recent.includes(l));
    for (const l of cue.lines) {
      recent.push(l);
      if (recent.length > 4) recent.shift();
    }
    if (!fresh.length) {
      if (out.length) out[out.length - 1].end = Math.max(out[out.length - 1].end, cue.end);
      continue;
    }
    out.push({ start: cue.start, end: cue.end, text: correct(fresh.join(" "), corrections) });
  }
  // a line's end is at most the next line's start
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end, out[i + 1].start) || out[i].end;
  return out;
}

function correct(text, corrections) {
  let t = text;
  for (const [wrong, right] of Object.entries(corrections)) {
    const re = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")}\\b`, "gi");
    t = t.replace(re, right);
  }
  return t;
}

/** Lines back to a tidy VTT file. */
export function toVtt(lines) {
  return `WEBVTT\n\n${lines.map((l) => `${vttTime(l.start)} --> ${vttTime(l.end)}\n${l.text}`).join("\n\n")}\n`;
}

/**
 * Lines grouped into paragraphs of roughly `target` seconds, ending at the
 * end of a sentence when the captions have punctuation, and never longer
 * than `most` seconds: [{ start, text }]
 */
export function paragraphs(lines, { target = 40, most = 75 } = {}) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (!cur) cur = { start: l.start, parts: [] };
    cur.parts.push(l.text);
    const long = l.end - cur.start;
    if ((long >= target && /[.!?]["')\]]?$/.test(l.text)) || long >= most) {
      out.push({ start: cur.start, text: cur.parts.join(" ") });
      cur = null;
    }
  }
  if (cur) out.push({ start: cur.start, text: cur.parts.join(" ") });
  return out;
}

/** "[m:ss] text" lines, a paragraph each: what Claude reads. */
export function readable(lines, opts) {
  return paragraphs(lines, { target: 20, most: 40, ...opts })
    .map((p) => `[${clock(p.start)}] ${p.text}`)
    .join("\n");
}
