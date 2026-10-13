// Outcome checks for the portal site. Each one guards a promise the portal
// makes: the page renders, the Copy-for-AI handoff matches the page and the
// code, the download is current, and the shared code stays browser-safe and
// free of our internal settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEFAULT_WEIGHTS } from '../tool/lib/profile.mjs';
import { buildToolZip, ZIP_PATH } from '../scripts/pack-tool.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROUTES = new Set(['/password']); // served by the sign-in gate, not a file
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('index.html');
const block = (id) => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html)[1]);
const data = block('portal-data');
const payload = block('portal-payload');
const phase = (id) => data.sections.find((s) => s.type === 'status').phases.find((p) => p.id === id);

test('the portal page passes the kit check (strict) and its links are in sync', () => {
  for (const args of [['scripts/kit/check-portal.mjs', 'index.html', '--strict'], ['scripts/kit/sync-links.mjs', 'index.html', '--check']]) {
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args[0]}:\n${r.stdout}${r.stderr}`);
  }
});

test('Copy for AI asks exactly the questions and setup steps the page shows', () => {
  const pageQ = phase('questions').items.map((i) => [i.id, i.label]);
  const payQ = payload.questions.map((q) => [q.id, q.question]);
  assert.deepEqual(payQ, pageQ);
  const pageS = phase('setup').items.map((i) => [i.id, i.label]);
  const payS = payload.setup.map((s) => [s.id, s.title]);
  assert.deepEqual(payS, pageS);
  assert.equal(data.copyForAI.payloadId, 'portal-payload');
});

test('the handoff tells the assistant never to touch keys', () => {
  assert.match(payload.instructionsForAssistant, /never ask for, accept, repeat or include any API key/i);
  assert.match(payload.keysPolicy, /never receives/i);
});

test('the scoring described to the partner matches the code', () => {
  assert.deepEqual(payload.tool.scoring.defaultWeights, DEFAULT_WEIGHTS);
  for (const k of Object.keys(DEFAULT_WEIGHTS)) assert.ok(payload.tool.scoring.levers[k], `lever ${k} is described`);
  const how = /<script type="text\/markdown" id="doc-how">([\s\S]*?)<\/script>/.exec(html)[1];
  for (const w of Object.values(DEFAULT_WEIGHTS)) assert.match(how, new RegExp(`\\| ${w} \\|`), `doc-how shows weight ${w}`);
});

test('every file the page hands over exists', () => {
  const updates = data.sections.find((s) => s.type === 'updates');
  for (const item of updates.items) {
    for (const a of item.attachments || []) {
      if (/^https?:/.test(a.href) || ROUTES.has(a.href)) continue;
      assert.ok(existsSync(join(ROOT, a.href.replace(/^\//, ''))), `${a.href} exists`);
    }
  }
});

test('the downloadable tool zip matches tool/ (run `npm run pack` if this fails)', () => {
  assert.ok(existsSync(ZIP_PATH), 'files/sterling-tool.zip exists');
  assert.ok(readFileSync(ZIP_PATH).equals(buildToolZip()), 'zip is stale: run npm run pack');
});

test('tool/lib stays browser-safe (the web finder imports it directly)', () => {
  for (const f of readdirSync(join(ROOT, 'tool/lib'))) {
    const src = read(`tool/lib/${f}`);
    assert.doesNotMatch(src, /from ['"]node:|require\(|process\./, `${f} must not use Node-only APIs`);
  }
  for (const m of read('finder.js').matchAll(/from '\.\/(tool\/lib\/[^']+)'/g)) assert.ok(existsSync(join(ROOT, m[1])), `${m[1]} exists`);
});

test('nothing from our internal setup leaks into what the partner gets', () => {
  const files = ['finder.html', 'finder.js', 'index.html'];
  const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  files.push(...walk('tool'));
  const banned = /supabase|service_role|hirobius\/ops|\/ops\/|exterior-cleaning|scaffold-clients|\.env\.local|vvyccwxtcwvlusweenje|sk-ant-|ghp_/i;
  for (const f of files) assert.doesNotMatch(read(f), banned, `${f} mentions internal setup or a secret`);
});
