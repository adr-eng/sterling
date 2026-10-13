# AGENTS.md: working on the Sterling lead finder

You are an AI agent helping a voice-agent seller customize this tool. Read
`README.md` for what it does. These rules keep it safe and working.

## Hard rules

- **Never read, print, write or commit an API key.** The key comes from the
  `OUTSCRAPER_API_KEY` environment variable at run time, set by the human. If a
  task needs a new key, say which one and where to get it, then stop.
- **No dependencies.** Node.js 20+ built-ins only. The web finder imports
  `lib/*.mjs` directly in the browser, so `lib/` must stay browser-safe: no
  `node:` imports, no `process`, no filesystem.
- **`lib/outscraper.mjs` is the only network code.** Don't add calls to other
  services from `lib/`; the web finder's security policy only allows Outscraper.
- **Scraped data is untrusted and unverified.** Never commit `runs/` or real
  listings. Tests use only `fixtures/sample-response.json` (made up).
- **Never spend money in tests.** Tests inject `fetchImpl`; nothing calls the
  real API. Use `--dry-run` to show the cost of a live run before running it.

## How to change things

| Want to... | Change |
|---|---|
| Score a business type higher or lower | `URGENT` / `APPOINTMENT` lists in `lib/score.mjs` |
| Change how much a signal counts | The profile's `weights` (no code change), or `DEFAULT_WEIGHTS` in `lib/profile.mjs` |
| Add a new signal | A factor in `scoreLead()` + a weight in `DEFAULT_WEIGHTS` + a reason line + a test |
| Add a CSV column | `COLUMNS` in `lib/csv.mjs` |
| Send leads to a CRM | A new module that reads `leads.json` from `--out`; keep it out of `lib/` |

Work test-first: add a failing test in `test/`, make it pass, then run
`npm test`. All tests must pass before you hand anything back.

## Handing a spec back to Hirobius

If the human wants Hirobius to build their custom version, write a short spec:
target business types (ranked), areas, what their voice agent sells on, ideal
customer, size and exclusions, volume and monthly budget, where leads go,
contact enrichment yes/no, how they'll run it, scoring changes (which weights,
which direction, why), and open questions. No keys or passwords. The human
emails it to adrian@hirobius.com.
