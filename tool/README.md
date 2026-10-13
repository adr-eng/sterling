# Sterling lead finder

Finds local businesses that lose phone calls, and ranks them by how much an AI
voice agent (answering, booking, after-hours) would help them. Searches Google
Maps through **your own** Outscraper account. No installs: Node.js 20+ only.

## Quick start

```bash
npm test                                                   # all checks; no key, no cost
node cli/sterling.mjs --fixture fixtures/sample-response.json   # made-up sample data
node cli/sterling.mjs --niche plumber --location "Austin, TX" --dry-run   # see searches + cost
```

Live run, on your Outscraper account:

```bash
export OUTSCRAPER_API_KEY=your-key        # Windows PowerShell: $env:OUTSCRAPER_API_KEY="your-key"
node cli/sterling.mjs --profile sterling-profile.json --out runs
```

Get a key at <https://app.outscraper.com/account/api>. The first 500 places each
month are free, then about $3 per 1,000. Set the key in your terminal only; never
put it in a file you share or commit.

`--out runs` writes `runs/<time>/leads.csv` and `leads.json`. Make a profile in
the web lead finder (**Your profile > Export**), or pass `--niche` and
`--location` (both repeatable). `node cli/sterling.mjs --help` lists every flag.

## How a lead is scored

| Signal | Weight | What earns it |
|---|---|---|
| `nicheFit` | 35 | Urgent trades (plumber, HVAC, locksmith...) 1.0, appointment businesses (dentist, vet, auto repair...) 0.7, others 0.1 |
| `callVolume` | 25 | Google review count, log-scaled (about 316 reviews = full) |
| `coverageGap` | 20 | Closed weekends or weekdays, or closing by 6 PM. 24 hours = 0, unknown = 0.5 |
| `phoneOnlyBooking` | 10 | No online booking link |
| `ownerVerified` | 10 | Claimed Google listing |

Gates: no phone scores 0; permanently closed keeps 20%. A name seen 3+ times in
a run is a `likelyChain`. Weights live in the profile and are rescaled to 100.
Each lead carries `reasons`, plain-English lines that explain the score.

## Files

| Path | What it is |
|---|---|
| `lib/score.mjs` | Place → scored lead, plus the business-type lists. Pure. |
| `lib/profile.mjs` | Profile defaults, validation, search plan, cost estimate. Pure. |
| `lib/outscraper.mjs` | The only code that calls Outscraper. |
| `lib/csv.mjs` | CSV export, safe against spreadsheet formulas. |
| `cli/sterling.mjs` | Command-line runner. |
| `fixtures/sample-response.json` | Made-up Outscraper response for tests. |
| `test/` | `node --test` suites. |
| `AGENTS.md` | Rules for an AI agent changing this code. |

The web lead finder in the partner portal runs this same `lib/` in the browser.
