# Sterling

A password-protected partner portal plus a lead finder for selling AI voice
agents to local businesses. Built on the Hirobius Portal Kit (pinned v20).
Static site on Vercel: no build step, no dependencies.

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
| `middleware.js` · `scripts/kit/gate.mjs` | The password gate (kit v20). |
| `links.json` | The portal's Links section (synced into the page). |
| `test/` | Checks that the page renders, the handoff matches the page and the code, and the zip is current. |

## Deploy and set the password

1. Vercel → **Add New… → Project** → import `adr-eng/sterling`. Framework preset **Other**, no build command, output directory blank.
2. On the same screen, open **Environment Variables** and add `SITE_PASSWORD` with the password you'll give the partner. Deploy.
3. To change it later: Project → **Settings → Environment Variables** → edit `SITE_PASSWORD` → **Deployments → Redeploy**. Changing it signs everyone out.

The gate is fail-open: with no `SITE_PASSWORD`, the site is public. Set it before (or with) the first deploy. Send the partner the password by text, not in the same email as the link.

## Hand the partner a file

1. Put it in `files/` (for example `files/custom-spec.pdf`).
2. Add an entry to the `updates` section in `index.html` with an attachment: `{ "label": "Your custom spec", "href": "/files/custom-spec.pdf" }`.
3. `npm run check`, commit, push. Vercel redeploys.

## Change the tool

Edit `tool/`, run `npm run pack` (rebuilds `files/sterling-tool.zip`), then `npm run check`. The tests fail if the zip is stale, if the Copy-for-AI handoff drifts from the questions on the page, or if the scoring described to the partner drifts from the code.

## The partner's flow

1. Logs in, follows **Get set up**: Outscraper account, API key, test search.
2. Selects **Copy for AI**, pastes it into Claude or ChatGPT, says "go". The assistant asks the 10 questions one at a time, then writes an **email to Adrian** (answers + a spec for their custom version) and a **profile JSON** they import into the lead finder.
3. You build the custom version from the spec and hand it over under **Updates**.
