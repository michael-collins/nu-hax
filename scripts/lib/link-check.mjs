// Whether outside pages still answer, for the site's link checks (the local
// helper's /links/check, scripts/check-links.mjs, the Canvas import CLI).
// Each address gets one of:
//   ok       it answers
//   moved    it sends you on, for good, to another address (the new one is `final`)
//   dead     not found (404, 410), its domain is gone, or nothing answers;
//            `archive` is the Internet Archive's copy when it has one
//   private  it needs a sign-in (Google Docs shared to a school, say)
//   unknown  it couldn't be checked: it timed out, was busy, refused
//            automated checks (403), or points at a private network
// YouTube and Vimeo answer even for removed videos, so they're asked
// through their oEmbed endpoints instead.
// Only public http(s) addresses are fetched (never this computer or a local
// network), with HEAD first and a GET when a site refuses HEAD.
import dns from "node:dns/promises";
import net from "node:net";

const UA = "Mozilla/5.0 (compatible; OER-link-check/1.0; +https://github.com/open-curriculum)";
const SIGN_IN = /(^|\.)accounts\.google\.com$|(^|\.)login\.|(^|\.)sso\.|(^|\.)idp\.|(^|\.)webaccess\.|(^|\.)auth\.|(^|\.)okta\.com$|(^|\.)microsoftonline\.com$/i;
const SIGN_IN_PATH = /\/(login|signin|sign-in|sso|saml|cas\/login|auth)(\/|$|\?)/i;

// private, loopback and link-local addresses are never fetched
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function publicHost(host) {
  if (!host || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return false;
  if (net.isIP(host)) return !isPrivate(host);
  try {
    const all = await dns.lookup(host, { all: true });
    return all.length > 0 && all.every((r) => !isPrivate(r.address));
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") throw Object.assign(new Error("its domain no longer exists"), { dead: true });
    throw err;
  }
}

// the YouTube page to ask oEmbed about: a video's or a playlist's
// (embed/videoseries?list=… is a playlist, not a video)
const youtubePage = (u) => {
  if (/(^|\.)youtu\.be$/.test(u.hostname)) {
    const id = u.pathname.slice(1).split("/")[0];
    return id ? `https://www.youtube.com/watch?v=${id}` : "";
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return "";
  const id = u.searchParams.get("v") || u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{6,})/)?.[2] || "";
  if (id && id !== "videoseries") return `https://www.youtube.com/watch?v=${id}`;
  const list = u.searchParams.get("list");
  return list ? `https://www.youtube.com/playlist?list=${list}` : "";
};

async function oembed(endpoint, timeout) {
  const res = await fetch(endpoint, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
  res.body?.cancel().catch(() => {});
  return res.status;
}

// a video: removed (404), private or not embeddable (401/403), or there
async function checkVideo(u, timeout) {
  const yt = youtubePage(u);
  let status = 0;
  if (yt) status = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(yt)}`, timeout);
  else if (/(^|\.)vimeo\.com$/.test(u.hostname) && /\/\d+/.test(u.pathname)) status = await oembed(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.href)}`, timeout);
  else return null;
  if (status >= 200 && status < 300) return { status: "ok", code: status };
  const what = yt.includes("/playlist?") ? "playlist" : "video";
  if (status === 404 || status === 400) return { status: "dead", code: status, note: `the ${what} was removed, or made private` };
  if (status === 401 || status === 403) return { status: "private", code: status, note: `the ${what} is private or can't be embedded` };
  return { status: "unknown", code: status, note: `the video site answered ${status}` };
}

// one request, no redirects followed
async function request(url, method, timeout) {
  const res = await fetch(url, { method, redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }, signal: AbortSignal.timeout(timeout) });
  res.body?.cancel().catch(() => {});
  return res;
}

/** Check one address. → { url, status, code, final, note } */
export async function checkLink(url, { timeout = 10000 } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, status: "dead", note: "it isn't a valid address" };
  }
  if (!/^https?:$/.test(u.protocol)) return { url, status: "unknown", note: "not a web address" };
  try {
    if (!(await publicHost(u.hostname))) return { url, status: "unknown", note: "a private or local address: not checked" };
    const video = await checkVideo(u, timeout);
    if (video) return { url, ...video };
    let current = u.href;
    let permanent = false;
    for (let hop = 0; hop < 7; hop++) {
      let res = await request(current, "HEAD", timeout);
      // some sites refuse HEAD, or answer it wrongly: ask again with GET
      if ([403, 404, 405, 406, 429, 500, 501, 502, 503].includes(res.status) || (res.status >= 300 && res.status < 400 && !res.headers.get("location"))) res = await request(current, "GET", timeout).catch(() => res);
      const code = res.status;
      if (code >= 300 && code < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location"), current);
        if (!/^https?:$/.test(next.protocol)) return { url, status: "unknown", code, note: "it sends you somewhere that isn't a web address" };
        if (!(await publicHost(next.hostname))) return { url, status: "unknown", code, note: "it sends you to a private address" };
        if (SIGN_IN.test(next.hostname) || SIGN_IN_PATH.test(next.pathname)) return { url, status: "private", code, final: next.href, note: "it needs a sign-in" };
        if (code === 301 || code === 308) permanent = true;
        current = next.href;
        continue;
      }
      const same = (a, b) => a.replace(/^http:/, "https:").replace(/\/$/, "") === b.replace(/^http:/, "https:").replace(/\/$/, "");
      if (code >= 200 && code < 300) {
        const end = new URL(current);
        // a deep link that now lands on the home page: the page is gone
        if (current !== u.href && u.pathname.length > 1 && (end.pathname === "/" || end.pathname === "") && !end.search) return { url, status: "dead", code, final: current, note: "it now goes to the site's home page" };
        if (permanent && !same(current, u.href)) return { url, status: "moved", code, final: current, note: "it has a new address" };
        return { url, status: "ok", code, ...(same(current, u.href) ? {} : { final: current }) };
      }
      if (code === 404 || code === 410) return { url, status: "dead", code, note: code === 410 ? "the page was taken down" : "not found" };
      if (code === 401 || code === 407) return { url, status: "private", code, note: "it needs a sign-in" };
      if (code === 403) return { url, status: "unknown", code, note: "the site refused the check (it may need a sign-in, or block automated checks)" };
      if (code === 429) return { url, status: "unknown", code, note: "the site was too busy to answer" };
      if (code >= 300 && code < 400) return { url, status: "unknown", code, note: "it sends you on, but doesn't say where" };
      return { url, status: "unknown", code, note: `the site answered ${code}` };
    }
    return { url, status: "unknown", note: "it sends you round in circles" };
  } catch (err) {
    const cause = err.cause?.code || err.code || "";
    if (err.dead) return { url, status: "dead", note: err.message };
    if (err.name === "TimeoutError" || cause === "UND_ERR_CONNECT_TIMEOUT") return { url, status: "unknown", note: "it didn't answer in time" };
    if (cause === "ECONNREFUSED") return { url, status: "dead", note: "nothing answers there" };
    if (cause === "ENOTFOUND") return { url, status: "dead", note: "its domain no longer exists" };
    if (/CERT|SSL|TLS/i.test(cause)) return { url, status: "unknown", note: "its security certificate is wrong or out of date" };
    return { url, status: "unknown", note: `it couldn't be reached (${cause || err.message})` };
  }
}

/** The Internet Archive's closest copy of an address: { url, date } or null. */
export async function archivedCopy(url, { timeout = 10000 } = {}) {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
    const snap = (await res.json())?.archived_snapshots?.closest;
    if (!snap?.available || !/^2\d\d$/.test(String(snap.status || "200"))) return null;
    const t = String(snap.timestamp || "");
    return { url: snap.url.replace(/^http:/, "https:"), date: t.length >= 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : "" };
  } catch {
    return null;
  }
}

/**
 * Check many addresses, a few at a time (and one at a time per site, so no
 * site is hammered). Dead ones get the archive's copy when there is one.
 * onResult(result) as each finishes. → results in the order given
 */
export async function checkLinks(urls, { concurrency = 6, timeout = 10000, archive = true, onResult = () => {} } = {}) {
  const list = [...new Set(urls)];
  const results = new Map();
  const busyHosts = new Set();
  const hostOf = (x) => {
    try {
      return new URL(x).hostname;
    } catch {
      return x;
    }
  };
  const queue = [...list];
  const next = () => {
    const i = queue.findIndex((x) => !busyHosts.has(hostOf(x)));
    return i < 0 ? (queue.length ? queue.shift() : null) : queue.splice(i, 1)[0];
  };
  const worker = async () => {
    for (let url = next(); url; url = next()) {
      const host = hostOf(url);
      busyHosts.add(host);
      const r = await checkLink(url, { timeout });
      if (archive && r.status === "dead") {
        const copy = await archivedCopy(url, { timeout });
        if (copy) r.archive = copy;
      }
      busyHosts.delete(host);
      results.set(url, r);
      onResult(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return list.map((u) => results.get(u));
}
