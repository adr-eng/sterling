# Sterling

A password-protected partner portal plus a lead finder for selling AI voice
agents to local businesses. Built on the Hirobius Portal Kit (pinned v20).
Static site on Vercel plus one sign-in function. No build step.

**Keys never touch our side.** The partner saves their own Outscraper key in the
lead finder; it stays in their browser and goes straight to Outscraper, so every
search bills to their account. The finder's security policy only lets the page
talk to Outscraper. Hirobius never receives, stores or needs the key.

## What's here

| Path | What it is |
|---|---|
| `index.html` | The portal: setup steps, questions, updates, links, documents. Data only; the kit renders it. |
| `finder.html` · `finder.js` · `finder.css` | The web lead finder (bring-your-own-key). |
| `tool/` | The lead finder's code, shared by the web finder and the command-line tool. This folder is the download. |
| `files/` | Files handed to the partner, served behind the password. `sterling-tool.zip` is built from `tool/`. |
| `middleware.js` · `auth/` · `api/auth.js` | Sign-in: partner-set password, signed session cookies. |
| `links.json` | The portal's Links section (synced into the page). |
| `test/` | Checks that the page renders, the handoff matches the page and the code, and the zip is current. |

## Sign-in: the partner sets their own password

Nobody shares a password. You send a one-time **setup link**; the partner picks
their password; only a PBKDF2 hash is stored (private Vercel Blob store), so you
never see it. Sessions are signed cookies that last 14 days. The site is
fail-closed: without `SESSION_SECRET` it shows "not set up yet".

| Env var (Vercel) | What it does |
|---|---|
| `SESSION_SECRET` | Signs sign-in cookies. Change it to sign everyone out. |
| `SETUP_CODE` | The code in the setup link. Each value works once. |
| `SITE_PASSWORD` | Optional: your own admin password, to view the portal yourself. |
| `BLOB_READ_WRITE_TOKEN` | Added by Vercel when the private Blob store is connected. |

- **Setup link:** `https://<site>/setup?code=<SETUP_CODE>`. Text it to the partner.
- **Partner forgot their password:** set a new `SETUP_CODE` in Vercel → Settings → Environment Variables, redeploy, send the new link.
- **Partner wants a new password:** they change it themselves at `/password` (linked from the portal and the lead finder).

Code: `middleware.js` → `auth/gate.mjs` (checks the cookie on every request), `api/auth.js` → `auth/handler.mjs` (sign in, set, change, sign out), `auth/store.mjs` (Blob), `auth/pages.mjs` (the forms).

## Hand the partner a file

1. Put it in `files/` (for example `files/custom-spec.pdf`).
2. Add an entry to the `updates` section in `index.html` with an attachment: `{ "label": "Your custom spec", "href": "/files/custom-spec.pdf" }`.
3. `npm run check`, commit, push. Vercel redeploys.

## Change the tool

Edit `tool/`, run `npm run pack` (rebuilds `files/sterling-tool.zip`), then `npm run check`. The tests fail if the zip is stale, if the Copy-for-AI handoff drifts from the questions on the page, or if the scoring described to the partner drifts from the code.

## The partner's flow

1. Opens your setup link, picks a password, lands in the portal. Follows **Get set up**: Outscraper account, API key, test search.
2. Selects **Copy for AI**, pastes it into Claude or ChatGPT, says "go". The assistant asks the 10 questions one at a time, then writes an **email to Adrian** (answers + a spec for their custom version) and a **profile JSON** they import into the lead finder.
3. You build the custom version from the spec and hand it over under **Updates**.
