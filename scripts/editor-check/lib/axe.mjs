// axe-core in the page: injects axe.min.js and runs it over the whole
// document, open shadow roots included (axe walks them itself), and returns
// the violations grouped by impact. Also reads and compares the baseline
// counts the smoke check records.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
export const AXE_VERSION = require("axe-core/package.json").version;
// WCAG 2.2 AA, what the design system asks for
export const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const IMPACTS = ["critical", "serious", "moderate", "minor"];

/**
 * Run axe on the page. context narrows it (an axe context: a selector, or
 * {include, exclude}, with arrays of selectors to reach into shadow roots);
 * tags picks the rules; forcedColors emulates Windows high contrast for the
 * run. Returns {violations, nodes, byImpact: {critical: [...], …}, rules}.
 */
export async function runAxe(page, { context = null, tags = WCAG_AA, forcedColors = false } = {}) {
  // evaluate rather than a script tag: the page's CSP doesn't apply to it
  if (!(await page.evaluate(() => !!globalThis.axe))) await page.evaluate(`${AXE_SOURCE}\n;true`);
  // forced colors through a session of its own: puppeteer's
  // emulateMediaFeatures doesn't take it, and detaching the session puts the
  // page's own emulation (reduced motion) back as it was
  const forced = forcedColors ? await page.createCDPSession() : null;
  await forced?.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  try {
    const result = await page.evaluate(
      async (context, tags) => {
        const r = await globalThis.axe.run(context || document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact || "minor",
          help: v.help,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 5).map((n) => n.target),
        }));
      },
      context,
      tags,
    );
    return summarize(result);
  } finally {
    await forced?.detach();
  }
}

function summarize(rules) {
  const byImpact = Object.fromEntries(IMPACTS.map((i) => [i, rules.filter((r) => r.impact === i)]));
  return {
    violations: rules.length,
    nodes: rules.reduce((n, r) => n + r.nodes, 0),
    counts: Object.fromEntries(IMPACTS.map((i) => [i, byImpact[i].length])),
    byImpact,
    rules,
  };
}

/** The counts worth keeping for a baseline: rules and affected nodes, by rule. */
export function countsOf(result) {
  return {
    violations: result.violations,
    nodes: result.nodes,
    counts: result.counts,
    rules: Object.fromEntries(result.rules.map((r) => [r.id, { impact: r.impact, nodes: r.nodes }])),
  };
}

export function readBaseline(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/**
 * What's worse than the baseline: rules it didn't have, and rules that now
 * affect more nodes. An empty list means no new violations.
 */
export function newViolations(result, base) {
  const now = countsOf(result).rules;
  const was = base?.rules || {};
  return Object.entries(now)
    .filter(([id, r]) => !was[id] || r.nodes > was[id].nodes)
    .map(([id, r]) => `${id} (${r.impact}): ${was[id] ? `${was[id].nodes} → ${r.nodes}` : `new, ${r.nodes}`} nodes`);
}
