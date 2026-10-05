// Minimal client for the HAXcms v1 APIs (system + per-site), as exercised by
// scripts/api-smoke-test.mjs. Credentials come from the environment
// (see .env.local); nothing here logs them.
export async function connect({
  base = process.env.HAX_BASE || "http://localhost:3000",
  site = process.env.HAX_SITE || "learning-materials",
  username = process.env.HAX_USER || "admin",
  password = process.env.HAX_PASSWORD,
} = {}) {
  if (!password) throw new Error("Set HAX_PASSWORD (see .env.local)");

  async function call(method, path, { body, headers = {} } = {}) {
    // Outline saves: send only new, changed and deleted items. HAXcms
    // rewrites site.json and rebuilds its feeds and search index once per
    // item it's sent, so a whole-site outline took minutes (see
    // custom/src/outline/outline-model.js saveOutline)
    if (method === "PATCH" && path === "/x/api/v1/site/outline" && Array.isArray(body?.items)) {
      body = { ...body, items: body.items.filter((i) => i && (i.new || i.modified || i.delete)) };
      if (!body.items.length) return { ok: true, status: 200, json: { data: { items: [] } } };
    }
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ok: res.ok, json };
  }

  const login = await call("POST", "/system/api/v1/session/login", {
    body: { username, password },
  });
  if (!login.ok || typeof login.json?.jwt !== "string") {
    throw new Error(`login failed (${login.status})`);
  }
  const auth = { Authorization: `Bearer ${login.json.jwt}` };

  // connection-settings is served as a JS snippet: window.appSettings = {...}
  const conn = await call(
    "GET",
    `/system/api/v1/session/connection-settings?siteName=${site}`,
    { headers: auth },
  );
  const siteToken = String(conn.json).match(/"siteToken":"([^"]+)"/)?.[1];
  const userToken = String(conn.json).match(/"userToken":"([^"]+)"/)?.[1];
  if (!siteToken || !userToken) throw new Error("no site/user token in connection settings");
  // site API routes want the site token; system "actions" want the user token
  const headers = { ...auth, "X-HAXCMS-Site-Token": siteToken };
  const userHeaders = { ...auth, "X-HAXCMS-User-Token": userToken };
  const withSite = (body) => ({ site: { name: site }, ...body });

  return {
    call,
    headers,
    userHeaders,
    listItems: (query = "") =>
      call("GET", `/x/api/v1/items${query}`, { headers }),
    getItem: (id) => call("GET", `/x/api/v1/items/${id}`, { headers }),
    getContent: (id) => call("GET", `/x/api/v1/content/${id}`, { headers }),
    createItem: (node) =>
      call("POST", "/x/api/v1/items", { headers, body: withSite({ node }) }),
    updateItem: (id, operation, fields = {}) =>
      call("PATCH", `/x/api/v1/items/${id}`, {
        headers,
        body: withSite({ operation, ...fields }),
      }),
    deleteItem: (id) =>
      call("DELETE", `/x/api/v1/items/${id}`, { headers, body: withSite({}) }),
    /**
     * Save page HTML. The v1 content route hands the body to saveNode, which
     * only writes content that follows a <page-break>; a bare body returns
     * 200 and is silently dropped. So we always prepend one. Page metadata
     * (page-type, tags, icon, image, published, ...) rides on its attributes.
     */
    saveContent: (id, bodyHtml, { title, pageType, tags, published = true } = {}) => {
      const attrs = [`item-id="${id}"`];
      if (title) attrs.push(`title="${escapeAttr(title)}"`);
      if (pageType) attrs.push(`page-type="${escapeAttr(pageType)}"`);
      if (tags?.length) attrs.push(`tags="${escapeAttr(tags.join(","))}"`);
      // pageBreakParser only expands a bare `published` when a space follows
      // it, so a trailing bare attribute reads as unpublished; be explicit
      if (published) attrs.push('published="published"');
      return call("PATCH", `/x/api/v1/content/${id}`, {
        headers,
        body: withSite({ body: `<page-break ${attrs.join(" ")}></page-break>${bodyHtml}` }),
      });
    },
  };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
