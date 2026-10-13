#!/usr/bin/env node
// check-portal.mjs — the shared lint for every client portal page.
//
// A client page is DATA ONLY: a #portal-data JSON block, optional data blocks
// (#portal-payload, context JSON), markdown document bodies, and the two kit
// links. Everything about look and behavior lives in portal-kit. This gate
// keeps it that way and catches the mistakes that blank a page for a client.
// Node built-ins only, so a client repo runs it without installing anything.
//
//   node tools/check-portal.mjs [page.html]          (default: index.html)
//   node tools/check-portal.mjs page.html --strict   (warnings fail too)
//
// Exit 0 = clean. Exit 1 = errors (or warnings under --strict).
// Promoted from hirobius/access-tech-internal scripts/check-portal.mjs (v7).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const KIT_HOST = "portal-kit-adrian-6234s-projects.vercel.app";

/** Section types the kit renders. `tasks` / `list` are legacy within v-major. */
export const SECTION_TYPES = new Set([
  "assist", "callout", "status", "tasks", "list", "queue", "cards", "request",
  "updates", "accordions", "docs", "links", "diagram", "mermaid",
]);
export const LEGACY_TYPES = new Set(["tasks", "list"]);

const err = (line, rule, msg, fix) => ({ level: "error", line, rule, msg, fix });
const warn = (line, rule, msg, fix) => ({ level: "warn", line, rule, msg, fix });
const lineAt = (html, idx) => html.slice(0, idx).split("\n").length;

/** Every <script> with its type, id, src, body and 1-based line. */
export function extractScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const pick = (name) => (attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i")) || [])[1] || null;
    out.push({ type: pick("type"), id: pick("id"), src: pick("src"), body: m[2], line: lineAt(html, m.index) });
  }
  return out;
}

const isData = (s) => /application\/json|text\/markdown/i.test(s.type || "");

/** Embedded JSON must parse — a broken block blanks the page with no visible error. */
export function checkJson(scripts) {
  return scripts
    .filter((s) => /application\/json/i.test(s.type || ""))
    .flatMap((s) => {
      try { JSON.parse(s.body); return []; }
      catch (e) {
        return [err(s.line, "json-invalid", `JSON block ${s.id ? "#" + s.id : "(no id)"} does not parse: ${e.message}`,
          "Fix the JSON (usually a trailing comma or an unescaped quote).")];
      }
    });
}

/** No page-local code or styling: it belongs in the kit. */
export function checkNoLocalCode(html, scripts) {
  const findings = [];
  for (const s of scripts) {
    if (isData(s)) continue;
    if (s.src && s.src.includes(KIT_HOST) && /\/releases\/v\d+\/portal\.js$/.test(s.src)) continue;
    findings.push(err(s.line, "local-script",
      `page-local <script>${s.src ? ` src="${s.src}"` : ""} — client pages carry data only`,
      s.src && s.src.includes("_vercel/insights")
        ? 'Delete it and set "analytics": "vercel" in #portal-data; the kit injects the beacon.'
        : "Move the behavior into portal-kit (portal.js) and cut a release."));
  }
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const rules = m[1].replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
    const local = rules.filter((r) => !/^#fallback\b/.test(r));
    if (local.length) {
      findings.push(err(lineAt(html, m.index), "local-style",
        `page-local CSS (${local.length} rule${local.length > 1 ? "s" : ""}) beyond the #fallback rule`,
        "Move the styling into portal-kit theme.css and cut a release; keep only the #fallback rule here."));
    }
  }
  const linkRe = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    if (!new RegExp(`${KIT_HOST.replace(/\./g, "\\.")}/releases/v\\d+/theme\\.css`).test(m[0])) {
      findings.push(err(lineAt(html, m.index), "local-stylesheet", "stylesheet that isn't a pinned kit release",
        "Link only https://" + KIT_HOST + "/releases/vN/theme.css."));
    }
  }
  const pins = [...html.matchAll(/\/releases\/(v\d+)\/(?:theme\.css|portal\.js)/g)].map((x) => x[1]);
  if (new Set(pins).size > 1) {
    findings.push(err(1, "mixed-release", `theme.css and portal.js pin different releases (${[...new Set(pins)].join(", ")})`,
      "Pin both to the same releases/vN/ path."));
  }
  return findings;
}

/** Every bodyId must have a markdown block, and every markdown block must be used. */
export function checkBodyRefs(data, scripts, dataLine) {
  const refs = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      if (typeof x.bodyId === "string") refs.add(x.bodyId);
      Object.values(x).forEach(walk);
    }
  };
  walk(data);
  const present = new Set(scripts.filter((s) => /text\/markdown/i.test(s.type || "") && s.id).map((s) => s.id));
  const findings = [];
  for (const id of refs) if (!present.has(id))
    findings.push(err(dataLine, "body-ref-dangling", `bodyId "${id}" has no <script type="text/markdown" id="${id}">`,
      `Add the markdown block for "${id}", or remove the reference.`));
  for (const id of present) if (!refs.has(id))
    findings.push(warn(dataLine, "body-orphan", `markdown block #${id} is never referenced, so it never renders`,
      `Reference it with "bodyId": "${id}", or delete it.`));
  return findings;
}

/** Section types and v7 conventions. */
export function checkShape(data, dataLine) {
  const findings = [];
  const sections = Array.isArray(data.sections) ? data.sections : null;
  if (!sections) {
    findings.push(warn(dataLine, "legacy-shape", "top-level phases/updates/links/docs layout (no `sections`)",
      "Use the canonical `sections` array: status → updates → links → docs, then optional blocks."));
  }
  (sections || []).forEach((sec, i) => {
    const at = `sections[${i}]${sec && sec.id ? ` (${sec.id})` : ""}`;
    if (!sec || !SECTION_TYPES.has(sec.type)) {
      findings.push(err(dataLine, "unknown-section", `${at}: unknown section type "${sec && sec.type}"`,
        "Use a kit section type, or add the new type to portal-kit first."));
      return;
    }
    if (LEGACY_TYPES.has(sec.type))
      findings.push(warn(dataLine, "legacy-section", `${at}: "${sec.type}" is legacy in v7`,
        'Use a "status" section; items can carry owner/fields/steps and open on tap.'));
    if (sec.eyebrow)
      findings.push(warn(dataLine, "eyebrow", `${at}: "eyebrow" is not rendered in v7`, "Delete the key."));
  });
  if (data.header) findings.push(warn(dataLine, "legacy-header", '"header" is ignored in v7', "Delete the key."));
  if (data.footer && data.contact && data.contact.email)
    findings.push(warn(dataLine, "legacy-footer", '"footer.lines" is ignored when contact.email is set', "Delete the key."));
  if (!(data.contact && data.contact.email))
    findings.push(warn(dataLine, "no-contact", "no contact.email — the standard footer has no Questions? line",
      'Set "contact": { "email": "adrian@hirobius.com" }.'));
  return findings;
}

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bghp_[A-Za-z0-9]{36}\b/, "GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/, "GitHub fine-grained token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bAIza[0-9A-Za-z\-_]{35}\b/, "Google API key"],
  [/\bsk-(?:ant-)?[A-Za-z0-9-]{20,}\b/, "LLM API key"],
  [/\b(?:SITE_PASSWORD|OPS_GATE_PASSWORD|API_KEY|SECRET|TOKEN)\s*[:=]\s*["'][^"']{6,}["']/i, "hardcoded secret assignment"],
];
const INTERNAL_MARKERS = [/DO NOT SHIP/i, /DO NOT COMMIT/i, /\bFIXME\b/, /\bXXX\b/, /@internal\b/i];

export function checkText(html) {
  const findings = [];
  html.split("\n").forEach((text, i) => {
    const s = SECRET_PATTERNS.find(([re]) => re.test(text));
    if (s) findings.push(err(i + 1, "secret-leak", `possible ${s[1]} on a client-facing page`,
      "Remove it; secrets live in env vars only. Rotate it if it was real."));
    const mk = INTERNAL_MARKERS.find((re) => re.test(text));
    if (mk) findings.push(err(i + 1, "internal-marker", `internal-only marker (${mk.source})`,
      "Resolve or remove it before this ships to the client."));
  });
  return findings;
}

/** Blank out HTML comments (keeping line numbers) so prose about tags isn't parsed as tags. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));

export function runAllChecks(rawHtml) {
  const html = stripComments(rawHtml);
  const scripts = extractScripts(html);
  const findings = [...checkJson(scripts), ...checkNoLocalCode(html, scripts), ...checkText(html)];
  const dataBlock = scripts.find((s) => s.id === "portal-data");
  if (!dataBlock) {
    findings.push(err(1, "no-portal-data", 'no <script type="application/json" id="portal-data">', "Add the data block."));
  } else {
    let data = null;
    try { data = JSON.parse(dataBlock.body); } catch { /* json-invalid already reported */ }
    if (data) findings.push(...checkBodyRefs(data, scripts, dataBlock.line), ...checkShape(data, dataBlock.line));
  }
  return findings.sort((a, b) => a.line - b.line);
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const path = args.find((a) => !a.startsWith("--")) || "index.html";
  let html;
  try { html = await readFile(path, "utf8"); }
  catch (e) { console.error(`check-portal: cannot read ${path} — ${e.message}`); process.exit(2); }
  const findings = runAllChecks(html);
  const failing = findings.filter((f) => f.level === "error" || strict);
  if (!findings.length) { console.log(`check-portal: ${path} is clean ✓`); return; }
  for (const f of findings) {
    const out = failing.includes(f) ? console.error : console.log;
    out(`  ${path}:${f.line}  ${f.level}  [${f.rule}]  ${f.msg}\n      fix: ${f.fix}`);
  }
  if (failing.length) { console.error(`\ncheck-portal: ${failing.length} failing finding(s) in ${path}`); process.exit(1); }
  console.log(`\ncheck-portal: ${path} passes (${findings.length} warning(s))`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
