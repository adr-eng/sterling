/**
 * tool/lib/outscraper.mjs
 *
 * The only code that talks to Outscraper. Works in the browser and in Node:
 * `fetch` is passed in, and the API key is passed per call, never stored here.
 * In the browser the request goes straight from the user's device to
 * Outscraper (their API allows cross-origin calls), so the key never touches
 * the server that hosts the page.
 *
 * Contract (live-verified on the original tool, 2026-07-04):
 *   GET https://api.app.outscraper.com/maps/search-v3?query=&limit=&language=&region=&async=false
 *   header X-API-KEY: <key>
 *   -> { status: "Success", data: [[...places]] }   (one array per query)
 *   A slow request may come back { status: "Pending", results_location } instead;
 *   we poll that URL until it finishes.
 */

export const API_BASE = 'https://api.app.outscraper.com';
export const API_KEY_PAGE = 'https://app.outscraper.com/account/api';

/** The GET URL for one Google Maps search. */
export function searchUrl(query, { limit = 20, language = 'en', region = 'us' } = {}, base = API_BASE) {
  const u = new URL(`${base}/maps/search-v3`);
  u.searchParams.set('query', query);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('language', language);
  u.searchParams.set('region', region);
  u.searchParams.set('async', 'false');
  return u.toString();
}

/** A plain-English error that says what to do next. */
export function explainStatus(status, query) {
  if (status === 401 || status === 403) {
    return `Outscraper did not accept the API key (HTTP ${status}). Copy a fresh key from ${API_KEY_PAGE} and save it again.`;
  }
  if (status === 402) return `Outscraper says the account needs credit (HTTP 402). Open Billing in your account at https://app.outscraper.com, add a payment method, then run again.`;
  if (status === 429) return 'Outscraper is rate-limiting this account (HTTP 429). Wait a minute, then run again with fewer searches.';
  return `Outscraper returned HTTP ${status} for "${query}". Try again; if it repeats, check status.outscraper.com.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The poll URL for a queued request, but only if it stays on Outscraper over
 * https. The key rides along in a header, so a tampered response must never be
 * able to point it at another host (or, relative, at the page's own server).
 */
export function safePollUrl(body, base = API_BASE) {
  const raw = body?.results_location || (body?.id ? `${base}/requests/${encodeURIComponent(body.id)}` : null);
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; } // relative or junk: refuse
  return u.protocol === 'https:' && u.origin === new URL(base).origin ? u.toString() : null;
}

/**
 * Run one search and return its places (a flat array).
 * @param {string} query
 * @param {{limit?:number, language?:string, region?:string}} opts
 * @param {{apiKey:string, fetchImpl?:typeof fetch, base?:string, pollMs?:number, maxPolls?:number}} ctx
 */
export async function searchPlaces(query, opts, ctx) {
  const { apiKey, fetchImpl = globalThis.fetch, base = API_BASE, pollMs = 4000, maxPolls = 45 } = ctx;
  if (!apiKey) throw new Error(`No Outscraper API key. Create one at ${API_KEY_PAGE}.`);
  const headers = { 'X-API-KEY': apiKey, Accept: 'application/json' };

  const init = { headers, redirect: 'error' }; // never follow a redirect with the key attached
  const res = await fetchImpl(searchUrl(query, opts, base), init);
  if (!res.ok && res.status !== 202) throw new Error(explainStatus(res.status, query));
  let body = await res.json();

  for (let i = 0; String(body?.status).toLowerCase() === 'pending'; i++) {
    if (i >= maxPolls) throw new Error(`Outscraper is still working on "${query}". Try again with a smaller limit.`);
    const next = safePollUrl(body, base);
    if (!next) throw new Error(`Outscraper queued "${query}" but gave no usable results link.`);
    await sleep(pollMs);
    const poll = await fetchImpl(next, init);
    if (!poll.ok && poll.status !== 202) throw new Error(explainStatus(poll.status, query));
    body = await poll.json();
  }

  const status = String(body?.status ?? 'success').toLowerCase();
  if (status !== 'success') throw new Error(`Outscraper reported "${body?.status}" for "${query}".`);
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.flatMap((d) => (Array.isArray(d) ? d : d && typeof d === 'object' ? [d] : []));
}

/**
 * Run searches in order until done, until `maxRecords` places are in hand, or
 * until `shouldStop()` says so. Keeps what it already paid for either way.
 * Returns the raw places in Outscraper's `data` shape (one array per search).
 */
export async function runSearches(queries, opts, ctx) {
  const { maxRecords = Infinity, onProgress = () => {}, shouldStop = () => false } = ctx;
  const data = [];
  let records = 0;
  let i = 0;
  for (; i < queries.length; i++) {
    if (records >= maxRecords || shouldStop()) break;
    onProgress({ index: i, total: queries.length, query: queries[i], records });
    let places;
    const remaining = maxRecords - records;
    const limit = Number.isFinite(remaining) ? Math.min(opts.limit ?? 20, remaining) : opts.limit;
    try {
      places = await searchPlaces(queries[i], { ...opts, limit }, ctx);
    } catch (e) {
      if (!data.length) throw e; // nothing paid for yet: just fail
      // Keep the searches already paid for, and say why the run stopped.
      return { data, records, searchesRun: i, stoppedEarly: true, error: e.message };
    }
    data.push(places);
    records += places.length;
  }
  onProgress({ index: i, total: queries.length, query: null, records, done: true });
  return { data, records, searchesRun: i, stoppedEarly: i < queries.length, error: null };
}
