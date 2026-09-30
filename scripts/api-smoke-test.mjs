// Smoke test for the HAXcms site API write routes against a local `hax serve`.
// Run with: node --env-file=.env.local scripts/api-smoke-test.mjs
// .env.local (gitignored) holds HAX_USER / HAX_PASSWORD, the local dev
// credentials HAXcms prints once when it seeds ~/.haxcmsconfig/.user.
const BASE = process.env.HAX_BASE || "http://localhost:3000";
const SITE = process.env.HAX_SITE || "learning-materials";
const name = process.env.HAX_USER || "admin";
const password = process.env.HAX_PASSWORD;
if (!password) {
  console.error("Set HAX_PASSWORD (see .env.local)");
  process.exit(1);
}

async function call(method, path, { body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function log(step, r, pick = (j) => j) {
  const ok = r.status >= 200 && r.status < 300;
  console.log(`${ok ? "PASS" : "FAIL"} ${r.status} ${step}`);
  if (!ok || process.env.VERBOSE) {
    console.log("     ", JSON.stringify(pick(r.json)).slice(0, 400));
  }
  return ok;
}

const login = await call("POST", "/system/api/v1/session/login", {
  body: { username: name, password },
});
log("login", login, (j) => j?.data?.message ?? j);
const jwt = login.json?.jwt ?? login.json?.data?.jwt ?? login.json?.data;
if (typeof jwt !== "string") {
  console.log("     login response keys:", Object.keys(login.json?.data ?? login.json ?? {}));
  process.exit(1);
}
const auth = { Authorization: `Bearer ${jwt}` };

const conn = await call(
  "GET",
  `/system/api/v1/session/connection-settings?siteName=${SITE}`,
  { headers: auth },
);
// connection-settings returns a JS snippet (`window.appSettings = {...}`), not JSON
log("connection-settings", conn, () => "(javascript)");
const siteToken = String(conn.json).match(/"siteToken":"([^"]+)"/)?.[1];
if (!siteToken) {
  console.log("     no siteToken found in connection settings");
  process.exit(1);
}
const h = { ...auth, "X-HAXCMS-Site-Token": siteToken };

const created = await call("POST", "/x/api/v1/items", {
  headers: h,
  body: { site: { name: SITE }, node: { title: "API smoke test page" } },
});
log("create item", created);
const item = created.json?.data?.item ?? created.json?.data;
const id = item?.id ?? created.json?.data?.items?.[0]?.id;
console.log("      created id:", id);
if (!id) process.exit(1);

// Known issue: a bare HTML body returns 200 but is never written, because
// saveNode runs it through HAXCMS.pageBreakParser(), which only matches
// content that follows a <page-break> element.
log(
  "patch content (bare body; expect silent no-op)",
  await call("PATCH", `/x/api/v1/content/${id}`, {
    headers: h,
    body: { site: { name: SITE }, body: "<p>bare body</p>" },
  }),
);
const bare = await call("GET", `/x/api/v1/content/${id}`, { headers: h });
console.log("      bare body persisted:", String(bare.json?.data?.body).includes("bare body"));

// Workaround: wrap the body in a <page-break>. Page metadata is read from a
// fixed allow-list of its attributes (page-type, tags, icon, image, ...).
log(
  "patch content (page-break wrapped, page-type=rubric)",
  await call("PATCH", `/x/api/v1/content/${id}`, {
    headers: h,
    body: {
      site: { name: SITE },
      body:
        `<page-break title="API smoke test page" item-id="${id}" page-type="rubric" tags="api,test" published="published"></page-break>` +
        "<h2>Edited via API</h2><p>Hello from the smoke test.</p>",
    },
  }),
);

log(
  "patch item setTitle",
  await call("PATCH", `/x/api/v1/items/${id}`, {
    headers: h,
    body: { site: { name: SITE }, operation: "setTitle", title: "API smoke test (renamed)" },
  }),
);

const readItem = await call("GET", `/x/api/v1/items/${id}`, { headers: h });
log("read item back", readItem);
const rec = readItem.json?.data;
console.log("      title:", rec?.title, "| metadata.pageType:", rec?.metadata?.pageType);

const readContent = await call("GET", `/x/api/v1/content/${id}`, { headers: h });
log("read content back", readContent);
const html = readContent.json?.data?.content ?? readContent.json?.data?.body ?? "";
console.log("      content has edit:", String(html).includes("Edited via API"));

const filtered = await call("GET", `/x/api/v1/items?filter.pageType=rubric`, { headers: h });
log("filter items by pageType", filtered);
const list = filtered.json?.data?.items ?? filtered.json?.data ?? [];
console.log("      matches:", Array.isArray(list) ? list.map((i) => i.id) : list);

const revs = await call("GET", `/x/api/v1/items/${id}/revisions`, { headers: h });
log("list revisions", revs);

if (!process.env.KEEP) {
  log(
    "delete item",
    await call("DELETE", `/x/api/v1/items/${id}`, { headers: h, body: { site: { name: SITE } } }),
  );
}
