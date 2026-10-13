// Middleware: every request passes the sign-in gate first.
//
// The partner sets their own password from a one-time setup link
// (/setup?code=SETUP_CODE); only its hash is stored, in a private Vercel Blob
// store. Sessions are signed cookies (SESSION_SECRET). Fail-closed: with no
// SESSION_SECRET the site shows "not set up yet". Logic: auth/gate.mjs.
export const config = {
  matcher: '/((?!favicon\\.ico|_vercel/).*)',
};

// Loaded with import() so it works on both Vercel middleware runtimes
// (Edge bundles it; the Node runtime can't require() an ES module).
let gate;
export default async function middleware(request) {
  gate ||= (await import('./auth/gate.mjs')).gate;
  return gate(request, { env: process.env });
}
