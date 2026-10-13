/**
 * auth/gate.mjs
 *
 * What the middleware does on every request. Fail-closed: with no
 * SESSION_SECRET nothing is served. Stateless: it only checks the signed
 * session cookie, so it never touches storage.
 *
 *   /api/auth     passes through (the auth function checks its own input)
 *   /setup        the choose-your-password page (needs ?code= from Adrian's link)
 *   /password     change password (signed in only)
 *   anything else the site, if signed in; otherwise the sign-in page
 */

import { verifySession, readCookie, SESSION_COOKIE } from './core.mjs';
import { loginPage, setupPage, changePage, notReadyPage, htmlResponse } from './pages.mjs';

export async function gate(request, { env, now } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/auth') return undefined;
  if (!env.SESSION_SECRET) return htmlResponse(notReadyPage(), 503);
  if (path === '/setup') return htmlResponse(setupPage({ code: url.searchParams.get('code') || '' }));

  const session = await verifySession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), env.SESSION_SECRET, { now });
  if (!session) return htmlResponse(loginPage(), 401);
  if (path === '/password') return htmlResponse(changePage({ role: session.role, done: url.searchParams.has('done') }));
  return undefined; // signed in: serve the page
}
