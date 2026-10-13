// Portal Kit password gate — shared by every client site's middleware.js.
//
// Copy releases/vN/tools/gate.mjs into the site's scripts/kit/ (same as the
// other kit tools), then middleware.js is just config:
//
//   export const config = { matcher: '/((?!favicon\\.ico|fonts/|_vercel/).*)' };
//   const settings = {
//     client: 'Acme Co', cookie: 'acme_auth', salt: 'acme', release: 'v20',
//     note: 'Private project portal. Access is shared directly by Hirobius.', // optional
//     variant: 'card',                                                           // card | plain | split
//   };
//   let gate;
//   export default async function middleware(request) {
//     gate ||= (await import('./scripts/kit/gate.mjs')).portalGate(settings);
//     return gate(request);
//   }
//
// Use import(), not a top-level import: on Vercel's Node middleware runtime,
// middleware.js is compiled to CommonJS and cannot require() this ES module.
// If the site has a .vercelignore that excludes scripts/, re-include
// scripts/kit/gate.mjs or the deploy won't have it.
//
// The password lives in the SITE_PASSWORD environment variable (Vercel project
// settings), never in code. Fail-open by design: with no SITE_PASSWORD the gate
// is inert, so adding it can never lock anyone out. The cookie token is
// sha256(`${salt}:${password}`), the same as the original per-site gates, so
// switching a site over keeps everyone signed in. Changing the password signs
// everyone out.
//
// The page links the pinned kit theme.css for fonts and colors; its own layout
// CSS is inline with fallbacks, so the form still works if the kit host is down.
// Edge-runtime safe: Web APIs only, no Node imports.

const KIT_HOST = "https://portal-kit-adrian-6234s-projects.vercel.app";
const VARIANTS = ["card", "plain", "split"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CSS = `
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg,#f3f3f4);color:var(--ink,#141414);font-family:var(--sans,'Satoshi',system-ui,sans-serif);line-height:1.55;-webkit-font-smoothing:antialiased}
.pk-login{min-height:100%;display:grid;place-items:center;padding:24px 16px}
.pk-login h1{margin:0;font-weight:700;letter-spacing:-.015em;text-wrap:balance}
.pk-login form{display:grid;gap:12px;margin:0}
.pk-login input{width:100%;font:inherit;font-size:1rem;padding:.75rem .85rem;border-radius:10px;border:1px solid var(--line-strong,#cfcfcf);background:var(--panel,#fff);color:var(--ink,#141414)}
.pk-login input:focus{outline:2px solid var(--ink,#141414);outline-offset:1px;border-color:var(--ink,#141414)}
.pk-login button{font:inherit;font-size:.95rem;font-weight:600;padding:.75rem;border:0;border-radius:10px;background:var(--accent,#141414);color:var(--panel,#fff);cursor:pointer}
.pk-login button:focus-visible{outline:2px solid var(--ink,#141414);outline-offset:2px}
.pk-err{margin:0;color:#b3372f;font-size:.9rem}
.pk-note{margin:0;color:var(--faint,#6e6e6e);font-size:.8rem}
.pk-login--card .pk-box{width:100%;max-width:380px;background:var(--panel,#fff);border:1px solid var(--line,#e4e4e4);border-radius:16px;padding:28px 24px;display:grid;gap:18px}
.pk-login--card h1{font-size:1.15rem}
.pk-login--plain .pk-box{width:100%;max-width:340px;display:grid;gap:22px;text-align:center}
.pk-login--plain h1{font-size:1.6rem}
.pk-login--plain .pk-sub{margin:-12px 0 0;color:var(--muted,#555);font-size:.9rem}
.pk-login--plain input{text-align:center}
.pk-login--split{padding:0;place-items:stretch}
.pk-login--split .pk-box{display:grid;grid-template-columns:1fr;min-height:100%}
.pk-login--split .pk-brand{background:var(--panel,#fff);border-bottom:1px solid var(--line,#e4e4e4);padding:40px 24px 28px;display:grid;align-content:end;gap:8px}
.pk-login--split .pk-brand h1{font-size:1.6rem}
.pk-login--split .pk-brand .pk-note{font-size:.85rem}
.pk-login--split .pk-form{padding:28px 24px 40px;display:grid;align-content:start;gap:14px;width:100%;max-width:420px;justify-self:center}
.pk-login--split .pk-form p.pk-sub{margin:0;color:var(--muted,#555);font-size:.9rem}
@media (min-width:760px){
  .pk-login--split .pk-box{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .pk-login--split .pk-brand{border-bottom:0;border-right:1px solid var(--line,#e4e4e4);padding:56px;align-content:center}
  .pk-login--split .pk-brand h1{font-size:2.2rem}
  .pk-login--split .pk-form{align-content:center;padding:56px}
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pk-err{color:#ef7d74}}
`;

/** The login page HTML. Exported for tests and previews. */
export function loginHtml({ client, release, note, title, variant, error, kitHost = KIT_HOST }) {
  const v = VARIANTS.includes(variant) ? variant : "card";
  const name = esc(client);
  const err = error ? '<p class="pk-err" role="alert">Incorrect password. Try again.</p>' : "";
  const noteP = note ? `<p class="pk-note">${esc(note)}</p>` : "";
  const form = `<form method="POST" action="/__auth" autocomplete="off">
      <input type="password" name="password" aria-label="Password" placeholder="Password" autofocus required />
      <button type="submit">Enter</button>
    </form>`;
  let body;
  if (v === "split") {
    body = `<div class="pk-box"><div class="pk-brand"><h1>${name}</h1>${noteP}</div>
    <div class="pk-form"><p class="pk-sub">Enter the password to continue.</p>${err}${form}</div></div>`;
  } else if (v === "plain") {
    body = `<div class="pk-box"><h1>${name}</h1><p class="pk-sub">Enter the password to continue.</p>${err}${form}${noteP}</div>`;
  } else {
    body = `<div class="pk-box"><h1>${name}</h1>${err}${form}${noteP}</div>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(title || client)}</title>
<link rel="stylesheet" href="${esc(kitHost)}/releases/${esc(release)}/theme.css"/>
<style>${CSS}</style></head>
<body><main class="pk-login pk-login--${v}">${body}</main></body></html>`;
}

/** Build the middleware function for a client site. */
export function portalGate(opts) {
  const { cookie, salt } = opts;
  const env = opts.env || (() => (typeof process !== "undefined" && process.env) || {});
  const page = (status, error) =>
    new Response(loginHtml({ ...opts, error }), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  return async function middleware(request) {
    const expected = env().SITE_PASSWORD;
    if (!expected) return; // no password configured -> do not gate

    const token = await sha256(`${salt}:${expected}`);
    const jar = request.headers.get("cookie") || "";
    if (jar.split(";").some((c) => c.trim() === `${cookie}=${token}`)) return;

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/__auth") {
      const password = new URLSearchParams(await request.text()).get("password") || "";
      if (password === expected) {
        return new Response(null, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` },
        });
      }
      return page(401, true);
    }
    return page(401, false);
  };
}
