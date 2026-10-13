#!/usr/bin/env node
// sync-links.mjs — write a client repo's links.json into its portal page.
//
// links.json (client repo root) is the ONE list of a client's links. Ops reads
// the whole file live; the portal shows the entries with audience "client" and
// publish !== false. This tool writes those entries into #portal-data so nobody
// edits the portal's list by hand and the two can't drift.
//
//   node tools/sync-links.mjs [page.html]            write the page if it differs
//   node tools/sync-links.mjs [page.html] --check    exit 1 if the page is stale
//
// `sections` pages: fills the `links` section (adds one before `docs` if absent).
// Legacy pages: sets the top-level "links" array.
// Promoted from hirobius/access-tech-internal scripts/sync-links.mjs (v7).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AUDIENCES = new Set(["client", "internal"]);

/** Validate links.json; returns human-readable problems. */
export function validateLinks(manifest) {
  const links = manifest && Array.isArray(manifest.links) ? manifest.links : null;
  if (!links) return ['links.json must be { "links": [ ... ] }'];
  const problems = [];
  const seen = new Set();
  links.forEach((l, i) => {
    const at = `links[${i}]${l && l.id ? ` (${l.id})` : ""}`;
    if (!l || typeof l !== "object") return problems.push(`${at}: not an object`);
    if (!l.id || typeof l.id !== "string") problems.push(`${at}: missing "id"`);
    else if (seen.has(l.id)) problems.push(`${at}: duplicate id "${l.id}"`);
    else seen.add(l.id);
    if (!l.title || typeof l.title !== "string") problems.push(`${at}: missing "title"`);
    if (typeof l.url !== "string" || !/^https:\/\//.test(l.url)) problems.push(`${at}: "url" must start with https://`);
    if (!AUDIENCES.has(l.audience)) problems.push(`${at}: "audience" must be "client" or "internal"`);
  });
  return problems;
}

/** The entries the client sees, in manifest order, trimmed to what the kit renders. */
export function clientLinks(manifest) {
  return manifest.links
    .filter((l) => l.audience === "client" && l.publish !== false)
    .map((l) => {
      const out = { title: l.title, url: l.url };
      if (l.section) out.section = l.section;
      if (l.summary) out.summary = l.summary;
      return out;
    });
}

/** Put `links` into the page data (pure; returns a new object). */
export function withLinks(data, links) {
  const next = structuredClone(data);
  if (Array.isArray(next.sections)) {
    const sec = next.sections.find((s) => s && s.type === "links");
    if (sec) sec.items = links;
    else {
      const added = { type: "links", id: "links", title: "Links", items: links };
      const docsAt = next.sections.findIndex((s) => s && s.type === "docs");
      next.sections.splice(docsAt < 0 ? next.sections.length : docsAt, 0, added);
    }
  } else {
    next.links = links;
  }
  return next;
}

const OPEN_RE = /(<script type="application\/json" id="portal-data">)([\s\S]*?)(<\/script>)/;

/** Return the page with its #portal-data rewritten to carry `links`. */
export function applyLinks(html, links) {
  const m = OPEN_RE.exec(html);
  if (!m) throw new Error('page has no <script type="application/json" id="portal-data">');
  const data = JSON.parse(m[2]);
  const next = withLinks(data, links);
  if (JSON.stringify(next) === JSON.stringify(data)) return html; // already in sync: no reformat
  const indent = (m[2].match(/\n([ \t]*)\S/) || [, "  "])[1];
  const closeIndent = (m[2].match(/\n([ \t]*)$/) || [, ""])[1];
  const body = JSON.stringify(next, null, 2).split("\n").map((l) => indent + l).join("\n");
  return html.slice(0, m.index) + m[1] + "\n" + body + "\n" + closeIndent + m[3] + html.slice(m.index + m[0].length);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const page = args.find((a) => !a.startsWith("--")) || "index.html";
  const manifest = JSON.parse(await readFile("links.json", "utf8"));
  const problems = validateLinks(manifest);
  if (problems.length) {
    console.error("sync-links: links.json has problems:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  const html = await readFile(page, "utf8");
  const next = applyLinks(html, clientLinks(manifest));
  if (next === html) { console.log(`sync-links: ${page} is in sync with links.json ✓`); return; }
  if (check) {
    console.error(`sync-links: ${page} is out of date with links.json. Fix: node tools/sync-links.mjs ${page}`);
    process.exit(1);
  }
  await writeFile(page, next);
  console.log(`sync-links: ${page} updated from links.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
