// Sterling lead finder (browser). All logic that matters lives in tool/lib and
// is shared with the CLI; this file is only the page: storage, form, rendering.
//
// Key handling: the Outscraper key is kept in this browser only (localStorage
// when "Remember" is on, sessionStorage otherwise) and sent only to
// api.app.outscraper.com, which vercel.json's CSP enforces. Scraped text is
// rendered with textContent, never innerHTML.

import { defaultProfile, mergeProfile, planSearches, estimateCost, FREE_RECORDS_PER_MONTH, DEFAULT_WEIGHTS } from './tool/lib/profile.mjs';
import { normalizeResponse } from './tool/lib/score.mjs';
import { runSearches } from './tool/lib/outscraper.mjs';
import { toCsv, CSV_BOM } from './tool/lib/csv.mjs';

const K = { key: 'sterling.apiKey', profile: 'sterling.profile', run: 'sterling.lastRun', theme: 'portal-theme' };
const $ = (id) => document.getElementById(id);

// ── storage (every access guarded: private windows can throw) ──────────────
const store = {
  get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); return true; } catch { return false; } },
  del(area, k) { try { window[area].removeItem(k); } catch { /* nothing to remove */ } },
};
const readJson = (k) => { try { return JSON.parse(store.get('localStorage', k) || 'null'); } catch { return null; } };

// Match the portal's theme choice (System / Light / Dark).
const theme = store.get('localStorage', K.theme);
if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);

// ── key ────────────────────────────────────────────────────────────────────
function savedKey() { return store.get('localStorage', K.key) || store.get('sessionStorage', K.key) || ''; }
function mask(k) { return k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••'; }
function paintKey() {
  const k = savedKey();
  const where = store.get('localStorage', K.key) ? 'on this device' : 'for this tab only';
  $('keyStatus').textContent = k ? `Key saved ${where} (${mask(k)}).` : 'No key saved yet.';
  $('keyStatus').dataset.ok = k ? 'yes' : 'no';
  paintPlan();
}
function saveKey() {
  const k = $('apiKey').value.trim();
  if (!k) return showError('Paste your Outscraper API key first.');
  if (!/^[\x21-\x7e]+$/.test(k)) return showError('That key has spaces or unusual characters. Copy it again from your Outscraper API key page.');
  store.del('localStorage', K.key); store.del('sessionStorage', K.key);
  const ok = store.set($('remember').checked ? 'localStorage' : 'sessionStorage', K.key, k);
  if (!ok) return showError('This browser blocked saving the key (private window?). It will work for this page until you reload.');
  $('apiKey').value = '';
  hideError();
  paintKey();
}
$('keyForm').addEventListener('submit', (e) => { e.preventDefault(); saveKey(); });
$('saveKey').addEventListener('click', saveKey);
$('forgetKey').addEventListener('click', () => { store.del('localStorage', K.key); store.del('sessionStorage', K.key); $('apiKey').value = ''; paintKey(); });
$('toggleKey').addEventListener('click', (e) => {
  const show = $('apiKey').type === 'password';
  $('apiKey').type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(show));
});

// ── profile ────────────────────────────────────────────────────────────────
const WEIGHT_LABELS = {
  nicheFit: ['Business type', 'Urgent trades highest, then appointment businesses.'],
  callVolume: ['Call volume', 'More reviews, busier phone.'],
  coverageGap: ['After-hours gap', 'Closed evenings or weekends.'],
  phoneOnlyBooking: ['No online booking', 'Every booking is a call.'],
  ownerVerified: ['Owner verified', 'A decision-maker is reachable.'],
};
for (const k of Object.keys(DEFAULT_WEIGHTS)) {
  const lab = document.createElement('label');
  const name = document.createElement('span'); name.className = 'lbl'; name.textContent = WEIGHT_LABELS[k][0];
  const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = WEIGHT_LABELS[k][1];
  const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.max = '100'; inp.inputMode = 'numeric'; inp.id = `w-${k}`;
  lab.append(name, hint, inp);
  $('weights').append(lab);
}

let profile = mergeProfile(readJson(K.profile) || {}).profile;

function fillForm(p) {
  $('pName').value = p.name; $('pCompany').value = p.company;
  $('pNiches').value = p.niches.join('\n'); $('pLocations').value = p.locations.join('\n');
  $('pLimit').value = p.limit; $('pMax').value = p.maxRecords; $('pMin').value = p.minScore;
  $('pChains').checked = p.hideChains; $('pNoPhone').checked = p.hideNoPhone;
  for (const k of Object.keys(DEFAULT_WEIGHTS)) $(`w-${k}`).value = p.weights[k];
}
function readForm() {
  const weights = {};
  for (const k of Object.keys(DEFAULT_WEIGHTS)) weights[k] = $(`w-${k}`).value;
  return mergeProfile({
    ...profile,
    name: $('pName').value, company: $('pCompany').value,
    niches: $('pNiches').value, locations: $('pLocations').value,
    limit: $('pLimit').value, maxRecords: $('pMax').value, minScore: $('pMin').value,
    hideChains: $('pChains').checked, hideNoPhone: $('pNoPhone').checked,
    weights,
  });
}
function showProblems(problems) {
  const ul = $('problems'); ul.textContent = '';
  for (const p of problems) { const li = document.createElement('li'); li.textContent = p; ul.append(li); }
}
function saveProfile() {
  const r = readForm();
  profile = r.profile;
  store.set('localStorage', K.profile, JSON.stringify(profile));
  showProblems(r.problems);
  fillForm(profile);
  paintPlan();
  rerender();
  return r;
}
$('saveProfile').addEventListener('click', saveProfile);
$('profile').addEventListener('change', (e) => {
  if (e.target.id === 'importProfile') return;
  const r = readForm(); profile = r.profile; showProblems(r.problems); paintPlan(); rerender();
});
$('resetProfile').addEventListener('click', () => {
  if (!confirm('Reset business types, areas and weights to the defaults?')) return;
  const keep = { name: profile.name, company: profile.company, locations: profile.locations };
  profile = mergeProfile({ ...defaultProfile(), ...keep }).profile;
  fillForm(profile); saveProfile();
});
$('exportProfile').addEventListener('click', () => {
  saveProfile();
  download(`sterling-profile${profile.company ? `-${slug(profile.company)}` : ''}.json`, `${JSON.stringify(profile, null, 2)}\n`, 'application/json');
});
$('importProfile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const r = mergeProfile(JSON.parse(await file.text()));
    profile = r.profile; fillForm(profile); saveProfile(); showProblems(r.problems);
  } catch {
    showError('That file is not a profile JSON. Export one from this page, or ask your assistant for the PROFILE JSON block.');
  }
});

// ── plan + run ─────────────────────────────────────────────────────────────
function paintPlan() {
  const plan = planSearches(profile);
  const n = plan.queries.length;
  const btn = $('runBtn');
  if (!n) {
    $('plan').textContent = 'Add at least one business type and one city or area in your profile.';
    btn.disabled = true;
    return;
  }
  const paid = estimateCost(plan.worstCaseRecords, 0).usd;
  $('plan').textContent = `${n} search${n === 1 ? '' : 'es'} (${profile.niches.length} type${profile.niches.length === 1 ? '' : 's'} × ${profile.locations.length} area${profile.locations.length === 1 ? '' : 's'}), up to ${plan.worstCaseRecords} places. ` +
    `Free if you have that many of your ${FREE_RECORDS_PER_MONTH} free places left this month; otherwise about $${paid.toFixed(2)}.`;
  btn.disabled = !savedKey();
  btn.title = savedKey() ? '' : 'Save your Outscraper key first';
}

let stopRequested = false;
let lastData = null;

$('runBtn').addEventListener('click', async () => {
  const r = saveProfile();
  if (r.problems.some((p) => /at least one/.test(p))) return;
  const apiKey = savedKey();
  if (!apiKey) return showError('Save your Outscraper key in step 1 first.');
  hideError();
  stopRequested = false;
  setBusy(true);
  const plan = planSearches(profile);
  try {
    const run = await runSearches(plan.queries, { limit: profile.limit, language: profile.language, region: profile.region }, {
      apiKey,
      maxRecords: profile.maxRecords,
      shouldStop: () => stopRequested,
      onProgress: (p) => {
        $('progress').max = p.total; $('progress').value = p.index;
        $('progressText').textContent = p.done ? `Done: ${p.records} places from ${p.index} searches.` : `Search ${p.index + 1} of ${p.total}: ${p.query} (${p.records} places so far)`;
      },
    });
    const why = run.error ? 'of an error' : stopRequested ? 'you pressed Stop' : `you reached your ${profile.maxRecords}-place limit`;
    setResults(run.data, run.stoppedEarly ? `Stopped after ${run.searchesRun} of ${plan.queries.length} searches because ${why}.` : '');
    if (run.error) showError(run.error);
  } catch (e) {
    $('progressText').textContent = 'Stopped by an error (details below).';
    showError(e instanceof TypeError ? 'Could not reach Outscraper. Check your internet connection and try again.' : e.message);
  } finally {
    setBusy(false);
  }
});
$('stopBtn').addEventListener('click', () => { stopRequested = true; $('progressText').textContent = 'Stopping after the current search…'; });
$('sampleBtn').addEventListener('click', async () => {
  hideError();
  const res = await fetch('/tool/fixtures/sample-response.json');
  if (!res.ok) return showError('Could not load the sample data.');
  setResults((await res.json()).data, 'Sample data: made-up businesses, no Outscraper credits used.');
});
function setBusy(on) {
  $('runBtn').disabled = on; $('sampleBtn').disabled = on; $('stopBtn').hidden = !on;
  if (on) { $('progressWrap').hidden = false; $('progressText').textContent = 'Starting…'; }
  else paintPlan();
}

// ── results ────────────────────────────────────────────────────────────────
function setResults(data, note) {
  lastData = { data, note, at: new Date().toISOString() };
  if (!store.set('localStorage', K.run, JSON.stringify(lastData))) { /* too big or blocked: results still show until reload */ }
  rerender();
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function visibleLeads() {
  if (!lastData) return { all: [], shown: [] };
  const all = normalizeResponse(lastData.data, profile.weights);
  const shown = all.filter((l) => l.score >= profile.minScore && !(profile.hideChains && l.likelyChain) && !(profile.hideNoPhone && !l.phone));
  return { all, shown };
}
function rerender() {
  const { all, shown } = visibleLeads();
  $('results').hidden = !lastData;
  if (!lastData) return;
  const hidden = all.length - shown.length;
  $('resultsSummary').textContent = `${shown.length} lead${shown.length === 1 ? '' : 's'}${hidden ? `, ${hidden} hidden by your filters` : ''}. ${lastData.note || ''}`.trim();
  const ol = $('leads'); ol.textContent = '';
  for (const l of shown) ol.append(leadRow(l));
}
function leadRow(l) {
  const li = document.createElement('li'); li.className = 'lead';
  const score = document.createElement('span'); score.className = `score ${l.score >= 75 ? 'hi' : l.score >= 50 ? 'mid' : 'lo'}`; score.textContent = String(l.score);
  score.setAttribute('aria-label', `Score ${l.score} of 100`);
  const body = document.createElement('div'); body.className = 'lead-body';
  const name = document.createElement('p'); name.className = 'lead-name'; name.textContent = l.name;
  const meta = document.createElement('p'); meta.className = 'lead-meta';
  meta.textContent = [l.category, [l.city, l.region].filter(Boolean).join(', '), `${l.reviews} reviews`, l.likelyChain ? 'likely chain' : ''].filter(Boolean).join(' · ');
  const links = document.createElement('p'); links.className = 'lead-links';
  if (l.phone) links.append(link(`tel:${l.phone.replace(/[^\d+]/g, '')}`, l.phone));
  if (/^https?:\/\//i.test(l.mapsUrl)) links.append(link(l.mapsUrl, 'Map', true));
  if (/^https?:\/\//i.test(l.website)) links.append(link(l.website, 'Website', true));
  const why = document.createElement('details'); why.className = 'why';
  const sum = document.createElement('summary'); sum.textContent = 'Why this score';
  const ul = document.createElement('ul');
  for (const r of l.reasons) { const item = document.createElement('li'); item.textContent = r; ul.append(item); }
  why.append(sum, ul);
  body.append(name, meta, links, why);
  li.append(score, body);
  return li;
}
function link(href, text, external) {
  const a = document.createElement('a'); a.href = href; a.textContent = text;
  if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  return a;
}
$('csvBtn').addEventListener('click', () => {
  const { shown } = visibleLeads();
  download(`sterling-leads-${new Date().toISOString().slice(0, 10)}.csv`, CSV_BOM + toCsv(shown), 'text/csv');
});
$('clearBtn').addEventListener('click', () => { lastData = null; store.del('localStorage', K.run); rerender(); });

// ── helpers ────────────────────────────────────────────────────────────────
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function showError(msg) { $('error').textContent = msg; $('error').hidden = false; }
function hideError() { $('error').hidden = true; $('error').textContent = ''; }

// ── start ──────────────────────────────────────────────────────────────────
fillForm(profile);
lastData = readJson(K.run);
paintKey();
rerender();
