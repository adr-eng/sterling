/**
 * tool/lib/score.mjs
 *
 * Turns raw Outscraper Google Maps places into scored voice-agent leads.
 * Pure and deterministic: no network, no storage, no DOM, so the browser
 * finder and the CLI share it and the tests pin it.
 *
 * THESIS: the best voice-agent prospect is a real, open business whose
 * revenue arrives by phone, that gets a lot of calls, and that leaves calls
 * unanswered (after hours, weekends, no online booking). Each lever below is a
 * 0..1 factor; the profile's weights (rescaled to 100) decide how much each
 * one counts. `reasons` says why in plain English, which doubles as the
 * outreach angle for that business.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKEND = new Set(['Saturday', 'Sunday']);
const EARLY_CLOSE_HOUR = 18; // closing at or before 6 PM leaves the evening uncovered

// Business types by how much a missed call costs them. Matched as substrings of
// the listing's category and subtypes, lowercased.
const URGENT = [
  'plumb', 'hvac', 'heating', 'air condition', 'furnace', 'electrician', 'electrical',
  'locksmith', 'towing', 'tow truck', 'garage door', 'roof', 'water damage', 'restoration',
  'pest control', 'exterminator', 'septic', 'sewer', 'drain', 'appliance repair',
  'emergency', 'bail bond', 'glass repair', 'well pump', 'tree service',
];
const APPOINTMENT = [
  'dentist', 'dental', 'orthodont', 'chiropract', 'physical therap', 'med spa', 'medical spa',
  'dermatolog', 'veterinar', 'animal hospital', 'auto repair', 'mechanic', 'auto body',
  'tire', 'salon', 'barber', 'massage', 'spa', 'law firm', 'attorney', 'lawyer',
  'property management', 'insurance agency', 'cleaning', 'maid', 'moving', 'mover',
  'landscap', 'lawn', 'pool', 'optometr', 'clinic', 'accountant', 'tax prep',
];
const TIER_FACTOR = { urgent: 1, appointment: 0.7, other: 0.1 };

const CLOSED_FACTOR = 0.2; // a permanently closed listing keeps 20% and sinks
const REVIEWS_FOR_FULL_VOLUME = 316; // log10(317) ≈ 2.5 -> full call-volume factor

/** First non-empty value among `keys` on `obj`. */
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const str = (v) => String(v ?? '').trim();

/** "8:30 AM" + fallback meridiem -> hour as a decimal, or null. */
function toHour(h, m, mer) {
  let hour = Number(h);
  if (!Number.isFinite(hour) || hour > 24) return null;
  const min = m ? Number(m) / 60 : 0;
  if (mer) {
    const pm = mer.toUpperCase() === 'PM';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return hour + min;
}

/**
 * Closing hour of one Google hours string, as a decimal (17.5 = 5:30 PM).
 * Past-midnight closes count above 24 ("5PM-2AM" -> 26). "Open 24 hours" -> 24.
 * Closed or unreadable -> null.
 */
export function parseCloseHour(text) {
  const s = str(text).replace(/[–—‒]/g, '-').replace(/ | /g, ' ');
  if (/24\s*hours/i.test(s)) return 24;
  if (!s || /closed/i.test(s)) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (!m) return null;
  const closeMer = m[6] || m[3];
  const openMer = m[3] || m[6];
  const open = toHour(m[1], m[2], openMer);
  let close = toHour(m[4], m[5], closeMer);
  if (open === null || close === null) return null;
  if (close <= open) close += 24;
  return close;
}

/** All the ranges listed for one day, whatever shape Outscraper sent. */
function dayRanges(v) {
  if (Array.isArray(v)) return v.flatMap((x) => str(x).split(','));
  return str(v).split(',');
}

/**
 * How much of the week a business leaves its phone uncovered, 0..1.
 * Unknown hours score 0.5: probably limited, but we don't know.
 */
export function coverageGap(hours) {
  const unknown = { gap: 0.5, closedDays: [], earlyCloseDays: [], allDay: false, unknown: true };
  if (!hours || typeof hours !== 'object' || !Object.keys(hours).length) return unknown;

  const byDay = {};
  for (const [k, v] of Object.entries(hours)) {
    const day = DAYS.find((d) => d.toLowerCase() === k.trim().toLowerCase());
    if (day) byDay[day] = v;
  }
  if (!Object.keys(byDay).length) return unknown;

  const closedDays = [];
  const earlyCloseDays = [];
  let allDayCount = 0;
  for (const day of DAYS) {
    const ranges = byDay[day] === undefined ? [] : dayRanges(byDay[day]);
    const closes = ranges.map(parseCloseHour).filter((x) => x !== null);
    if (!closes.length) { closedDays.push(day); continue; } // listed Closed, or not listed
    const last = Math.max(...closes);
    if (last >= 24 && ranges.some((r) => /24\s*hours/i.test(r))) allDayCount++;
    else if (last <= EARLY_CLOSE_HOUR) earlyCloseDays.push(day);
  }

  const allDay = allDayCount === 7;
  if (allDay) return { gap: 0, closedDays, earlyCloseDays, allDay, unknown: false };

  const openDays = 7 - closedDays.length;
  const weekendClosed = closedDays.filter((d) => WEEKEND.has(d)).length;
  const weekdayClosed = closedDays.length - weekendClosed;
  const earlyFrac = openDays ? earlyCloseDays.length / openDays : 1;
  const gap = Math.min(1, 0.1 + 0.55 * (weekendClosed / 2) + 0.15 * weekdayClosed + 0.45 * earlyFrac);
  return { gap: Math.round(gap * 100) / 100, closedDays, earlyCloseDays, allDay, unknown: false };
}

/** How phone-driven a business type is: urgent, appointment, or other. */
export function callIntent(categoryText) {
  const c = str(categoryText).toLowerCase();
  const u = URGENT.find((k) => c.includes(k));
  if (u) return { tier: 'urgent', factor: TIER_FACTOR.urgent, match: u };
  const a = APPOINTMENT.find((k) => c.includes(k));
  if (a) return { tier: 'appointment', factor: TIER_FACTOR.appointment, match: a };
  return { tier: 'other', factor: TIER_FACTOR.other, match: null };
}

const short = (d) => d.slice(0, 3);
function fmtHour(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60);
  const mer = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${mer}`;
}

/**
 * Score one lead 0..100 and explain it.
 * @param {{phone:string, category:string, reviews:number, hours:object|null,
 *   hasOnlineBooking:boolean, verified:boolean, operational:boolean}} lead
 * @param {Record<string, number>} weights
 */
export function scoreLead(lead, weights) {
  if (!str(lead.phone)) {
    return { score: 0, factors: {}, reasons: ['No phone number listed, so there are no calls to answer.'] };
  }
  const intent = callIntent(lead.category);
  const reviews = Number(lead.reviews) || 0;
  const cov = coverageGap(lead.hours);
  const factors = {
    nicheFit: intent.factor,
    callVolume: Math.min(1, Math.log10(reviews + 1) / Math.log10(REVIEWS_FOR_FULL_VOLUME + 1)),
    coverageGap: cov.gap,
    phoneOnlyBooking: lead.hasOnlineBooking ? 0 : 1,
    ownerVerified: lead.verified ? 1 : 0,
  };

  const total = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  let raw = 0;
  for (const [k, f] of Object.entries(factors)) raw += (Number(weights[k]) || 0) * f;
  let score = (raw / total) * 100;
  if (!lead.operational) score *= CLOSED_FACTOR;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const label = str(lead.category).split(',')[0].trim() || intent.match;
  const reasons = [];
  if (!lead.operational) reasons.push('Permanently closed.');
  if (intent.tier === 'urgent') reasons.push(`Urgent trade (${label}): a caller who hits voicemail calls the next company.`);
  else if (intent.tier === 'appointment') reasons.push(`Appointment business (${label}): every missed call is a lost booking.`);
  else reasons.push('Not a typical phone-driven business type.');
  if (reviews >= 50) reasons.push(`${reviews} reviews: a busy phone line.`);
  else reasons.push(`${reviews} reviews: likely a quieter phone.`);
  if (cov.unknown) reasons.push('Hours not listed.');
  else if (cov.allDay) reasons.push('Open 24 hours: they may already cover the phone.');
  else {
    const bits = [];
    if (cov.closedDays.length) bits.push(`closed ${cov.closedDays.map(short).join(', ')}`);
    if (cov.earlyCloseDays.length) {
      const closes = cov.earlyCloseDays.map((d) => Math.max(...dayRanges(lead.hours[d] ?? lead.hours[d.toLowerCase()]).map(parseCloseHour).filter((x) => x !== null)));
      bits.push(`closes by ${fmtHour(Math.max(...closes))} on ${cov.earlyCloseDays.length} day${cov.earlyCloseDays.length > 1 ? 's' : ''}`);
    }
    if (bits.length) reasons.push(`${bits.join('; ')[0].toUpperCase()}${bits.join('; ').slice(1)}: after-hours calls go unanswered.`);
    else reasons.push('Open late most days.');
  }
  reasons.push(lead.hasOnlineBooking ? 'Has online booking, so fewer bookings come by phone.' : 'No online booking: bookings come in by phone.');
  if (lead.verified) reasons.push('Owner-verified listing: a reachable decision-maker.');

  return { score, factors, tier: intent.tier, coverage: cov, reasons };
}

/** Name reduced to letters and digits, for spotting the same brand twice. */
export function brandKey(name) {
  return str(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** One raw Outscraper place -> a scored lead. */
export function normalizePlace(place = {}, weights) {
  const category = str(pick(place, 'type', 'category'));
  const subtypes = str(pick(place, 'subtypes'));
  const reservation = Array.isArray(place.reservation_links) ? place.reservation_links.filter(Boolean) : [];
  const bookingLink = str(pick(place, 'booking_appointment_link')) || str(reservation[0]);
  const hours = place.working_hours && typeof place.working_hours === 'object' ? place.working_hours : null;
  const ratingRaw = pick(place, 'rating');

  const lead = {
    name: str(pick(place, 'name')),
    category,
    subtypes,
    phone: str(pick(place, 'phone')),
    address: str(pick(place, 'address', 'full_address')),
    city: str(pick(place, 'city')),
    region: str(pick(place, 'state_code', 'us_state', 'state')),
    postalCode: str(pick(place, 'postal_code')),
    website: str(pick(place, 'website', 'site')),
    rating: ratingRaw === undefined ? null : Number(ratingRaw),
    reviews: Number(pick(place, 'reviews', 'reviews_count')) || 0,
    placeId: str(pick(place, 'place_id', 'google_id')),
    mapsUrl: str(pick(place, 'location_link')),
    sourceQuery: str(pick(place, 'query')),
    businessStatus: str(pick(place, 'business_status')),
    verified: Boolean(place.verified),
    hours,
    bookingLink,
    hasOnlineBooking: bookingLink.length > 0,
    operational: str(place.business_status).toUpperCase() !== 'CLOSED_PERMANENTLY',
    likelyChain: false,
  };
  const s = scoreLead({ ...lead, category: `${category}, ${subtypes}` }, weights);
  return { ...lead, score: s.score, tier: s.tier ?? null, hoursGap: s.coverage?.gap ?? null, closedDays: s.coverage?.closedDays ?? [], reasons: s.reasons };
}

/** Outscraper's `data` is one array of places per query; flatten it. */
export function flattenPlaces(data) {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => (Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? [entry] : []));
}

/** How many listings share a brand before we call it a chain. */
export const CHAIN_MIN_LISTINGS = 3;

/**
 * Raw `data` -> deduped, chain-flagged, score-sorted leads. The whole pure
 * pipeline the finder and CLI both run.
 */
export function normalizeResponse(data, weights) {
  const seen = new Set();
  const leads = [];
  for (const place of flattenPlaces(data)) {
    if (!place || !(place.name || place.place_id || place.google_id)) continue;
    const lead = normalizePlace(place, weights);
    const key = lead.placeId || `${brandKey(lead.name)}|${lead.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push(lead);
  }
  const counts = new Map();
  for (const l of leads) counts.set(brandKey(l.name), (counts.get(brandKey(l.name)) || 0) + 1);
  for (const l of leads) {
    const key = brandKey(l.name); // '' for names with no Latin letters or digits: can't tell, so not a chain
    l.likelyChain = key !== '' && (counts.get(key) || 0) >= CHAIN_MIN_LISTINGS;
  }
  return leads.sort((a, b) => b.score - a.score || b.reviews - a.reviews);
}

export const _internal = { URGENT, APPOINTMENT, TIER_FACTOR, CLOSED_FACTOR, EARLY_CLOSE_HOUR };
