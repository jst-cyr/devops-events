# Events Source Analysis Prompt Template (Agent Window)

Use this prompt in the agent window to discover upcoming events and reconcile them against our canonical data store.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

Your mission is to discover:

1. **Upcoming events in the next 56 days**, and
2. **Upcoming/active CFP opportunities whose CFP deadline is in the next 56 days** (even if the event date is outside that 56-day event window),

from the following sources, then reconcile those findings with `data/events.json`.

### Sources to analyze

- https://dev.events/ (discovery/index only; do not treat dev.events event detail pages as canonical event sources)
- https://adatosystems.com/cfp-tracker/
- https://devopsdays.org/events
- https://www.usenix.org/conference/srecon
- https://sreday.com/
- https://www.iacconf.com/events
- https://www.redhat.com/en/events
- https://www.carahsoft.com/red-hat/events
- https://cfgmgmtcamp.org/
- https://www.developerweek.com/

### Dev.events canonical extraction rule (required)

When using `https://dev.events/`:

1. Use dev.events only to discover candidate events in the date window.
2. For each discovered event, open the entry and extract the outbound official/native event URL (for example: "Visit website", "Official site", or equivalent external link).
3. Crawl the native event URL and extract event data from the native site.
4. Set `event_url` to the native event URL (never a dev.events conference detail URL).
5. If no native URL is available, or the native URL cannot be fetched/parsed, do not include that item in candidates/updates; instead write an issue record to `data/events-issues.json`.
6. Add a brief `notes` value if URL canonicalization required redirect or inference.

#### Dev.events iframe fallback (required)

If a dev.events detail page does not expose an explicit outbound "Visit site"/"Official site" link:

1. Inspect the page DOM for an embedded event website iframe such as:

```html
<iframe title="embedded event's website" src="https://example.com"></iframe>
```

2. Extract the iframe `src` URL and treat it as the candidate native origin URL.
3. Normalize to an absolute `https://` canonical URL (remove tracking query params when safe and deterministic).
4. Crawl that native URL and extract event data from the native site.
5. Set `event_url` to that native iframe-origin URL (never the dev.events detail URL).
6. Add a `notes` entry like `Canonical URL extracted from dev.events embedded iframe src.`
7. If iframe `src` is missing, malformed, non-https, or cannot be fetched, write an issue record with stage `canonicalize` or `fetch` and include deterministic failure notes.

#### Dev.events canonicalization order (required)

Apply these methods in order and stop on first valid canonical URL:

1. Direct HTTP redirect target from dev.events detail URL.
2. Explicit outbound event link in detail content (`Visit website`, `Official site`, `conference website`).
3. Embedded iframe `src` extracted from rendered DOM.
4. Raw HTML source scan for iframe `src` when rendered extraction misses iframe nodes.
5. If none succeed, write an issue (`missing_canonical_url`) and do not create candidate/update.

#### Dev.events DOM fallback protocol (required)

When using iframe fallback, enforce all of the following:

- Extract iframe `src` from rendered DOM first; if unavailable, inspect raw page HTML and parse iframe tags directly.
- Accept only absolute `https://` URLs.
- Reject iframe `src` values that are:
   - `javascript:`, `data:`, empty, or malformed,
   - `dev.events` self-links,
   - obvious non-event/tracker/ad/CDN assets.
- Canonicalize deterministically:
   - keep event path when required (do not collapse path-scoped event pages to origin-only),
   - remove only clear tracking query parameters when safe.
- Record provenance in `notes` using a deterministic phrase such as:
   - `Canonical URL extracted via redirect.`
   - `Canonical URL extracted via explicit outbound link.`
   - `Canonical URL extracted from dev.events embedded iframe src (raw HTML fallback).`
- If iframe-derived URL cannot be fetched/parsed, do not fall back to dev.events detail URL; write an issue record instead.

### Time windows (dual-window rule)

- Use today as day 0.
- Event window: collect events with `start_date` between today and today + 56 days (inclusive).
- CFP window: collect records where `cfp.has_cfp = true` and `cfp.cfp_close_date` is between today and today + 56 days (inclusive), even when `start_date` is outside the event window.
- Include a record when **either** condition matches:
   - `start_date` in event window, or
   - `cfp.cfp_close_date` in CFP window.
- If event pages require pagination, load-more, month navigation, or per-event detail pages, follow those paths to gather complete data for both windows.

### CFP extraction and follow-through (required)

Treat the following as equivalent CFP signals:

- `CFP` (Call for Papers)
- `CFS` (Call for Speakers)
- `CFP/CFS` mixed labels
- `Call for Proposals`, `Call for Participation`, `Speaker Applications`
- CTAs such as `Apply to speak`, `Submit talk`, `Propose a talk`, `Speak at ...`, `Become a speaker`

When a source provides any CFP/CFS link, CTA, or indicator:

1. Follow the CFP URL to the actual CFP page/form (do not stop at listing-page snippets).
2. Extract `cfp.cfp_url` and `cfp.cfp_close_date` when available.
3. If a CFP deadline includes time/timezone, normalize date to `YYYY-MM-DD` and store timezone in `cfp.cfp_timezone` when determinable.
4. Set `cfp.cfp_status` deterministically from extracted data (`upcoming|open|closing_soon|closed|unknown`).
5. If a CFP exists but close date cannot be determined, keep `cfp.has_cfp = true`, set `cfp.cfp_close_date = null`, `cfp.cfp_status = "unknown"`, and add deterministic notes.
6. Do not infer CFP close dates from event date; only use explicit CFP-page evidence.
7. Prefer canonical submission destinations (for example PaperCall/Sessionize/ConfEngine/Google Forms) over aggregator snippets when extracting close deadlines.

### Relevance criteria

Include events likely related to one or more of:

- Puppet
- Infrastructure as Code
- AI (in infra/platform/devops context)
- DevOps
- SRE / Site Reliability
- Linux / operating systems
- System administration
- Network automation

Also include general software/developer events **only if** they are broad and likely relevant to DevOps practitioners (not narrowly focused on a single language/framework/stack where our ICP is unlikely to attend).

#### Explicit topical exclusions (required)

Exclude events when their primary focus is outside infrastructure automation / platform engineering / DevOps operations, including:

- Database-focused conferences (for example MySQL/PostgreSQL/MongoDB/data platform ecosystems), even if open source.
- Open-source-only community events where the main scope is not infrastructure automation or DevOps practice.
- Data/analytics events without clear DevOps/SRE/IaC operational relevance.

If an event appears adjacent but not clearly aligned, default to exclude and count it under `topic mismatch` in the summary report.

### Geographic filtering

- Exclude events in China.
- Exclude all events in Africa.
- Exclude events in Middle East countries (for example: Saudi Arabia, Iraq, Iran, Israel, etc.).
- Exclude events in Romania.
- Exclude events in Mexico.
- Exclude events in all Central American countries (Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, Panama).
- Exclude events in all South American countries (Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador, Guyana, Paraguay, Peru, Suriname, Uruguay, Venezuela).
- Prioritize events in: United States, Canada, Australia, Ireland, Japan, United Kingdom, and mainland Europe.

### Data model and normalization

- Conform records to the `EventRecord` shape documented in `docs/data-model.md`.
- Use absolute `https://` URLs.
- Ensure `event_url` is the canonical/native event-host URL.
- Normalize dates to `YYYY-MM-DD`.
- Ensure `end_date >= start_date`.
- For online-only events, set `delivery: "online"`, `location.is_online: true`, `location.city: null`, `location.country: "Online"`, `location.country_code: "XX"` when applicable.

#### Cost extraction (required)

When extracting event data from event pages, also extract and normalize cost information:

- Look for pricing/ticket information on event landing pages, registration pages, or linked ticketing pages.
- Set `cost.is_free = true` if the event explicitly states it is free to attend.
- If paid, extract the **lowest ticket price available** (e.g., earliest bird discount, base tier, or standard admission):
  - Set `cost.lowest_price` to the numeric price (integer or decimal).
  - Set `cost.price_currency` to the ISO 4217 code (example: `USD`, `EUR`, `GBP`). Default to `USD` if currency not explicitly stated and context suggests US pricing.
  - Determine `cost.cost_level` based on lowest price:
    - `budget`: lowest ticket < $100 (or regional equivalent)
    - `standard`: lowest ticket $100–$500
    - `premium`: lowest ticket ≥ $500
  - Optionally include `cost.notes` if relevant (example: "Early bird pricing expired", "Requires corporate sponsorship").
- If pricing information is unavailable or unclear after checking the event page and any linked ticketing site:
  - Set `cost.is_free = true`, `cost.lowest_price = null`, `cost.cost_level = "free"`.
  - Omit `cost.price_currency`.
  - Add a note in `cost.notes` explaining why pricing could not be determined (example: "Pricing not published yet; assumed free until confirmed").
- If event page explicitly states pricing will be announced later:
  - Set `cost.is_free = true`, `cost.lowest_price = null`, `cost.cost_level = "free"`.
  - Add `cost.notes`: "Pricing to be announced; assumed free until confirmed."
- **Rationale**: Unknown-price events must not be excluded by free-event filters. Assume free until a confirmed price is found.

### Reconciliation rules against `data/events.json`

1. Load existing records from `data/events.json` (`records` array).
2. Match potential duplicates using strongest available keys in this order:
   - exact `event_url`
   - exact `id`
   - normalized `name` + `start_date` + `country`
3. For matches:
   - If there are field differences, classify as **update candidates** and include a field-level diff summary.
   - If there are no differences, skip.
4. For non-matches:
   - Classify as **new candidates**.

#### Cost backfill for existing records (required)

When reconciling matched existing records, treat a missing or absent `cost` field as a field difference that requires an update:

1. For every existing record that falls within the event window or CFP window **and** does not already have a `cost` object, visit the record's `event_url` (and any linked registration/ticketing page) to extract cost information.
2. If cost data is successfully extracted, emit an update candidate with `cost` as the changed field (`old: null`, `new: <extracted cost object>`).
3. If the event page cannot be reached or pricing is indeterminate, emit an update with `cost.is_free = true`, `cost.lowest_price = null`, `cost.cost_level = "free"`, and `cost.notes` explaining why (e.g., "Pricing not published yet; assumed free until confirmed" or "Event page returned HTTP 404; assumed free until confirmed").
4. Do not skip existing records solely because their non-cost fields are unchanged — a missing `cost` field alone is sufficient reason to generate an update candidate.
5. Prioritize in-window records first, then CFP-window-only records, to maximize coverage within token/time budgets.

### Output requirements

Produce six outputs:

1. **Summary report** in markdown with:
   - Sources visited
   - Date window used
   - Counts: scanned, relevant, skipped, duplicates, updates, new candidates, issues
   - CFP-specific counts: cfp_seen, cfp_with_deadline, cfp_in_window, cfp_only_inclusions (event out-of-window but CFP in-window)
   - Exclusion reasons counts (geo excluded, topic mismatch, out of range, insufficient data, crawl/parse failure)

2. **Update candidates JSON file** at `data/events-updates.json` (do not automatically modify `data/events.json` unless explicitly asked):
    - Write only matched existing records that have differences.
      - For each update entry, include only:
         - the key used to match the existing record,
         - the event name,
         - field-level changed data (`old` vs `new`).
      - Field additions count as differences: when a field (e.g., `cost`) is absent on the existing record but extracted from the source, use `"old": null` and `"new": <extracted value>`.
    - Use this exact file shape:

```json
{
   "generated_at": "<ISO-8601 UTC timestamp>",
   "window_days": 56,
   "source_run_date": "<YYYY-MM-DD>",
   "records": [
      {
         "match": {
            "key_type": "<event_url|id|name+start_date+country>",
            "key_value": "<exact value used for matching>"
         },
         "name": "<event name>",
         "changes": {
            "<field_path>": {
               "old": "<old value>",
               "new": "<new value>"
            }
         }
      }
   ]
}
```

3. **Update candidates list in markdown**:
    - Summarize each changed event briefly and reference entries written to `data/events-updates.json`.

4. **New candidates JSON file** at `data/events-candidates.json`:
   - Write only net-new records (not duplicates, not unchanged matches).
   - Use this exact file shape:

```json
{
  "generated_at": "<ISO-8601 UTC timestamp>",
  "window_days": 56,
  "source_run_date": "<YYYY-MM-DD>",
  "records": []
}
```

Where `records` contains normalized `EventRecord` items.

5. **Issues JSON file** at `data/events-issues.json`:
    - Write every item attempted but not fully extracted/reconciled.
    - Include discovery failures, canonical URL resolution failures, fetch failures, parse failures, blocked/captcha/timeout cases.
    - Use this exact file shape:

```json
{
   "generated_at": "<ISO-8601 UTC timestamp>",
   "window_days": 56,
   "source_run_date": "<YYYY-MM-DD>",
   "records": [
      {
         "source": "<source domain>",
         "discovered_name": "<best-known event title or null>",
         "discovered_url": "<URL where item was discovered>",
         "attempted_url": "<URL attempted for canonical extraction/fetch>",
         "stage": "<discover|canonicalize|fetch|parse|normalize|reconcile>",
         "reason": "<missing_canonical_url|http_error|timeout|blocked|captcha|parse_error|ambiguous_date|ambiguous_location|other>",
         "http_status": "<number or null>",
         "in_window": "<true|false|null>",
         "notes": "<brief deterministic detail>"
      }
   ]
}
```

6. **Prioritized CFP candidates JSON file** at `data/cfp-candidates.json`:
   - Build from CFP tracker reconciliation results for records in the 56-day CFP window that are missing from both:
      - `data/events.json`
      - `data/events-candidates.json`
   - Scope this file to the prioritized DevOps-relevant subset using this include filter across name/event_url/cfp_url (case-insensitive):
      - `devops|sreday|o11y|observability|cloud native|kcd|kubernetes|platform|llmday|apidays`
   - Sort by `cfp_close_date` ascending, then `name` ascending.
   - Add `rank` starting at 1.
   - Add `days_until_cfp_close` based on run date.
   - Add `priority_tier`:
      - `p0_urgent` for `days_until_cfp_close <= 14`
      - `p1_high` for `days_until_cfp_close <= 28`
      - `p2_medium` otherwise
   - Use this exact file shape:

```json
{
  "generated_at": "<ISO-8601 timestamp>",
  "source_report": "data/adatosystems-cfp-validation-<YYYY-MM-DD>.json",
  "window_start": "<YYYY-MM-DD>",
  "window_end": "<YYYY-MM-DD>",
  "prioritization": "Sorted by cfp_close_date asc, then name; tiers by days until close (<=14 p0, <=28 p1, else p2).",
  "total_candidates": 0,
  "candidates": []
}
```

### Quality checks before finalizing

- Ensure every included event has a valid `name`, `event_url`, `start_date`, `end_date`, `delivery`, and `location`.
- Ensure every included record satisfies at least one inclusion condition:
   - `start_date` in the 56-day event window, or
   - `cfp.has_cfp = true` and `cfp.cfp_close_date` in the 56-day CFP window.
- Ensure excluded geographies are not present.
- Ensure dev.events-discovered records do not use dev.events detail URLs for `event_url`.
- Ensure CFP links were followed-through when present and that `cfp.cfp_close_date` is captured when explicitly available on the CFP page.
- Ensure CFP/CFS synonym labels are treated equivalently during discovery and extraction.
- Ensure database-focused and open-source-only (non-DevOps-operations) events are excluded.
- Ensure `data/events-updates.json` is valid JSON.
- Ensure each `data/events-updates.json` record contains only `match`, `name`, and `changes`.
- Ensure `data/events-candidates.json` is valid JSON.
- Ensure `data/events-issues.json` is valid JSON.
- Ensure `data/cfp-candidates.json` is valid JSON.
- Ensure every failed attempt is represented in `data/events-issues.json`.
- Ensure no unchanged existing records appear in `data/events-updates.json`.
- Ensure no unchanged existing records appear in candidates.
- Ensure no dev.events detail URL is used as final `event_url` when canonicalization fails.
- Ensure each dev.events-derived record has deterministic canonicalization provenance in `notes`.
- Ensure `data/cfp-candidates.json` is ordered by `cfp_close_date` then `name`, with deterministic `rank`, `days_until_cfp_close`, and `priority_tier`.

### Execution constraints

- Be deterministic and explicit about assumptions.
- If date or location is ambiguous, add a brief `notes` value explaining inference.
- Prefer canonical event pages over aggregator snippets when both are available.

### Source-specific fallback: iacconf.com (required)

If `https://www.iacconf.com/events` fails in the primary extractor (for example CSP or parser failure), do **not** stop at that failure.

Use this fallback sequence:

1. Fetch raw HTML with a standard browser-like user agent.
2. Extract event metadata from embedded Next.js payload (`__NEXT_DATA__`) or equivalent inline JSON state.
3. From extracted event objects, collect `title`, `date`, and canonical event link fields.
4. For in-window events, crawl the linked canonical event page (for example Luma) to confirm date/location/delivery.
5. Only then create candidates/updates. If no in-window events are found after fallback, do not create an issue.
6. Create an issue only if both primary extraction and fallback extraction fail, with deterministic notes indicating both attempts.

### Source-specific fallback: redhat.com events (required)

If `https://www.redhat.com/en/events` is redirected by the extractor to tracking endpoints (for example DoubleClick), treat this as an extractor-path artifact, not an immediate source failure.

Use this fallback sequence:

1. Fetch events listing pages directly with pagination:
   - `https://www.redhat.com/en/events` (page 0 equivalent)
   - `https://www.redhat.com/en/events?page=1`
   - `https://www.redhat.com/en/events?page=2`
2. Parse embedded page settings and use the configured JSON listing endpoint when present:
   - `https://www.redhat.com/rhdc/jsonapi/solr_search/event`
3. Paginate the JSON endpoint with `?page=0..N` until `docs` is empty.
4. For each doc, extract canonical event URL (`url`), `title`, `start_date`, `end_date`, and delivery signal (`event_type`/`online_event_type`).
5. Filter by the 56-day window and relevance/geo rules before reconciliation.
6. Only create a Red Hat issue if both listing-page fallback and JSON-endpoint fallback fail.
7. When fallback succeeds, do not keep a stale Red Hat blocked issue.

### Source-specific fallback: adatosystems.com CFP tracker (required)

If `https://adatosystems.com/cfp-tracker/` is compressed/ambiguous or fails deterministic parsing, use the dated weekly CFP sublist post for the run date.

Use this fallback sequence:

1. Fetch the dated post in this form:
   - `https://adatosystems.com/YYYY/MM/DD/call-for-papers-listings-for-M-D/`
2. Extract bullet records containing:
   - event name,
   - city/country,
   - event date range,
   - `CFP close` date,
   - event URL,
   - CFP URL.
3. Use the dated sublist as discovery input only; validate/canonicalize URLs where possible.
4. Keep `adatosystems.com/cfp-tracker` as an issue if still non-deterministic, but continue the run using the dated sublist results.
5. Include deterministic notes when a candidate was sourced from the dated fallback post.

### Local CFP tracker snapshot and conversion (required)

For repeatable weekly runs, always create and use a local HTML snapshot before CFP reconciliation.

1. Download the tracker page to the `data/` folder with run-date naming:
   - `data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html`
2. Preferred command (raw HTML):

```powershell
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html"
```

3. If the table is not fully present in raw HTML, use browser-rendered fallback and save:
   - `data/adatosystems-cfp-tracker-<YYYY-MM-DD>-rendered.html`

```powershell
node -e "const { chromium } = require('playwright'); (async()=>{ const b=await chromium.launch({headless:true}); const p=await b.newPage(); await p.goto('https://adatosystems.com/cfp-tracker/', {waitUntil:'networkidle'}); const fs=require('fs'); fs.writeFileSync('data/adatosystems-cfp-tracker-<YYYY-MM-DD>-rendered.html', await p.content(), 'utf8'); await b.close(); })();"
```

4. Run the automated parse-and-reconcile script:

```powershell
node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>
```

   This script performs steps 4–9 below automatically:
   - Parses the HTML table (`Event Name`, `City`, `Country`, `Event Start`, `Event End`, `CFP Close`, `Event URL`, `CFP URL`). Note: the table uses `class="tablesorter"` and links use uppercase `<A HREF=` tags.
   - Filters CFP rows to the 56-day CFP window.
   - Reconciles against `data/events.json` and `data/events-candidates.json` using URL-first matching (`event_url`, then `cfp_url`), with name-only fallback.
   - Writes validation report to `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json`.
   - Generates `data/cfp-candidates.json` from the `missing` array using the DevOps-relevance keyword filter and prioritization rules in Output #6.

5. If the script is unavailable, perform these steps manually:
   - Parse the local HTML table and convert to JSON rows.
   - Filter CFP rows to the 56-day CFP window (`today` to `today+56`, inclusive).
   - Reconcile filtered rows against both `data/events.json` and `data/events-candidates.json` using URL-first matching (`event_url`, then `cfp_url`), with optional name-only indicator.
   - Write validation report to `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json`.
   - Validation report must include: `window_start`, `window_end`, totals (`considered_rows`, `covered_by_url`, `name_match_only`, `missing`), arrays (`missing`, `name_match_only`).
   - Generate `data/cfp-candidates.json` from the `missing` array using the prioritization rules in Output #6.

### Run notes for next execution (2026-02-27)

- Do **not** use `dev.events` `.ics` links for extraction; these may trigger file downloads and are not reliable in this environment.
- For `dev.events`, canonicalization should use only:
   1) direct HTTP redirects from the detail page URL, or
   2) explicit outbound links in detail-page content (for example, `Visit conference website`), or
   3) embedded iframe `src` origin URL when the detail page renders an embedded event website.
- If a `dev.events` detail page exposes no outbound native URL beyond ads/promotions, log `missing_canonical_url` in `data/events-issues.json`.
- For iframe-based extraction, treat the iframe `src` as canonical only when it is a clear event-host origin; otherwise log an issue with exact reason in `notes`.
- If standard extractor output omits iframe nodes, parse raw HTML source and extract iframe `src` directly.
- For `devopsdays` event pages, prefer `/welcome/` URLs for canonical `event_url`; extract date/location from `/welcome/` when available.
- If a source is blocked by CSP or anti-bot redirects (for example, `redhat.com` events page), record a deterministic issue and continue with alternate source coverage.
- For `iacconf.com`, treat extractor-level CSP/parse failure as recoverable: retry via raw HTML + `__NEXT_DATA__` parsing before logging an issue.
- For `redhat.com/events`, prefer JSON fallback at `https://www.redhat.com/rhdc/jsonapi/solr_search/event?page=<n>` to avoid tracker-bounce false failures.
- Treat CFP discovery as first-class: include records where CFP close date is in-window even if the event itself is later than 56 days.
- For CFP CTAs (for example IaCConf `View the Call for Presenters`), follow through to the CFP destination page/form to extract the actual close deadline before classifying in/out of window.
- If the AdatoSystems main CFP tracker is unreliable, use the dated sublist post for that run day and record this fallback in `notes`/issues.

Now execute this workflow and provide:
1) the markdown summary,
2) the created/updated `data/events-updates.json`,
3) a concise markdown list of updates,
4) the created/updated `data/events-candidates.json`,
5) the created/updated `data/events-issues.json`,
6) the created/updated `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json`,
7) the created/updated `data/cfp-candidates.json`.
