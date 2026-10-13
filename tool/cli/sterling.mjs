#!/usr/bin/env node
/**
 * Sterling lead finder: the command-line version of the web finder.
 * Same profile, same scoring, same CSV. Node 20+, no installs.
 *
 * Try it with no key and no cost:
 *   node cli/sterling.mjs --fixture fixtures/sample-response.json
 *   node cli/sterling.mjs --niche plumber --location "Austin, TX" --dry-run
 *
 * Live (uses YOUR Outscraper account; the key is read from your shell only):
 *   export OUTSCRAPER_API_KEY=your-key            (Windows PowerShell: $env:OUTSCRAPER_API_KEY="your-key")
 *   node cli/sterling.mjs --profile my-profile.json --out runs
 *
 * Flags:
 *   --profile <file>     a profile JSON (export it from the web finder)
 *   --niche "<type>"     business type to search; repeatable (replaces the profile's list)
 *   --location "<area>"  city or area to search; repeatable (replaces the profile's list)
 *   --limit <n>          results per search (1-100, default 20)
 *   --max-records <n>    stop once about n places are pulled (budget cap, default 200)
 *   --min-score <n>      drop leads scoring below n
 *   --fixture <file>     score a saved Outscraper response instead of calling the API
 *   --dry-run            show the searches and the cost estimate, then stop
 *   --out <dir>          write <dir>/<run-id>/leads.csv and leads.json
 *   --json               print the leads as JSON instead of a table
 *   --help               show this help
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mergeProfile, planSearches, estimateCost, FREE_RECORDS_PER_MONTH } from '../lib/profile.mjs';
import { normalizeResponse } from '../lib/score.mjs';
import { runSearches, API_KEY_PAGE } from '../lib/outscraper.mjs';
import { toCsv, CSV_BOM } from '../lib/csv.mjs';

function parseArgs(argv) {
  const o = { niches: [], locations: [], profile: null, limit: null, maxRecords: null, minScore: null, fixture: null, dryRun: false, out: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value.`);
      return v;
    };
    switch (a) {
      case '--profile': o.profile = next(); break;
      case '--niche': o.niches.push(next()); break;
      case '--location': o.locations.push(next()); break;
      case '--limit': o.limit = next(); break;
      case '--max-records': o.maxRecords = next(); break;
      case '--min-score': o.minScore = next(); break;
      case '--fixture': o.fixture = next(); break;
      case '--dry-run': o.dryRun = true; break;
      case '--out': o.out = next(); break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`Unknown flag: ${a} (try --help)`);
    }
  }
  return o;
}

function usage() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  return src.split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '');
}

function table(leads) {
  const rows = leads.slice(0, 25).map((l) => [String(l.score).padStart(3), l.name.slice(0, 34).padEnd(34), (l.category || '').slice(0, 22).padEnd(22), (l.phone || '').padEnd(16), `${l.city}${l.region ? `, ${l.region}` : ''}`]);
  return ['  # Name                               Category               Phone            Place', ...rows.map((r) => r.join(' '))].join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(usage());

  const raw = o.profile ? JSON.parse(readFileSync(resolve(o.profile), 'utf8')) : {};
  if (o.niches.length) raw.niches = o.niches;
  if (o.locations.length) raw.locations = o.locations;
  if (o.limit !== null) raw.limit = o.limit;
  if (o.maxRecords !== null) raw.maxRecords = o.maxRecords;
  if (o.minScore !== null) raw.minScore = o.minScore;
  const { profile, problems } = mergeProfile(raw);

  let data;
  if (o.fixture) {
    data = JSON.parse(readFileSync(resolve(o.fixture), 'utf8')).data;
  } else {
    if (problems.length) throw new Error(problems.join('\n'));
    const plan = planSearches(profile);
    const n = plan.queries.length;
    console.error(`${n} search${n === 1 ? '' : 'es'}, up to ${plan.worstCaseRecords} places. ` +
      `Free if you have that many of your ${FREE_RECORDS_PER_MONTH} free monthly places left; otherwise about $${estimateCost(plan.worstCaseRecords, 0).usd}.`);
    if (o.dryRun) return plan.queries.forEach((q) => console.log(`  ${q}`));
    const apiKey = process.env.OUTSCRAPER_API_KEY;
    if (!apiKey) throw new Error(`OUTSCRAPER_API_KEY is not set. Create a key at ${API_KEY_PAGE}, then: export OUTSCRAPER_API_KEY=your-key`);
    const run = await runSearches(plan.queries, { limit: profile.limit, language: profile.language, region: profile.region }, {
      apiKey,
      maxRecords: profile.maxRecords,
      onProgress: (p) => { if (!p.done) console.error(`  [${p.index + 1}/${p.total}] ${p.query}`); },
    });
    if (run.error) console.error(`Stopped after ${run.searchesRun} searches: ${run.error} Keeping the results already pulled.`);
    else if (run.stoppedEarly) console.error(`Stopped after ${run.searchesRun} searches: reached the ${profile.maxRecords}-place budget.`);
    data = run.data;
  }

  const all = normalizeResponse(data, profile.weights);
  const leads = all.filter((l) => l.score >= profile.minScore && !(profile.hideChains && l.likelyChain) && !(profile.hideNoPhone && !l.phone));

  if (o.out) {
    const dir = join(resolve(o.out), new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'leads.csv'), CSV_BOM + toCsv(leads));
    writeFileSync(join(dir, 'leads.json'), `${JSON.stringify({ profile, leads }, null, 2)}\n`);
    console.error(`Saved ${leads.length} leads to ${dir}`);
  }
  console.log(o.json ? JSON.stringify(leads, null, 2) : `${table(leads)}\n\n${leads.length} leads (${all.length - leads.length} hidden by your filters).`);
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
