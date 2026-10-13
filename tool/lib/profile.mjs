/**
 * tool/lib/profile.mjs
 *
 * A profile is everything a person tunes: what to search, where, how much to
 * spend, and how leads are scored. The browser finder saves it on the user's
 * device and exports it as JSON; the CLI reads the same JSON with --profile.
 * One shape, one validator, so the two can never disagree.
 *
 * Pure: no network, no storage, no DOM.
 */

/** Call-heavy local niches: good first searches for voice-agent prospects. */
export const DEFAULT_NICHES = [
  'plumber',
  'hvac contractor',
  'electrician',
  'locksmith',
  'garage door repair',
  'roofing contractor',
  'pest control',
  'dentist',
  'chiropractor',
  'med spa',
  'veterinarian',
  'auto repair shop',
];

/**
 * Scoring weights. Any positive numbers work; they are rescaled to 100.
 *   nicheFit         how phone-driven the business type is (urgent trades highest)
 *   callVolume       review count, as a stand-in for how busy the phone is
 *   coverageGap      hours that leave calls unanswered (evenings, weekends)
 *   phoneOnlyBooking no online booking link, so every booking is a call
 *   ownerVerified    claimed listing, so a decision-maker is reachable
 * Two gates sit outside the weights: no phone number scores 0, and a
 * permanently closed listing keeps only 20% of its score.
 */
export const DEFAULT_WEIGHTS = {
  nicheFit: 35,
  callVolume: 25,
  coverageGap: 20,
  phoneOnlyBooking: 10,
  ownerVerified: 10,
};

// Outscraper Google Maps search pricing as of 2026-10: the first 500 records
// each month are free, then about $3 per 1,000. Used only for estimates.
export const FREE_RECORDS_PER_MONTH = 500;
export const USD_PER_1K_RECORDS = 3;

const LIMIT_MAX = 100; // per search; bigger pulls belong in Outscraper's async API
const MAX_RECORDS_CAP = 5000; // a hard ceiling on one run, whatever the profile says

export function defaultProfile() {
  return {
    version: 1,
    name: '',
    company: '',
    niches: [...DEFAULT_NICHES],
    locations: [],
    limit: 20,
    maxRecords: 200,
    language: 'en',
    region: 'us',
    hideChains: true,
    hideNoPhone: true,
    minScore: 0,
    weights: { ...DEFAULT_WEIGHTS },
  };
}

const cleanList = (v) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const s = String(item ?? '').trim().replace(/\s+/g, ' ');
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const clampInt = (v, lo, hi, fallback) => {
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Merge user input over the defaults and validate it. Never throws: returns
 * the usable profile plus a list of plain-English problems to show the user.
 */
export function mergeProfile(input = {}) {
  const d = defaultProfile();
  const problems = [];
  const src = input && typeof input === 'object' ? input : {};

  const weights = { ...d.weights };
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    if (src.weights && src.weights[k] !== undefined) {
      const n = Number(src.weights[k]);
      if (Number.isFinite(n) && n >= 0) weights[k] = n;
      else problems.push(`Weight "${k}" must be a number 0 or higher; kept ${weights[k]}.`);
    }
  }
  if (Object.values(weights).every((w) => w === 0)) {
    problems.push('All weights were 0; restored the defaults.');
    Object.assign(weights, DEFAULT_WEIGHTS);
  }

  const profile = {
    version: 1,
    name: String(src.name ?? '').trim(),
    company: String(src.company ?? '').trim(),
    niches: src.niches === undefined ? d.niches : cleanList(src.niches),
    locations: cleanList(src.locations),
    limit: clampInt(src.limit, 1, LIMIT_MAX, d.limit),
    maxRecords: clampInt(src.maxRecords, 1, MAX_RECORDS_CAP, d.maxRecords),
    language: /^[a-z]{2}$/i.test(String(src.language ?? '')) ? String(src.language).toLowerCase() : d.language,
    region: /^[a-z]{2}$/i.test(String(src.region ?? '')) ? String(src.region).toLowerCase() : d.region,
    hideChains: src.hideChains === undefined ? d.hideChains : Boolean(src.hideChains),
    hideNoPhone: src.hideNoPhone === undefined ? d.hideNoPhone : Boolean(src.hideNoPhone),
    minScore: clampInt(src.minScore, 0, 100, d.minScore),
    weights,
  };
  if (!profile.niches.length) problems.push('Add at least one business type to search for.');
  if (!profile.locations.length) problems.push('Add at least one city or area to search in.');
  return { profile, problems };
}

/** Every search a run would make: each business type in each location. */
export function planSearches(profile) {
  const queries = [];
  for (const loc of profile.locations) for (const niche of profile.niches) queries.push(`${niche} in ${loc}`);
  const worstCase = Math.min(queries.length * profile.limit, profile.maxRecords);
  return { queries, worstCaseRecords: worstCase, estimate: estimateCost(worstCase) };
}

/** Rough cost of `records`, assuming the month's free records are unused. */
export function estimateCost(records, freeLeft = FREE_RECORDS_PER_MONTH) {
  const billable = Math.max(0, records - freeLeft);
  return { records, billable, usd: Math.round((billable / 1000) * USD_PER_1K_RECORDS * 100) / 100 };
}
