/**
 * auth/handler.mjs
 *
 * The form posts behind /api/auth: sign in, set a password from a setup link,
 * change a password, sign out. Storage is injected (`store.load()` /
 * `store.save(record)`) so this is tested without Vercel.
 *
 * Env:
 *   SESSION_SECRET  signs session cookies (required; change it to sign everyone out)
 *   SETUP_CODE      the code in Adrian's setup link. One use per value: to
 *                   reset the partner's password, set a new value and redeploy.
 *   SITE_PASSWORD   optional admin password for Adrian's own access
 */

import {
  signSession, verifySession, readCookie, sessionCookie, clearCookie, SESSION_COOKIE,
  hashPassword, verifyPassword, checkNewPassword, sameText, sha256Hex,
} from './core.mjs';
import { loginPage, setupPage, changePage, notReadyPage, htmlResponse } from './pages.mjs';

const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

export async function handleAuth(request, { env, store, now, iterations } = {}) {
  const url = new URL(request.url);
  const action = url.searchParams.get('do');
  if (!env.SESSION_SECRET) return htmlResponse(notReadyPage(), 503);

  if (action === 'logout') return redirect('/', clearCookie());
  if (request.method !== 'POST') return redirect('/');

  // Forms only ever post from this site.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });

  const form = new URLSearchParams(await request.text());
  const signIn = async (role, to = '/') => redirect(to, sessionCookie(await signSession(role, env.SESSION_SECRET, { now })));

  if (action === 'login') {
    const password = form.get('password') || '';
    if (env.SITE_PASSWORD && (await sameText(password, env.SITE_PASSWORD))) return signIn('admin');
    const record = await store.load();
    if (record && (await verifyPassword(password, record))) return signIn('partner');
    return htmlResponse(loginPage({ error: true }), 401);
  }

  if (action === 'setup') {
    const code = form.get('code') || '';
    const again = (error, status) => htmlResponse(setupPage({ code, error }), status);
    if (!env.SETUP_CODE || !(await sameText(code, env.SETUP_CODE))) {
      return htmlResponse(setupPage({ invalid: true }), 403);
    }
    const codeHash = await sha256Hex(env.SETUP_CODE);
    const record = await store.load();
    if (record && record.setupCodeHash === codeHash) {
      return htmlResponse(setupPage({ used: true }), 409);
    }
    const problem = checkNewPassword(form.get('password'), form.get('confirm'));
    if (problem) return again(problem, 400);
    await store.save({ ...(await hashPassword(form.get('password'), { iterations })), setupCodeHash: codeHash, updatedAt: new Date(now ?? Date.now()).toISOString() });
    return signIn('partner');
  }

  if (action === 'change') {
    const session = await verifySession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), env.SESSION_SECRET, { now });
    if (!session) return htmlResponse(loginPage(), 401);
    if (session.role !== 'partner') return htmlResponse(changePage({ role: session.role }), 403);
    const record = await store.load();
    if (!record || !(await verifyPassword(form.get('current') || '', record))) {
      return htmlResponse(changePage({ error: 'Your current password is not right.' }), 401);
    }
    const problem = checkNewPassword(form.get('password'), form.get('confirm'));
    if (problem) return htmlResponse(changePage({ error: problem }), 400);
    await store.save({ ...(await hashPassword(form.get('password'), { iterations })), setupCodeHash: record.setupCodeHash, updatedAt: new Date(now ?? Date.now()).toISOString() });
    return signIn('partner', '/password?done=1');
  }

  return redirect('/');
}
