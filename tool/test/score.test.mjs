import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCloseHour,
  coverageGap,
  callIntent,
  scoreLead,
  normalizePlace,
  normalizeResponse,
} from '../lib/score.mjs';
import { defaultProfile } from '../lib/profile.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/sample-response.json', import.meta.url), 'utf8'));
const W = defaultProfile().weights;

test('parseCloseHour reads common Google hour strings', () => {
  assert.equal(parseCloseHour('8AM-5PM'), 17);
  assert.equal(parseCloseHour('8:30 AM–5:30 PM'), 17.5);
  assert.equal(parseCloseHour('7AM-12PM'), 12);
  assert.equal(parseCloseHour('5PM-2AM'), 26); // past midnight counts as late
  assert.equal(parseCloseHour('Open 24 hours'), 24);
  assert.equal(parseCloseHour('Closed'), null);
  assert.equal(parseCloseHour('garbage'), null);
});

test('coverageGap: 24/7 has no gap, weekday-only 8-5 has a big one, unknown is middling', () => {
  const all = (v) => Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => [d, v]));
  assert.equal(coverageGap(all(['Open 24 hours'])).gap, 0);
  const nineToFive = { ...all(['8AM-5PM']), Saturday: ['Closed'], Sunday: ['Closed'] };
  const g = coverageGap(nineToFive);
  assert.equal(g.closedDays.length, 2);
  assert.ok(g.gap >= 0.9, `expected a large gap, got ${g.gap}`);
  assert.equal(coverageGap(null).gap, 0.5);
  assert.equal(coverageGap({}).gap, 0.5);
});

test('callIntent ranks urgent trades above appointment businesses above the rest', () => {
  assert.equal(callIntent('Plumber').tier, 'urgent');
  assert.equal(callIntent('HVAC contractor, Air conditioning repair service').tier, 'urgent');
  assert.equal(callIntent('Dentist').tier, 'appointment');
  assert.equal(callIntent('Gift shop').tier, 'other');
  assert.ok(callIntent('Locksmith').factor > callIntent('Dentist').factor);
  assert.ok(callIntent('Dentist').factor > callIntent('Gift shop').factor);
});

test('scoreLead: no phone means zero, whatever else is true', () => {
  const s = scoreLead({ phone: '', category: 'Plumber', reviews: 900, hours: null, hasOnlineBooking: false, verified: true, operational: true }, W);
  assert.equal(s.score, 0);
  assert.match(s.reasons.join(' '), /no phone/i);
});

test('scoreLead: a closed business sinks below any open one', () => {
  const base = { phone: '+1 555 0100', category: 'Plumber', reviews: 400, hours: null, hasOnlineBooking: false, verified: true };
  const open = scoreLead({ ...base, operational: true }, W);
  const closed = scoreLead({ ...base, operational: false }, W);
  assert.ok(closed.score < open.score / 3);
});

test('scoreLead: every lever moves the score the right way', () => {
  const base = { phone: '+1 555 0100', category: 'Dentist', reviews: 50, hours: null, hasOnlineBooking: true, verified: false, operational: true };
  const s0 = scoreLead(base, W).score;
  assert.ok(scoreLead({ ...base, category: 'Plumber' }, W).score > s0, 'urgent niche');
  assert.ok(scoreLead({ ...base, reviews: 800 }, W).score > s0, 'more call volume');
  assert.ok(scoreLead({ ...base, hasOnlineBooking: false }, W).score > s0, 'phone-only booking');
  assert.ok(scoreLead({ ...base, verified: true }, W).score > s0, 'owner verified');
  assert.ok(scoreLead({ ...base, hours: { Saturday: ['Closed'], Sunday: ['Closed'], Monday: ['8AM-5PM'] } }, W).score > s0, 'coverage gap');
});

test('scoreLead stays within 0..100 and weights are rescaled when they do not sum to 100', () => {
  const best = { phone: '1', category: 'Locksmith', reviews: 100000, hours: { Saturday: ['Closed'], Sunday: ['Closed'], Monday: ['8AM-4PM'] }, hasOnlineBooking: false, verified: true, operational: true };
  assert.ok(scoreLead(best, W).score <= 100);
  const doubled = Object.fromEntries(Object.entries(W).map(([k, v]) => [k, v * 2]));
  assert.equal(scoreLead(best, doubled).score, scoreLead(best, W).score);
});

test('normalizePlace accepts both live and older Outscraper field names', () => {
  const live = normalizePlace({ name: 'A', website: 'https://a.com', address: '1 Main', state_code: 'TX', phone: '1', type: 'Plumber' }, W);
  const old = normalizePlace({ name: 'A', site: 'https://a.com', full_address: '1 Main', us_state: 'TX', phone: '1', type: 'Plumber' }, W);
  assert.equal(live.website, old.website);
  assert.equal(live.address, old.address);
  assert.equal(live.region, old.region);
});

test('normalizeResponse on the fixture: deduped, ranked, chains flagged, pitch reasons present', () => {
  const leads = normalizeResponse(fixture.data, W);
  const ids = leads.map((l) => l.placeId);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate place ids');
  for (let i = 1; i < leads.length; i++) assert.ok(leads[i - 1].score >= leads[i].score, 'sorted by score');
  assert.equal(leads[0].name, 'Rapid Rooter Plumbing', 'urgent, busy, 8-5 weekdays, phone-only ranks first');
  assert.equal(leads.at(-1).score, 0, 'no-phone listing is last');
  assert.ok(leads.filter((l) => l.likelyChain).length >= 3, 'repeated brand flagged as a chain');
  assert.ok(leads[0].reasons.length >= 3);
});

test('names with no Latin letters or digits are never lumped together as a chain', () => {
  const data = [[1, 2, 3].map((i) => ({ name: '東京配管', place_id: `X${i}`, phone: '1', type: 'Plumber' }))];
  assert.ok(normalizeResponse(data, W).every((l) => !l.likelyChain));
});
