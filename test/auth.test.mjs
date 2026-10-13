// The partner's own-password sign-in: hashing, sessions, the gate and every
// form path, against an in-memory store (no Vercel needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, hashPassword, verifyPassword, checkNewPassword, readCookie, SESSION_COOKIE } from '../auth/core.mjs';
import { gate } from '../auth/gate.mjs';
import { handleAuth } from '../auth/handler.mjs';

const SECRET = 'test-session-secret-0123456789';
const ENV = { SESSION_SECRET: SECRET, SETUP_CODE: 'invite-code-abc' };
const FAST = 1000; // PBKDF2 iterations for tests only; production uses 600,000
const BASE = 'https://sterling.example';

function memStore(record = null) {
  return { record, saves: 0, async load() { return this.record; }, async save(r) { this.record = r; this.saves++; } };
}
function post(action, fields, { cookie, origin = BASE } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
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
  assert.match(await out.text(), /Enter your password/);
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

test('setup: the right link sets the password once, signs in, and stores no plain text', async () => {
  const store = memStore();
  const bad = await handleAuth(post('setup', { code: 'wrong', password: 'a good long password', confirm: 'a good long password' }), { env: ENV, store, iterations: FAST });
  assert.equal(bad.status, 403);
  assert.equal(store.saves, 0);

  const mismatch = await handleAuth(post('setup', { code: ENV.SETUP_CODE, password: 'a good long password', confirm: 'nope nope nope' }), { env: ENV, store, iterations: FAST });
  assert.equal(mismatch.status, 400);

  const ok = await handleAuth(post('setup', { code: ENV.SETUP_CODE, password: 'a good long password', confirm: 'a good long password' }), { env: ENV, store, iterations: FAST });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!JSON.stringify(store.record).includes('a good long password'));
  assert.deepEqual(await verifySession(readCookie(cookieFrom(ok), SESSION_COOKIE), SECRET), { role: 'partner' });

  const reuse = await handleAuth(post('setup', { code: ENV.SETUP_CODE, password: 'attacker password!', confirm: 'attacker password!' }), { env: ENV, store, iterations: FAST });
  assert.equal(reuse.status, 409, 'a used link cannot reset the password');
  assert.equal(await verifyPassword('a good long password', store.record), true);

  const fresh = { ...ENV, SETUP_CODE: 'a-new-invite' }; // Adrian rotates the code to reset
  const reset = await handleAuth(post('setup', { code: 'a-new-invite', password: 'a brand new password', confirm: 'a brand new password' }), { env: fresh, store, iterations: FAST });
  assert.equal(reset.status, 303);
  assert.equal(await verifyPassword('a brand new password', store.record), true);
});

test('setup is closed when no SETUP_CODE is set', async () => {
  const res = await handleAuth(post('setup', { code: '', password: 'a good long password', confirm: 'a good long password' }), { env: { SESSION_SECRET: SECRET }, store: memStore(), iterations: FAST });
  assert.equal(res.status, 403);
});

test('login: partner password and optional admin password; wrong ones get 401', async () => {
  const store = memStore(await hashPassword('partner password 1', { iterations: FAST }));
  const ok = await handleAuth(post('login', { password: 'partner password 1' }), { env: ENV, store });
  assert.equal(ok.status, 303);
  assert.deepEqual(await verifySession(readCookie(cookieFrom(ok), SESSION_COOKIE), SECRET), { role: 'partner' });
  assert.equal((await handleAuth(post('login', { password: 'nope' }), { env: ENV, store })).status, 401);
  assert.equal((await handleAuth(post('login', { password: '' }), { env: { ...ENV, SITE_PASSWORD: '' }, store: memStore() })).status, 401, 'blank never matches');
  const admin = await handleAuth(post('login', { password: 'adrian-admin-pw' }), { env: { ...ENV, SITE_PASSWORD: 'adrian-admin-pw' }, store });
  assert.deepEqual(await verifySession(readCookie(cookieFrom(admin), SESSION_COOKIE), SECRET), { role: 'admin' });
});

test('change password: needs a partner session and the current password', async () => {
  const store = memStore({ ...(await hashPassword('old password 123', { iterations: FAST })), setupCodeHash: 'h' });
  const partner = `${SESSION_COOKIE}=${await signSession('partner', SECRET)}`;
  const admin = `${SESSION_COOKIE}=${await signSession('admin', SECRET)}`;
  const body = { current: 'old password 123', password: 'new password 456', confirm: 'new password 456' };
  assert.equal((await handleAuth(post('change', body), { env: ENV, store, iterations: FAST })).status, 401, 'signed out');
  assert.equal((await handleAuth(post('change', body, { cookie: admin }), { env: ENV, store, iterations: FAST })).status, 403, 'admin cannot set the partner password');
  assert.equal((await handleAuth(post('change', { ...body, current: 'wrong' }, { cookie: partner }), { env: ENV, store, iterations: FAST })).status, 401);
  const ok = await handleAuth(post('change', body, { cookie: partner }), { env: ENV, store, iterations: FAST });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/password?done=1');
  assert.equal(await verifyPassword('new password 456', store.record), true);
  assert.equal(await verifyPassword('old password 123', store.record), false);
  assert.equal(store.record.setupCodeHash, 'h', 'a used setup link stays used');
});

test('forms posted from another site are refused; logout clears the cookie', async () => {
  const res = await handleAuth(post('login', { password: 'x' }, { origin: 'https://evil.example' }), { env: ENV, store: memStore() });
  assert.equal(res.status, 403);
  const out = await handleAuth(new Request(`${BASE}/api/auth?do=logout`), { env: ENV, store: memStore() });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});
