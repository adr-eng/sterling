/**
 * auth/pages.mjs
 *
 * The sign-in, set-password and change-password pages. Plain HTML strings,
 * styled like the Portal Kit login (kit theme.css for fonts and colors, a
 * small inline layout with fallbacks), so they render even if the kit host is
 * down. Everything interpolated is escaped.
 */

const KIT = 'https://portal-kit-adrian-6234s-projects.vercel.app/releases/v20/theme.css';
const CONTACT = 'adrian@hirobius.com';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg,#f3f3f4);color:var(--ink,#141414);font-family:var(--sans,'Satoshi',system-ui,sans-serif);line-height:1.55;-webkit-font-smoothing:antialiased}
.pk-login{min-height:100%;display:grid;place-items:center;padding:24px 16px}
.pk-box{width:100%;max-width:400px;background:var(--panel,#fff);border:1px solid var(--line,#e4e4e4);border-radius:16px;padding:28px 24px;display:grid;gap:16px}
h1{margin:0;font-size:1.15rem;font-weight:700;letter-spacing:-.015em}
p{margin:0}.sub{color:var(--muted,#555);font-size:.92rem}
form{display:grid;gap:12px;margin:0}
label{display:grid;gap:4px;font-size:.8rem;font-weight:600}
input{width:100%;font:inherit;font-size:1rem;padding:.75rem .85rem;border-radius:10px;border:1px solid var(--line-strong,#cfcfcf);background:var(--panel,#fff);color:var(--ink,#141414)}
input:focus{outline:2px solid var(--ink,#141414);outline-offset:1px;border-color:var(--ink,#141414)}
button{font:inherit;font-size:.95rem;font-weight:600;min-height:44px;padding:.75rem;border:0;border-radius:10px;background:var(--accent,#141414);color:var(--panel,#fff);cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--ink,#141414);outline-offset:2px}
a{color:inherit;text-underline-offset:2px}
.err{color:#b3372f;font-size:.9rem}.ok{color:var(--ok,#218358);font-size:.9rem;font-weight:600}
.note{color:var(--faint,#6e6e6e);font-size:.8rem}
.links{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:.9rem}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .err{color:#ef7d74}}
`;

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(title)} · Sterling</title>
<link rel="stylesheet" href="${KIT}"/>
<style>${CSS}</style></head>
<body><main class="pk-login"><div class="pk-box">${inner}</div></main></body></html>`;
}

const errLine = (msg) => (msg ? `<p class="err" role="alert">${esc(msg)}</p>` : '');
const pw = (name, label, auto, extra = '') =>
  `<label>${esc(label)}<input type="password" name="${name}" autocomplete="${auto}" required ${extra}/></label>`;

export function loginPage({ error } = {}) {
  return page('Sign in', `<h1>Sterling</h1>
<p class="sub">Enter your password to continue.</p>
${errLine(error ? 'Incorrect password. Try again.' : '')}
<form method="POST" action="/api/auth?do=login">
${pw('password', 'Password', 'current-password', 'autofocus')}
<button type="submit">Sign in</button>
</form>
<p class="note">Forgot it? Ask Adrian (${CONTACT}) for a new setup link.</p>`);
}

export function setupPage({ code = '', error = '', invalid = false, used = false } = {}) {
  if (used) {
    return page('Set your password', `<h1>Link already used</h1>
<p class="sub">Your password is already set with this link. Sign in instead. Forgot it? Ask ${CONTACT} for a new setup link.</p>
<p class="links"><a href="/">Sign in</a></p>`);
  }
  if (!code || invalid) {
    const why = invalid ? "This setup link isn't valid, or a newer one has replaced it." : 'This page needs the setup link Adrian sent you.';
    return page('Set your password', `<h1>Set your password</h1>
<p class="sub">${why} Ask ${CONTACT} for a new link.</p>
<p class="links"><a href="/">Sign in instead</a></p>`);
  }
  return page('Set your password', `<h1>Choose your password</h1>
<p class="sub">You'll use it to sign in. Only you will know it; Hirobius never sees it.</p>
${errLine(error)}
<form method="POST" action="/api/auth?do=setup">
<input type="hidden" name="code" value="${esc(code)}"/>
${pw('password', 'New password (at least 10 characters)', 'new-password', 'minlength="10" autofocus')}
${pw('confirm', 'Type it again', 'new-password', 'minlength="10"')}
<button type="submit">Set password</button>
</form>
<p class="note">Tip: a short phrase of four or five words is strong and easy to remember.</p>`);
}

export function changePage({ error = '', done = false, role = 'partner' } = {}) {
  const adminLink = role === 'admin' ? '<a href="/admin">Admin</a>' : '';
  return page('Change password', `<h1>Change your password</h1>
${done ? '<p class="ok" role="status">Password changed.</p>' : ''}
${errLine(error)}
<form method="POST" action="/api/auth?do=change">
${pw('current', 'Current password', 'current-password')}
${pw('password', 'New password (at least 10 characters)', 'new-password', 'minlength="10"')}
${pw('confirm', 'Type the new one again', 'new-password', 'minlength="10"')}
<button type="submit">Change password</button>
</form>
<p class="links"><a href="/">Back to the portal</a>${adminLink}<a href="/api/auth?do=logout">Sign out</a></p>`);
}

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
};

/**
 * Adrian's admin page: who has a password, and a one-click new setup link
 * for the partner (shown once, right after it's made).
 */
export function adminPage({ partner = null, invite = null, newLink = '' } = {}) {
  const status = partner
    ? `Partner password set ${esc(when(partner.updatedAt))}.`
    : 'The partner has not set a password yet.';
  const pending = invite && !newLink ? `<p class="note">A setup link made ${esc(when(invite.createdAt))} is waiting to be used. Making a new one replaces it.</p>` : '';
  const fresh = newLink
    ? `<p class="ok" role="status">New setup link. Copy it now; it won't be shown again.</p>
<label>Partner setup link<input type="text" readonly value="${esc(newLink)}"/></label>
<p class="note">Works once. Their old password stops working once they use it.</p>`
    : '';
  return page('Admin', `<h1>Sterling admin</h1>
<p class="sub">${status}</p>
${fresh}${pending}
<form method="POST" action="/api/auth?do=invite">
<button type="submit">${partner ? 'Reset partner password: new setup link' : 'New partner setup link'}</button>
</form>
<p class="links"><a href="/">Open the portal</a><a href="/finder.html">Lead finder</a><a href="/password">Change my password</a><a href="/api/auth?do=logout">Sign out</a></p>`);
}

export function notReadyPage() {
  return page('Not set up yet', `<h1>Sterling</h1>
<p class="sub">This portal isn't set up yet. If you were expecting access, email ${CONTACT}.</p>`);
}

export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
