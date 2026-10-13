/**
 * auth/pages.mjs
 *
 * The sign-in, set-password, change-password and admin pages. Plain HTML
 * strings: one card with a header (logo slot, heading), a body (the form)
 * and a footer. HDS rules hold here too: kit sans only, sentence case, no
 * shadows (test/auth.test.mjs checks). Fonts and colors come from
 * the kit's theme.css; every var() has a fallback so the pages render even if
 * the kit host is down. Everything interpolated is escaped.
 *
 * The only script is /brand/auth-ui.js (show/hide password, copy link). It is
 * served even when signed out (auth/gate.mjs), and every page works without it.
 *
 * LOGO: until there is one, the header shows the "Sterling" wordmark. To use a
 * logo, add brand/logo.svg and set BRAND_LOGO to '/brand/logo.svg'.
 */

const KIT = 'https://portal-kit-adrian-6234s-projects.vercel.app/releases/v20/theme.css';
const CONTACT = 'adrian@hirobius.com';
export const BRAND_LOGO = null;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg,#f3f3f4);color:var(--ink,#141414);font-family:var(--sans,'Satoshi',system-ui,sans-serif);line-height:1.55;-webkit-font-smoothing:antialiased}
.au-auth{min-height:100%;display:grid;place-items:center;align-content:center;gap:20px;padding:32px 16px}
.au-card{width:100%;max-width:400px;background:var(--panel,#fff);border:1px solid var(--line,#e4e4e4);border-radius:16px;overflow:hidden}
.au-card>*{padding:24px}
.au-card-head{text-align:center;display:grid;justify-items:center;gap:6px;padding-top:32px}
.au-card-body{border-top:1px solid var(--line,#e4e4e4);display:grid;gap:16px}
.au-card-foot{border-top:1px solid var(--line,#e4e4e4);text-align:center;font-size:.85rem;color:var(--muted,#555);padding-top:16px;padding-bottom:16px}
.au-brand{margin:0 0 4px;font-size:.95rem;font-weight:700;letter-spacing:-.01em}
.au-brand img{display:block;height:28px;width:auto}
h1{margin:0;font-weight:700;font-size:1.6rem;line-height:1.2;letter-spacing:-.015em;text-wrap:balance}
p{margin:0}.au-sub{color:var(--muted,#555);font-size:.88rem;text-wrap:balance}
form{display:grid;gap:16px;margin:0}
.au-field{display:grid;gap:6px}
.au-field-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
label,.au-lbl{font-size:.85rem;font-weight:600;color:var(--ink,#141414)}
.au-field-top a{font-size:.85rem;color:var(--muted,#555);text-decoration:none}
.au-field-top a:hover{color:var(--ink,#141414);text-decoration:underline}
.au-input-wrap{position:relative}
input[type=password],input[type=text]{width:100%;font:inherit;font-size:1rem;padding:.7rem .85rem;border-radius:10px;border:1px solid var(--line-strong,#cfcfcf);background:var(--panel,#fff);color:var(--ink,#141414)}
.au-input-wrap input{padding-right:3rem}
input:focus{outline:2px solid var(--ink,#141414);outline-offset:1px;border-color:var(--ink,#141414)}
.au-reveal{position:absolute;top:0;right:0;height:100%;width:44px;display:grid;place-items:center;border:0;background:transparent;color:var(--muted,#555);cursor:pointer;border-radius:0 10px 10px 0}
.au-reveal:hover{color:var(--ink,#141414)}
.au-reveal[hidden]{display:none}
.au-reveal svg{width:18px;height:18px}
.au-check{display:flex;align-items:center;gap:10px;font-size:.88rem;font-weight:400;color:var(--muted,#555);cursor:pointer;min-height:24px}
.au-check input{width:18px;height:18px;margin:0;accent-color:var(--ink,#141414)}
.au-btn{font:inherit;font-size:.95rem;font-weight:600;min-height:46px;padding:.7rem 1rem;border:0;border-radius:10px;background:var(--accent,#141414);color:var(--panel,#fff);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%}
.au-btn svg{width:16px;height:16px}
.au-btn.au-ghost{background:transparent;color:var(--ink,#141414);border:1px solid var(--line-strong,#cfcfcf)}
.au-btn[hidden]{display:none}
button:focus-visible,a:focus-visible,.au-check input:focus-visible{outline:2px solid var(--ink,#141414);outline-offset:2px}
a{color:inherit;text-underline-offset:2px}
.au-card-foot a{color:var(--ink,#141414);font-weight:600}
.au-err{color:#b3372f;font-size:.9rem}.au-ok{color:var(--ok,#218358);font-size:.9rem;font-weight:600}
.au-note{color:var(--muted,#555);font-size:.82rem}
.au-links{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px}
.au-meta{margin:0;font-size:.8rem;color:var(--muted,#555);text-align:center}

.au-copy-row{display:flex;gap:8px}.au-copy-row input{flex:1;min-width:0;font-size:.85rem}
.au-copy-row .au-btn{width:auto;min-height:0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .au-err{color:#ef7d74}}
`;

const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const brand = () => (BRAND_LOGO ? `<p class="au-brand"><img src="${esc(BRAND_LOGO)}" alt="Sterling"/></p>` : '<p class="au-brand">Sterling</p>');

/**
 * One card page: `heading` + `sub` in the header, `body` (form or message),
 * `foot` (the line under it), `meta` (small print below the card).
 */
function page(title, { heading, sub = '', body = '', foot = '', meta = ['Private partner portal', 'Only you know your password'] }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(title)} · Sterling</title>
<link rel="stylesheet" href="${KIT}"/>
<style>${CSS}</style>
<script src="/brand/auth-ui.js" defer></script></head>
<body><main class="au-auth">
<div class="au-card">
<div class="au-card-head">${brand()}<h1>${esc(heading)}</h1>${sub ? `<p class="au-sub">${sub}</p>` : ''}</div>
${body ? `<div class="au-card-body">${body}</div>` : ''}
${foot ? `<div class="au-card-foot">${foot}</div>` : ''}
</div>
${meta.length ? `<p class="au-meta">${meta.map(esc).join(' · ')}</p>` : ''}
</main></body></html>`;
}

const errLine = (msg) => (msg ? `<p class="au-err" role="alert">${esc(msg)}</p>` : '');
const submit = (label) => `<button class="au-btn" type="submit">${esc(label)}${ICON_ARROW}</button>`;

/** A password field: label row (optional right-hand link) + input + show/hide toggle. */
function pwField(name, label, auto, { extra = '', aside = '' } = {}) {
  const id = `f-${name}`;
  return `<div class="au-field">
<div class="au-field-top"><label for="${id}">${esc(label)}</label>${aside}</div>
<div class="au-input-wrap"><input id="${id}" type="password" name="${name}" autocomplete="${auto}" required ${extra}/>
<button class="au-reveal" type="button" data-reveal="${id}" aria-label="Show password" aria-pressed="false" hidden>${ICON_EYE}</button></div>
</div>`;
}

const ask = (subject) => `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;

export function loginPage({ error } = {}) {
  return page('Sign in', {
    heading: 'Welcome back',
    sub: 'Sign in to your Sterling portal.',
    body: `${errLine(error ? 'Incorrect password. Try again.' : '')}
<form method="POST" action="/api/auth?do=login">
${pwField('password', 'Password', 'current-password', { extra: 'autofocus', aside: `<a href="${ask('Sterling: new setup link')}">Forgot?</a>` })}
<label class="au-check"><input type="checkbox" name="remember" value="1" checked/> Keep me signed in</label>
${submit('Sign in')}
</form>`,
    foot: `Need access? <a href="${ask('Sterling: access')}">Email Adrian</a>`,
  });
}

export function setupPage({ code = '', error = '', invalid = false, used = false } = {}) {
  const help = `<span class="au-links"><a href="/">Sign in</a><a href="${ask('Sterling: new setup link')}">Ask for a new link</a></span>`;
  if (used) {
    return page('Set your password', { heading: 'Link already used', sub: 'Your password is already set with this link. Sign in instead.', foot: help });
  }
  if (!code || invalid) {
    const why = invalid ? "This setup link isn't valid, or a newer one has replaced it." : 'This page needs the setup link Adrian sent you.';
    return page('Set your password', { heading: 'Set your password', sub: esc(why), foot: help });
  }
  return page('Set your password', {
    heading: 'Choose your password',
    sub: "You'll use it to sign in. Only you will know it; Hirobius never sees it.",
    body: `${errLine(error)}
<form method="POST" action="/api/auth?do=setup">
<input type="hidden" name="code" value="${esc(code)}"/>
${pwField('password', 'New password', 'new-password', { extra: 'minlength="10" autofocus' })}
${pwField('confirm', 'Type it again', 'new-password', { extra: 'minlength="10"' })}
<p class="au-note">At least 10 characters. A short phrase of four or five words is strong and easy to remember.</p>
${submit('Set password')}
</form>`,
  });
}

export function changePage({ error = '', done = false, role = 'partner' } = {}) {
  const adminLink = role === 'admin' ? '<a href="/admin">Admin</a>' : '';
  return page('Change password', {
    heading: 'Change your password',
    body: `${done ? '<p class="au-ok" role="status">Password changed.</p>' : ''}${errLine(error)}
<form method="POST" action="/api/auth?do=change">
${pwField('current', 'Current password', 'current-password')}
${pwField('password', 'New password', 'new-password', { extra: 'minlength="10"' })}
${pwField('confirm', 'Type the new one again', 'new-password', { extra: 'minlength="10"' })}
${submit('Change password')}
</form>`,
    foot: `<span class="au-links"><a href="/">Back to the portal</a>${adminLink}<a href="/api/auth?do=logout">Sign out</a></span>`,
  });
}

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
};

/**
 * Adrian's admin page: who has a password, and a one-click new setup link
 * for the partner (shown once, right after it's made).
 */
export function adminPage({ partner = null, invite = null, newLink = '' } = {}) {
  const status = partner ? `Partner password set ${esc(when(partner.updatedAt))}.` : 'The partner has not set a password yet.';
  const pending = invite && !newLink ? `<p class="au-note">A setup link made ${esc(when(invite.createdAt))} is waiting to be used. Making a new one replaces it.</p>` : '';
  const fresh = newLink
    ? `<p class="au-ok" role="status">New setup link. Copy it now; it won't be shown again.</p>
<div class="au-field"><span class="au-lbl">Partner setup link</span>
<div class="au-copy-row"><input type="text" readonly value="${esc(newLink)}" aria-label="Partner setup link" id="new-link"/><button class="au-btn au-ghost" type="button" data-copy="new-link" hidden>Copy</button></div></div>
<p class="au-note">Works once. Their old password stops working once they use it.</p>`
    : '';
  return page('Admin', {
    heading: 'Admin',
    sub: status,
    body: `${fresh}${pending}
<form method="POST" action="/api/auth?do=invite">
${submit(partner ? 'Reset partner password: new link' : 'New partner setup link')}
</form>`,
    foot: `<span class="au-links"><a href="/">Portal</a><a href="/finder.html">Lead finder</a><a href="/password">My password</a><a href="/api/auth?do=logout">Sign out</a></span>`,
    meta: ['Signed in as Adrian'],
  });
}

export function notReadyPage() {
  return page('Not set up yet', {
    heading: 'Not set up yet',
    sub: `This portal isn't ready. If you were expecting access, email ${esc(CONTACT)}.`,
  });
}

export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
