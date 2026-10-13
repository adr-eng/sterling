import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, searchPlaces, runSearches, explainStatus, safePollUrl } from '../lib/outscraper.mjs';
import { csvCell, toCsv } from '../lib/csv.mjs';
import { defaultProfile, mergeProfile, planSearches, estimateCost } from '../lib/profile.mjs';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('searchUrl builds the documented search-v3 request', () => {
  const u = new URL(searchUrl('plumber in Austin, TX', { limit: 5, language: 'en', region: 'us' }));
  assert.equal(u.origin + u.pathname, 'https://api.app.outscraper.com/maps/search-v3');
  assert.equal(u.searchParams.get('query'), 'plumber in Austin, TX');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.equal(u.searchParams.get('async'), 'false');
});

test('searchPlaces sends the key as a header and flattens data', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = init.headers['X-API-KEY']; return json(200, { status: 'Success', data: [[{ name: 'A' }, { name: 'B' }]] }); };
  const places = await searchPlaces('q', {}, { apiKey: 'k-123', fetchImpl });
  assert.equal(seen, 'k-123');
  assert.deepEqual(places.map((p) => p.name), ['A', 'B']);
});

test('searchPlaces polls a Pending request until it succeeds', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) return json(202, { status: 'Pending', results_location: 'https://api.app.outscraper.com/requests/abc' });
    if (calls.length === 2) return json(200, { status: 'Pending', results_location: 'https://api.app.outscraper.com/requests/abc' });
    return json(200, { status: 'Success', data: [[{ name: 'Late' }]] });
  };
  const places = await searchPlaces('q', {}, { apiKey: 'k', fetchImpl, pollMs: 0 });
  assert.equal(places[0].name, 'Late');
  assert.equal(calls.length, 3);
});

test('the key is never sent anywhere but Outscraper, even if a response says so', async () => {
  assert.equal(safePollUrl({ results_location: 'https://evil.example/steal' }), null);
  assert.equal(safePollUrl({ results_location: '/requests/abc' }), null, 'relative would hit the page server');
  assert.equal(safePollUrl({ results_location: 'http://api.app.outscraper.com/requests/abc' }), null, 'https only');
  assert.equal(safePollUrl({ results_location: 'https://api.app.outscraper.com/requests/abc' }), 'https://api.app.outscraper.com/requests/abc');
  assert.equal(safePollUrl({ id: 'a/../b' }), 'https://api.app.outscraper.com/requests/a%2F..%2Fb');

  const hosts = [];
  let redirect;
  const fetchImpl = async (url, init) => {
    hosts.push(new URL(url).host);
    redirect = init.redirect;
    return json(202, { status: 'Pending', results_location: 'https://evil.example/steal' });
  };
  await assert.rejects(searchPlaces('q', {}, { apiKey: 'k', fetchImpl, pollMs: 0 }), /no usable results link/);
  assert.deepEqual(hosts, ['api.app.outscraper.com']);
  assert.equal(redirect, 'error', 'redirects are refused, so the key header is never forwarded');
});

test('a bad key fails loud with the fix, never a generic error', async () => {
  const fetchImpl = async () => json(401, { error: true });
  await assert.rejects(searchPlaces('q', {}, { apiKey: 'bad', fetchImpl }), /account\/api/);
  await assert.rejects(searchPlaces('q', {}, { apiKey: '', fetchImpl }), /No Outscraper API key/);
  assert.match(explainStatus(402, 'q'), /billing/i);
});

test('runSearches stops once the record budget is reached', async () => {
  const fetchImpl = async () => json(200, { status: 'Success', data: [[{ name: 'x' }, { name: 'y' }, { name: 'z' }]] });
  const r = await runSearches(['a', 'b', 'c', 'd'], {}, { apiKey: 'k', fetchImpl, maxRecords: 5 });
  assert.equal(r.searchesRun, 2);
  assert.equal(r.records, 6);
  assert.equal(r.stoppedEarly, true);
});

test('runSearches never asks for more places than the budget has left', async () => {
  const limits = [];
  const fetchImpl = async (url) => {
    const n = Number(new URL(url).searchParams.get('limit'));
    limits.push(n);
    return json(200, { status: 'Success', data: [Array.from({ length: n }, (_, i) => ({ name: `p${i}` }))] });
  };
  const r = await runSearches(['a', 'b', 'c'], { limit: 20 }, { apiKey: 'k', fetchImpl, maxRecords: 30 });
  assert.deepEqual(limits, [20, 10]);
  assert.equal(r.records, 30);
});

test('runSearches keeps paid-for results when a later search fails', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? json(200, { status: 'Success', data: [[{ name: 'kept' }]] }) : json(429, {}));
  const r = await runSearches(['a', 'b', 'c'], {}, { apiKey: 'k', fetchImpl });
  assert.equal(r.data.flat()[0].name, 'kept');
  assert.equal(r.stoppedEarly, true);
  assert.match(r.error, /429/);
});

test('runSearches keeps finished searches when asked to stop', async () => {
  const fetchImpl = async () => json(200, { status: 'Success', data: [[{ name: 'x' }]] });
  let n = 0;
  const r = await runSearches(['a', 'b', 'c'], {}, { apiKey: 'k', fetchImpl, shouldStop: () => ++n > 1 });
  assert.equal(r.searchesRun, 1);
  assert.equal(r.data.length, 1);
  assert.equal(r.stoppedEarly, true);
});

test('csvCell quotes and defuses spreadsheet formulas', () => {
  assert.equal(csvCell('Joe, Inc'), '"Joe, Inc"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell('+1 512-555-0100'), '+1 512-555-0100', 'phone numbers stay importable');
  assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
  const csv = toCsv([{ score: 9, name: 'A', reasons: ['r1', 'r2'], closedDays: ['Sunday'] }]);
  assert.match(csv, /^score,name,/);
  assert.match(csv, /r1 r2/);
});

test('mergeProfile cleans input and reports problems in plain English', () => {
  const { profile, problems } = mergeProfile({ niches: 'plumber\n Plumber \n\ndentist', locations: [], limit: 999, weights: { nicheFit: -1 } });
  assert.deepEqual(profile.niches, ['plumber', 'dentist']);
  assert.equal(profile.limit, 100);
  assert.equal(profile.weights.nicheFit, defaultProfile().weights.nicheFit);
  assert.ok(problems.some((p) => /city or area/.test(p)));
  assert.ok(problems.some((p) => /nicheFit/.test(p)));
});

test('blank number fields fall back to the defaults', () => {
  const { profile } = mergeProfile({ limit: '', maxRecords: '  ', minScore: null, locations: ['X'] });
  const d = defaultProfile();
  assert.equal(profile.limit, d.limit);
  assert.equal(profile.maxRecords, d.maxRecords);
  assert.equal(profile.minScore, d.minScore);
});

test('planSearches multiplies types by places and caps records at the budget', () => {
  const { profile } = mergeProfile({ niches: ['a', 'b'], locations: ['X', 'Y', 'Z'], limit: 20, maxRecords: 100 });
  const plan = planSearches(profile);
  assert.equal(plan.queries.length, 6);
  assert.equal(plan.queries[0], 'a in X');
  assert.equal(plan.worstCaseRecords, 100);
  assert.deepEqual(estimateCost(1500), { records: 1500, billable: 1000, usd: 3 });
});
