# Events Source Analysis Prompt Template (Agent Window)

Use this prompt in the agent window to discover upcoming events and reconcile them against our canonical data store.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

Your mission is to discover **upcoming events in the next 56 days** from the following sources, then reconcile those findings with `data/events.json`.

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

### Time window

- Use today as day 0.
- Collect events with `start_date` between today and today + 56 days (inclusive).
- If event pages require pagination, load-more, month navigation, or per-event detail pages, follow those paths to gather complete data in that window.

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

### Geographic filtering

- Exclude events in China.
- Exclude all events in Africa.
- Exclude events in Middle East countries (for example: Saudi Arabia, Iraq, Iran, Israel, etc.).
- Prioritize events in: United States, Canada, Australia, Ireland, Japan, United Kingdom, and mainland Europe.

### Data model and normalization

- Conform records to the `EventRecord` shape documented in `docs/data-model.md`.
- Use absolute `https://` URLs.
- Ensure `event_url` is the canonical/native event-host URL.
- Normalize dates to `YYYY-MM-DD`.
- Ensure `end_date >= start_date`.
- For online-only events, set `delivery: "online"`, `location.is_online: true`, `location.city: null`, `location.country: "Online"`, `location.country_code: "XX"` when applicable.

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

### Output requirements

Produce five outputs:

1. **Summary report** in markdown with:
   - Sources visited
   - Date window used
   - Counts: scanned, relevant, skipped, duplicates, updates, new candidates, issues
   - Exclusion reasons counts (geo excluded, topic mismatch, out of range, insufficient data, crawl/parse failure)

2. **Update candidates JSON file** at `data/events-updates.json` (do not automatically modify `data/events.json` unless explicitly asked):
    - Write only matched existing records that have differences.
      - For each update entry, include only:
         - the key used to match the existing record,
         - the event name,
         - field-level changed data (`old` vs `new`).
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

### Quality checks before finalizing

- Ensure every included event has a valid `name`, `event_url`, `start_date`, `end_date`, `delivery`, and `location`.
- Ensure every event falls in the 56-day window.
- Ensure excluded geographies are not present.
- Ensure dev.events-discovered records do not use dev.events detail URLs for `event_url`.
- Ensure `data/events-updates.json` is valid JSON.
- Ensure each `data/events-updates.json` record contains only `match`, `name`, and `changes`.
- Ensure `data/events-candidates.json` is valid JSON.
- Ensure `data/events-issues.json` is valid JSON.
- Ensure every failed attempt is represented in `data/events-issues.json`.
- Ensure no unchanged existing records appear in `data/events-updates.json`.
- Ensure no unchanged existing records appear in candidates.
- Ensure no dev.events detail URL is used as final `event_url` when canonicalization fails.
- Ensure each dev.events-derived record has deterministic canonicalization provenance in `notes`.

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

Now execute this workflow and provide:
1) the markdown summary,
2) the created/updated `data/events-updates.json`,
3) a concise markdown list of updates,
4) the created/updated `data/events-candidates.json`,
5) the created/updated `data/events-issues.json`.
