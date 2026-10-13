// Middleware: the site password gate, from the shared Portal Kit.
//
// All logic and the login page live in scripts/kit/gate.mjs (copied from
// portal-kit releases/v20/tools/gate.mjs); this file is only this site's config.
// The password is the SITE_PASSWORD environment variable in the Vercel project,
// never in code. Fail-open: with no SITE_PASSWORD set, nothing is gated, so set
// it before (or right as) the first deploy. Changing it signs everyone out.
export const config = {
  matcher: '/((?!favicon\\.ico|fonts/|_vercel/).*)',
};

const settings = {
  client: 'Sterling',
  title: 'Sterling Portal',
  cookie: 'sterling_auth',
  salt: 'sterling',
  release: 'v20',
  note: 'Private partner portal. Access is shared directly by Hirobius.',
  variant: 'card',
};

// Loaded with import() so it works on both Vercel middleware runtimes
// (Edge bundles it; the Node runtime can't require() an ES module).
let gate;
export default async function middleware(request) {
  gate ||= (await import('./scripts/kit/gate.mjs')).portalGate(settings);
  return gate(request);
}
