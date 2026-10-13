#!/usr/bin/env node
// Build files/sterling-tool.zip from tool/: the download the partner gets from
// the portal. Run after any change under tool/ (`npm run pack`);
// test/site.test.mjs fails while the committed zip is stale.
//
//   node scripts/pack-tool.mjs           write the zip
//   node scripts/pack-tool.mjs --check   exit 1 if the zip is stale

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './lib/zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(ROOT, 'tool');
export const ZIP_PATH = join(ROOT, 'files', 'sterling-tool.zip');
const SKIP = new Set(['node_modules', 'runs', '.DS_Store']);

function walk(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function buildToolZip() {
  const entries = walk(TOOL).map((p) => ({
    name: `sterling-tool/${relative(TOOL, p).split(sep).join('/')}`,
    data: readFileSync(p),
    // Fixed, not read from disk, so the bytes match on every OS.
    executable: p.endsWith(`${sep}cli${sep}sterling.mjs`),
  }));
  return makeZip(entries);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const zip = buildToolZip();
  if (process.argv.includes('--check')) {
    const same = existsSync(ZIP_PATH) && readFileSync(ZIP_PATH).equals(zip);
    if (!same) { console.error('files/sterling-tool.zip is stale. Run: npm run pack'); process.exit(1); }
    console.log('files/sterling-tool.zip is up to date ✓');
  } else {
    mkdirSync(join(ROOT, 'files'), { recursive: true });
    writeFileSync(ZIP_PATH, zip);
    console.log(`wrote files/sterling-tool.zip (${zip.length} bytes)`);
  }
}
