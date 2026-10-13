/**
 * tool/lib/csv.mjs
 *
 * Leads -> CSV for spreadsheets and CRMs. Scraped text is untrusted: a cell
 * that starts with = + - @ (or a tab/CR) would run as a formula in Excel or
 * Sheets, so those get a leading apostrophe.
 */

export const COLUMNS = [
  ['score', (l) => l.score],
  ['name', (l) => l.name],
  ['category', (l) => l.category],
  ['phone', (l) => l.phone],
  ['city', (l) => l.city],
  ['region', (l) => l.region],
  ['reviews', (l) => l.reviews],
  ['rating', (l) => l.rating ?? ''],
  ['hours_gap', (l) => l.hoursGap ?? ''],
  ['closed_days', (l) => (l.closedDays || []).join(' ')],
  ['online_booking', (l) => (l.hasOnlineBooking ? 'yes' : 'no')],
  ['owner_verified', (l) => (l.verified ? 'yes' : 'no')],
  ['likely_chain', (l) => (l.likelyChain ? 'yes' : 'no')],
  ['website', (l) => l.website],
  ['address', (l) => l.address],
  ['maps_url', (l) => l.mapsUrl],
  ['why', (l) => (l.reasons || []).join(' ')],
  ['place_id', (l) => l.placeId],
  ['source_query', (l) => l.sourceQuery],
];

/** One CSV cell, quoted when needed and defused against formula injection. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Digits and phone punctuation alone can't call a function, so leave
  // numbers like "+1 512-555-0100" intact for CRM imports.
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^\+?[\d ().-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Byte-order mark so Excel reads accented names as UTF-8. Prepend when saving a file. */
export const CSV_BOM = '\uFEFF';

export function toCsv(leads, columns = COLUMNS) {
  const rows = [columns.map(([h]) => h).join(',')];
  for (const l of leads) rows.push(columns.map(([, get]) => csvCell(get(l))).join(','));
  return `${rows.join('\r\n')}\r\n`;
}
