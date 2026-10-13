// The partner's own-password sign-in: hashing, sessions, the gate and every
// form path, against an in-memory store (no Vercel needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, hashPassword, verifyPassword, checkNewPassword, readCookie, sha256Hex, SESSION_COOKIE } from '../auth/core.mjs';
import { gate } from '../auth/gate.mjs';
import { handleAuth } from '../auth/handler.mjs';

const SECRET = 'test-session-secret-0123456789';
const ENV = { SESSION_SECRET: SECRET, SETUP_CODE: 'invite-code-abc', ADMIN_SETUP_CODE: 'admin-code-xyz' };
const FAST = 1000; // PBKDF2 iterations for tests only; production uses 600,000
const BASE = 'https://sterling.example';

function memStore(records = {}) {
  return { records: { ...records }, saves: 0, async load(n) { return this.records[n] ?? null; }, async save(n, r) { this.records[n] = r; this.saves++; } };
}
function post(action, fields, { cookie, origin = BASE, site } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (site) headers['sec-fetch-site'] = site;
  return new Request(`${BASE}/api/auth?do=${action}`, { method: 'POST', headers, body: new URLSearchParams(fields).toString() });
}
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const get = (path, cookie) => new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });

test('sessions: genuine tokens pass; tampered, expired or wrong-secret ones fail', async () => {
  const now = Date.now();
  const t = await signSession('partner', SECRET, { now });
  assert.deepEqual(await verifySession(t, SECRET, { now }), { role: 'partner' });
  assert.equal(await verifySession(t, 'other-secret', { now }), null);
  assert.equal(await verifySession(t, SECRET, { now: now + 15 * 86_400_000 }), null, 'expires after 14 days');
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ r: 'admin', exp: now + 1e9 })).toString('base64url');
  assert.equal(await verifySession(`${forged}.${s}`, SECRET, { now }), null);
  assert.equal(await verifySession(`${p}.${s}.x`, SECRET, { now }), null);
  assert.equal(await verifySession('garbage', SECRET, { now }), null);
});

test('passwords: only the hash is stored, and only the right password matches', async () => {
  const rec = await hashPassword('correct horse battery', { iterations: FAST });
  assert.ok(!JSON.stringify(rec).includes('correct horse'));
  assert.equal(await verifyPassword('correct horse battery', rec), true);
  assert.equal(await verifyPassword('correct horse batter', rec), false);
  assert.match(checkNewPassword('short', 'short'), /at least 10/);
  assert.match(checkNewPassword('long enough pw', 'different pw!'), /match/);
  assert.equal(checkNewPassword('long enough pw', 'long enough pw'), null);
});

test('gate: fail-closed without a secret; sign-in page when signed out; open when signed in', async () => {
  assert.equal((await gate(get('/'), { env: {} })).status, 503);
  const out = await gate(get('/finder.html'), { env: ENV });
  assert.equal(out.status, 401);
  assert.match(await out.text(), /Welcome back/);
  assert.equal(await gate(get('/brand/auth-ui.js'), { env: ENV }), undefined, 'sign-in page assets load signed out');
  const cookie = `${SESSION_COOKIE}=${await signSession('partner', SECRET)}`;
  assert.equal(await gate(get('/finder.html', cookie), { env: ENV }), undefined);
  assert.equal(await gate(get('/api/auth'), { env: ENV }), undefined, 'the auth function handles its own requests');
  assert.equal((await gate(get('/password'), { env: ENV })).status, 401, 'change password needs a session');
});

test('gate: the setup page escapes whatever is in the link', async () => {
  const res = await gate(get('/setup?code=%22%3E%3Cscript%3Ealert(1)%3C/script%3E'), { env: ENV });
  const html = await res.text();
  assert.ok(!html.includes('<script>alert(1)'), 'no injected script');
  assert.match(html, /value="&quot;&gt;&lt;script&gt;/);
});

const roleOf = async (res) => (await verifySession(readCookie(cookieFrom(res), SESSION_COOKIE), SECRET))?.role;
const cookieFor = async (role) => `${SESSION_COOKIE}=${await signSession(role, SECRET)}`;
const ctx = (store, env = ENV) => ({ env, store, iterations: FAST });
const setup = (code, pw = 'a good long password', confirm = pw) => post('setup', { code, password: pw, confirm });

test('setup: the right link sets the password once, signs in, and stores no plain text', async () => {
  const store = memStore();
  assert.equal((await handleAuth(setup('wrong'), ctx(store))).status, 403);
  assert.equal((await handleAuth(setup(ENV.SETUP_CODE, 'a good long password', 'nope nope nope'), ctx(store))).status, 400);
  assert.equal(store.saves, 0);

  const ok = await handleAuth(setup(ENV.SETUP_CODE), ctx(store));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(await roleOf(ok), 'partner');
  assert.ok(!JSON.stringify(store.records).includes('a good long password'));
  assert.ok(!JSON.stringify(store.records).includes(ENV.SETUP_CODE), 'codes are stored hashed');

  const reuse = await handleAuth(setup(ENV.SETUP_CODE, 'attacker password!'), ctx(store));
  assert.equal(reuse.status, 409, 'a used link cannot reset the password');
  assert.equal(await verifyPassword('a good long password', store.records.partner), true);
});

test('admin: sets their own password from the admin link and lands on /admin', async () => {
  const store = memStore();
  const res = await handleAuth(setup(ENV.ADMIN_SETUP_CODE, 'adrian long password'), ctx(store));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin');
  assert.equal(await roleOf(res), 'admin');
  assert.equal(store.records.partner, undefined, 'the partner record is untouched');
  assert.equal((await handleAuth(setup(ENV.ADMIN_SETUP_CODE, 'another long password'), ctx(store))).status, 409);

  const login = await handleAuth(post('login', { password: 'adrian long password' }), ctx(store));
  assert.equal(await roleOf(login), 'admin');
  assert.equal(login.headers.get('location'), '/admin');
});

test('admin page: admins only; shows whether the partner is set up', async () => {
  const store = memStore({ partner: { ...(await hashPassword('partner password 1', { iterations: FAST })), updatedAt: '2026-10-13T04:00:00Z' } });
  const page = (cookie) => handleAuth(new Request(`${BASE}/api/auth?do=admin`, { headers: cookie ? { cookie } : {} }), ctx(store));
  assert.equal((await page()).status, 401);
  assert.equal((await page(await cookieFor('partner'))).status, 401);
  const ok = await page(await cookieFor('admin'));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Partner password set Oct 13, 2026/);
});

test('admin makes a new partner link: it works once, replaces the old link, and resets the password', async () => {
  const store = memStore();
  await handleAuth(setup(ENV.SETUP_CODE, 'first partner pass'), ctx(store));
  assert.equal((await handleAuth(post('invite', {}, { cookie: await cookieFor('partner') }), ctx(store))).status, 401, 'partners cannot make links');

  const made = await handleAuth(post('invite', {}, { cookie: await cookieFor('admin') }), ctx(store));
  assert.equal(made.status, 200);
  const link = /value="(https:[^"]+\/setup\?code=[^"]+)"/.exec(await made.text())[1];
  const code = new URL(link).searchParams.get('code');
  assert.match(code, /^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
  assert.ok(!JSON.stringify(store.records.invite).includes(code), 'the link is shown once, stored hashed');

  assert.equal((await handleAuth(setup(ENV.SETUP_CODE, 'sneaky long pass'), ctx(store))).status, 403, 'the old SETUP_CODE link is replaced');
  const reset = await handleAuth(setup(code, 'second partner pass'), ctx(store));
  assert.equal(reset.status, 303);
  assert.equal(await verifyPassword('second partner pass', store.records.partner), true);
  assert.equal(await verifyPassword('first partner pass', store.records.partner), false);
  assert.equal((await handleAuth(setup(code, 'third partner pass'), ctx(store))).status, 409, 'the new link works once');
});

test('records from the first version count their setup code as used', async () => {
  const legacyHash = await sha256Hex(ENV.SETUP_CODE);
  const store = memStore({ partner: { ...(await hashPassword('old partner pass', { iterations: FAST })), setupCodeHash: legacyHash } });
  assert.equal((await handleAuth(setup(ENV.SETUP_CODE, 'takeover attempt!'), ctx(store))).status, 409);
});

test('setup is closed when no codes are set', async () => {
  const res = await handleAuth(setup('anything'), ctx(memStore(), { SESSION_SECRET: SECRET }));
  assert.equal(res.status, 403);
});

test('login: each person signs in with their own password; wrong or blank gets 401', async () => {
  const store = memStore({
    partner: await hashPassword('partner password 1', { iterations: FAST }),
    admin: await hashPassword('admin password 22', { iterations: FAST }),
  });
  assert.equal(await roleOf(await handleAuth(post('login', { password: 'partner password 1' }), ctx(store))), 'partner');
  assert.equal(await roleOf(await handleAuth(post('login', { password: 'admin password 22' }), ctx(store))), 'admin');
  assert.equal((await handleAuth(post('login', { password: 'nope' }), ctx(store))).status, 401);
  assert.equal((await handleAuth(post('login', { password: '' }), ctx(memStore()))).status, 401);
});

test('change password: works for either person, needs a session and the current password', async () => {
  for (const role of ['partner', 'admin']) {
    const store = memStore({ [role]: { ...(await hashPassword('old password 123', { iterations: FAST })), usedCodes: ['h'] } });
    const cookie = await cookieFor(role);
    const body = { current: 'old password 123', password: 'new password 456', confirm: 'new password 456' };
    assert.equal((await handleAuth(post('change', body), ctx(store))).status, 401, 'signed out');
    assert.equal((await handleAuth(post('change', { ...body, current: 'wrong' }, { cookie }), ctx(store))).status, 401);
    const ok = await handleAuth(post('change', body, { cookie }), ctx(store));
    assert.equal(ok.headers.get('location'), '/password?done=1');
    assert.equal(await verifyPassword('new password 456', store.records[role]), true);
    assert.deepEqual(store.records[role].usedCodes, ['h'], 'used setup links stay used');
  }
});

test('forms posted from another site are refused; logout clears the cookie', async () => {
  const res = await handleAuth(post('login', { password: 'x' }, { origin: 'https://evil.example' }), ctx(memStore()));
  assert.equal(res.status, 403);
  const out = await handleAuth(new Request(`${BASE}/api/auth?do=logout`), ctx(memStore()));
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('a real browser posting from our own page is accepted, even when it sends Origin: null', async () => {
  // Chrome sends "Origin: null" on form posts when the page's Referrer-Policy is
  // no-referrer; Sec-Fetch-Site still says same-origin. This 403'd in production.
  const store = memStore();
  const res = await handleAuth(post('setup', { code: ENV.ADMIN_SETUP_CODE, password: 'adrian long password', confirm: 'adrian long password' }, { origin: 'null', site: 'same-origin' }), ctx(store));
  assert.equal(res.status, 303);
  assert.equal(await roleOf(res), 'admin');
});

test('cross-site browser posts are refused, whatever Origin says', async () => {
  for (const [origin, site] of [['null', 'cross-site'], [BASE, 'cross-site'], ['https://evil.example', 'same-site'], ['null', undefined]]) {
    const res = await handleAuth(post('login', { password: 'x' }, { origin, site }), ctx(memStore()));
    assert.equal(res.status, 403, `origin=${origin} sec-fetch-site=${site}`);
  }
});

test('"Keep me signed in": checked lasts 14 days; unchecked ends with the browser and within 12 hours', async () => {
  const store = memStore({ partner: await hashPassword('partner password 1', { iterations: FAST }) });
  const kept = await handleAuth(post('login', { password: 'partner password 1', remember: '1' }), ctx(store));
  assert.match(kept.headers.get('set-cookie'), /Max-Age=1209600/);
  const now = Date.now();
  const brief = await handleAuth(post('login', { password: 'partner password 1' }), { ...ctx(store), now });
  assert.doesNotMatch(brief.headers.get('set-cookie'), /Max-Age/);
  const token = readCookie(cookieFrom(brief), SESSION_COOKIE);
  assert.deepEqual(await verifySession(token, SECRET, { now: now + 11 * 3_600_000 }), { role: 'partner' });
  assert.equal(await verifySession(token, SECRET, { now: now + 13 * 3_600_000 }), null);
});

test('sign-in pages: show/hide and copy buttons start hidden, so the forms work without the script', async () => {
  const { loginPage, adminPage } = await import('../auth/pages.mjs');
  const login = loginPage();
  assert.match(login, /data-reveal="f-password"[^>]*hidden/);
  assert.match(login, /src="\/brand\/auth-ui\.js"/);
  assert.match(adminPage({ newLink: 'https://x.example/setup?code=a' }), /data-copy="new-link"[^>]*hidden/);
});
