// A throwaway copy of the site for the editor checks. It's copied from the
// working tree (or from HEAD), the theme is built inside the copy, and HAXcms
// serves it on its own port with JWT checks off, so the browser is signed in
// as an author and nothing a check saves reaches the real site or the
// custom/build the dev server on :3000 serves.
//
// Each port gets its own folder (WORK_DIR/<port>/), so several runs can go
// side by side. Servers are stopped by port, never by name: the dev server
// runs the same app.js.
import { spawn, execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, openSync, closeSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// the site to copy: learning-materials, or a checkout of it on a branch (EDITOR_CHECK_SITE)
export const SITE = (process.env.EDITOR_CHECK_SITE || new URL("../../../learning-materials/", import.meta.url).pathname).replace(/\/$/, "");
// where site copies and reports go: the system's temp folder unless set
export const WORK_DIR = process.env.EDITOR_CHECK_DIR || path.join(os.tmpdir(), "nu-hax-editor-check");
// the haxcms-nodejs server `hax serve` runs: the newest one npx has cached
// (HAX_APP picks another)
function haxApp() {
  const cache = path.join(os.homedir(), ".npm/_npx");
  const found = (existsSync(cache) ? readdirSync(cache) : [])
    .map((d) => path.join(cache, d, "node_modules/@haxtheweb/haxcms-nodejs/dist/app.js"))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] || "";
}
const HAX_APP = process.env.HAX_APP || haxApp();
export const DEFAULT_PORT = 3101;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Process ids listening on a port (not ones merely connected to it). */
export function listeners(port) {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    // lsof exits 1 when nothing matches
    return [];
  }
}

/** Stop whatever listens on the port and wait until it's free. */
export async function stopPort(port) {
  if (Number(port) === 3000) throw new Error("Refusing to stop port 3000: that's the real dev server");
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const pids = listeners(port);
    if (!pids.length) return;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {}
    }
    for (let i = 0; i < 50 && listeners(port).length; i++) await sleep(100);
  }
  if (listeners(port).length) throw new Error(`Port ${port} is still in use after SIGKILL`);
}

/** The folders one run on a port uses. */
export function paths(port) {
  const root = path.join(WORK_DIR, String(port));
  return {
    root,
    site: path.join(root, "site"),
    head: path.join(root, "head"),
    lock: path.join(root, "run.pid"),
    serverLog: path.join(root, "server.log"),
    buildLog: path.join(root, "build.log"),
  };
}

// one run per port: a second run on the same port would copy over the
// first one's site while it's being served
function takeLock(lock) {
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {}
    if (alive) throw new Error(`Another run (process ${pid}) is using this port; pick another with --port`);
  }
  writeFileSync(lock, String(process.pid));
}

/**
 * Copy the site into p.site. "worktree" copies the files as they are now,
 * uncommitted changes included; "head" copies the last commit, for runs
 * that mustn't see half-edited code. node_modules is linked, not copied.
 */
export function copySite(p, source = "worktree") {
  let from = SITE;
  if (source === "head") {
    rmSync(p.head, { recursive: true, force: true });
    mkdirSync(p.head, { recursive: true });
    execSync(`git -C "${SITE}" archive HEAD | tar -x -C "${p.head}"`, { stdio: ["ignore", "ignore", "inherit"] });
    from = p.head;
  } else if (source !== "worktree") {
    throw new Error(`--source must be worktree or head, not ${source}`);
  }
  mkdirSync(p.site, { recursive: true });
  // --delete resets anything an earlier run saved; excluded paths in the
  // copy (the node_modules link) are left alone
  execFileSync("rsync", ["-a", "--delete", "--exclude=/.git", "--exclude=node_modules", `${from}/`, `${p.site}/`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const modules = path.join(p.site, "custom/node_modules");
  if (!existsSync(modules)) symlinkSync(path.join(SITE, "custom/node_modules"), modules);
}

/** Build the theme inside the copy, as `npm run build` does in the real one. */
export function buildSite(p) {
  const log = openSync(p.buildLog, "w");
  const cwd = path.join(p.site, "custom");
  try {
    execFileSync(process.execPath, ["scripts/gen-lucide-icons.mjs"], { cwd, stdio: ["ignore", log, log] });
    execFileSync("npx", ["rollup", "-c"], { cwd, stdio: ["ignore", log, log] });
  } catch (e) {
    throw new Error(`The theme didn't build in the copy; see ${p.buildLog}`);
  } finally {
    closeSync(log);
  }
}

/**
 * Serve the copy on the port and wait until it answers 200. Throws if the
 * port is taken, since HAXcms would quietly move to the next free one.
 */
export async function serveSite(p, port, { timeout = 60000 } = {}) {
  if (listeners(port).length) throw new Error(`Port ${port} is already in use`);
  const log = openSync(p.serverLog, "w");
  const env = { ...process.env, HAXCMS_DISABLE_JWT_CHECKS: "true", PORT: String(port) };
  // development mode would watch custom/src and rebuild; production ignores
  // HAXCMS_DISABLE_JWT_CHECKS
  delete env.NODE_ENV;
  const child = spawn(process.execPath, [HAX_APP], { cwd: p.site, env, stdio: ["ignore", log, log] });
  closeSync(log);
  let exited = null;
  child.on("exit", (code) => (exited = code ?? "signal"));
  const server = { base: `http://localhost:${port}`, port, child };
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (exited !== null) throw new Error(`The server stopped (${exited}); see ${p.serverLog}`);
    try {
      const res = await fetch(`${server.base}/`);
      // answered by our copy, not something that took the port meanwhile
      if (res.status === 200 && listeners(port).includes(child.pid)) return server;
    } catch {}
    await sleep(250);
  }
  await stopServer(server);
  throw new Error(`The server didn't answer on ${server.base} within ${timeout / 1000} s; see ${p.serverLog}`);
}

/**
 * Stop a server serveSite started: by its port when it holds the port, and
 * by its own process otherwise (it never got the port, which may be
 * someone else's by now).
 */
export async function stopServer({ port, child }) {
  if (listeners(port).includes(child.pid)) await stopPort(port);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/**
 * Copy, build and serve the site on a port. Returns the base URL, the copy's
 * folder and stop(), which stops the server and, unless keep is set,
 * removes the copy. prepare(siteDir), if given, runs after copying and
 * before building, to add throwaway code or pages to the copy only (the
 * spikes use it).
 */
export async function startScratch({ port = DEFAULT_PORT, source = "worktree", keep = false, prepare = null, log = console.log } = {}) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1024) throw new Error(`Not a usable port: ${port}`);
  if (port === 3000) throw new Error("Refusing port 3000: that's the real dev server. Use --port 3101 or another free port");
  if (listeners(port).length) throw new Error(`Port ${port} is already in use; pick another with --port`);
  const p = paths(port);
  mkdirSync(p.root, { recursive: true });
  takeLock(p.lock);
  let server = null;
  // if this process dies without stop() (an uncaught error), the server
  // would outlive it: stop it on the way out, synchronously
  const onExit = () => {
    if (server && listeners(port).includes(server.child.pid)) {
      try {
        process.kill(server.child.pid, "SIGKILL");
      } catch {}
    }
  };
  process.on("exit", onExit);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (server) await stopServer(server);
    process.off("exit", onExit);
    if (!keep) rmSync(p.site, { recursive: true, force: true });
    rmSync(p.head, { recursive: true, force: true });
    rmSync(p.lock, { force: true });
  };
  try {
    let t = Date.now();
    copySite(p, source);
    log(`Copied the site (${source}) to ${p.site} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (prepare) await prepare(p.site);
    t = Date.now();
    buildSite(p);
    log(`Built the theme in the copy in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    t = Date.now();
    server = await serveSite(p, port);
    log(`Serving the copy on ${server.base} (ready in ${((Date.now() - t) / 1000).toFixed(1)} s)`);
    return { base: server.base, port, dir: p.site, paths: p, stop };
  } catch (e) {
    await stop().catch(() => {});
    throw e;
  }
}
