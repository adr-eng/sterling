/**
 * auth/handler.mjs
 *
 * Everything behind /api/auth: sign in, set a password from a setup link,
 * change a password, sign out, and Adrian's admin page (/admin rewrites here).
 * Storage is injected (`store.load(name)` / `store.save(name, record)`, names
 * "partner" | "admin" | "invite") so this is tested without Vercel.
 *
 * Two people, each with their own password that only they know:
 *   partner  sets it from a setup link: the newest one made on /admin, or, until
 *            one is made there, /setup?code=SETUP_CODE
 *   admin    Adrian; sets it from /setup?code=ADMIN_SETUP_CODE
 * Every setup code works once. Env: SESSION_SECRET (required), SETUP_CODE,
 * ADMIN_SETUP_CODE.
 */

import {
  signSession, verifySession, readCookie, sessionCookie, clearCookie, SESSION_COOKIE,
  hashPassword, verifyPassword, checkNewPassword, sameText, sha256Hex,
} from './core.mjs';
import { loginPage, setupPage, changePage, adminPage, notReadyPage, htmlResponse } from './pages.mjs';

const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const ROLES = ['partner', 'admin'];
const USED_CODES_KEPT = 50;

/** Setup codes already spent on this record (older records kept one). */
const usedCodes = (rec) => (rec ? rec.usedCodes ?? (rec.setupCodeHash ? [rec.setupCodeHash] : []) : []);

/** A random setup code like "k7m2q-x9p4t-...", ~98 bits. */
function newCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return s.match(/.{5}/g).join('-');
}

/** Which role a setup code is for, or null. The newest admin-made link replaces SETUP_CODE. */
async function roleForCode(code, env, store) {
  if (env.ADMIN_SETUP_CODE && (await sameText(code, env.ADMIN_SETUP_CODE))) return 'admin';
  const invite = await store.load('invite');
  if (invite) return (await sameText(await sha256Hex(code), invite.codeHash)) ? 'partner' : null;
  if (env.SETUP_CODE && (await sameText(code, env.SETUP_CODE))) return 'partner';
  return null;
}

/**
 * True when a POST did not come from this site. Browsers send Sec-Fetch-Site,
 * which pages can't fake; trust it first, because a strict Referrer-Policy can
 * make a same-site form send "Origin: null". Clients without either header
 * (curl, scripts) are allowed; they can't ride a signed-in browser session.
 */
export function isCrossSite(request, url) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === 'null' || origin !== url.origin;
}

export async function handleAuth(request, { env, store, now, iterations } = {}) {
  const url = new URL(request.url);
  const action = url.searchParams.get('do');
  if (!env.SESSION_SECRET) return htmlResponse(notReadyPage(), 503);

  const session = await verifySession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), env.SESSION_SECRET, { now });
  const stamp = () => new Date(now ?? Date.now()).toISOString();
  const signIn = async (role, to = '/') => redirect(to, sessionCookie(await signSession(role, env.SESSION_SECRET, { now })));

  if (action === 'logout') return redirect('/', clearCookie());

  if (action === 'admin' && request.method === 'GET') {
    if (session?.role !== 'admin') return htmlResponse(loginPage(), 401);
    return htmlResponse(adminPage({ partner: await store.load('partner'), invite: await store.load('invite') }));
  }

  if (request.method !== 'POST') return redirect('/');

  // Forms only ever post from this site.
  if (isCrossSite(request, url)) return new Response('Forbidden', { status: 403 });
  const form = new URLSearchParams(await request.text());

  if (action === 'login') {
    const password = form.get('password') || '';
    for (const role of ROLES) {
      const record = await store.load(role);
      if (record && (await verifyPassword(password, record))) return signIn(role, role === 'admin' ? '/admin' : '/');
    }
    return htmlResponse(loginPage({ error: true }), 401);
  }

  if (action === 'setup') {
    const code = form.get('code') || '';
    const role = code ? await roleForCode(code, env, store) : null;
    if (!role) return htmlResponse(setupPage({ invalid: true }), 403);
    const codeHash = await sha256Hex(code);
    const record = await store.load(role);
    const spent = usedCodes(record);
    if (spent.includes(codeHash)) return htmlResponse(setupPage({ used: true }), 409);
    const problem = checkNewPassword(form.get('password'), form.get('confirm'));
    if (problem) return htmlResponse(setupPage({ code, error: problem }), 400);
    await store.save(role, {
      ...(await hashPassword(form.get('password'), { iterations })),
      usedCodes: [...spent, codeHash].slice(-USED_CODES_KEPT),
      updatedAt: stamp(),
    });
    return signIn(role, role === 'admin' ? '/admin' : '/');
  }

  if (action === 'change') {
    if (!session) return htmlResponse(loginPage(), 401);
    const record = await store.load(session.role);
    if (!record || !(await verifyPassword(form.get('current') || '', record))) {
      return htmlResponse(changePage({ role: session.role, error: 'Your current password is not right.' }), 401);
    }
    const problem = checkNewPassword(form.get('password'), form.get('confirm'));
    if (problem) return htmlResponse(changePage({ role: session.role, error: problem }), 400);
    await store.save(session.role, { ...(await hashPassword(form.get('password'), { iterations })), usedCodes: usedCodes(record), updatedAt: stamp() });
    return signIn(session.role, '/password?done=1');
  }

  if (action === 'invite') {
    if (session?.role !== 'admin') return htmlResponse(loginPage(), 401);
    const code = newCode();
    await store.save('invite', { codeHash: await sha256Hex(code), createdAt: stamp() });
    const link = `${url.origin}/setup?code=${code}`;
    return htmlResponse(adminPage({ partner: await store.load('partner'), newLink: link }));
  }

  return redirect('/');
}
