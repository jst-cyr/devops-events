# Events Source Analysis Prompt Template (Agent Window)

Use this prompt in the agent window to discover upcoming events and reconcile against `data/events.json`.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

### Mission

Discover and reconcile:

1. Events with `start_date` in next **180 days**.
2. CFPs with `cfp.cfp_close_date` in next **56 days** (even if event date is outside 180 days).

### Execution precedence (required)

- Primary flow is agent-led web discovery from all listed sources.
- Do not start from prebuilt local discovery seed files.
- Treat `dev.events` as the broad discovery source and fully process in-window index results.
- Use local scripts only as post-discovery helpers (for example CFP parsing/reconciliation), never as event discovery replacements.
- Do not overwrite `data/events-candidates.json` with empty `records` unless discovery completed successfully and truly found zero net-new records.
- If discovery is incomplete/blocked, write deterministic issues and explicitly mark run status as incomplete in summary.

### Sources to analyze

- https://dev.events/ (discovery/index only; dev.events detail URLs are never canonical event URLs)
- https://adatosystems.com/cfp-tracker/
- https://devopsdays.org/events
- https://www.usenix.org/conference/srecon
- https://sreday.com/
- https://www.iacconf.com/events
- https://www.redhat.com/en/events
- https://www.carahsoft.com/red-hat/events
- https://cfgmgmtcamp.org/
- https://www.developerweek.com/

### Dev.events canonicalization (required)

For each dev.events discovery item, set canonical `event_url` using this order:

1. Direct HTTP redirect target from dev.events detail URL.
2. Explicit outbound link in detail content (`Visit website`, `Official site`, `conference website`).
3. Embedded iframe `src` from rendered DOM.
4. Raw HTML fallback: parse iframe `src` directly when rendered DOM misses it.
5. If none succeed: write issue `missing_canonical_url` and do not create candidate/update.

Rules:

- Never use dev.events detail URL as final `event_url`.
- Accept only absolute `https://` canonical URLs.
- Reject iframe `src` values that are `javascript:`, `data:`, empty/malformed, dev.events self-links, or obvious non-event assets.
- Canonicalize deterministically (remove only clear tracking params).
- Record provenance in `notes` using deterministic phrases:
  - `Canonical URL extracted via redirect.`
  - `Canonical URL extracted via explicit outbound link.`
  - `Canonical URL extracted from dev.events embedded iframe src (raw HTML fallback).`

### Inclusion rules

Include a record if either is true:

- `start_date` in [today, today+180], or
- `cfp.has_cfp = true` and `cfp.cfp_close_date` in [today, today+56].

Follow pagination/load-more/month navigation/detail pages as needed.

### CFP extraction rules

Treat all of these as CFP equivalents: `CFP`, `CFS`, `CFP/CFS`, `Call for Proposals`, `Call for Participation`, `Speaker Applications`, `Apply to speak`, `Submit talk`, `Propose a talk`, `Become a speaker`.

When CFP exists:

1. Follow to actual CFP destination page/form.
2. Extract `cfp.cfp_url`, `cfp.cfp_close_date`, and `cfp.cfp_timezone` (if available).
3. Normalize date to `YYYY-MM-DD`.
4. Set deterministic `cfp.cfp_status` (`upcoming|open|closing_soon|closed|unknown`).
5. If close date cannot be determined: `has_cfp=true`, `cfp_close_date=null`, `cfp_status="unknown"`, add deterministic notes.
6. Never infer CFP close date from event date.

### Relevance and exclusion

Include events relevant to: Puppet, IaC, AI in infra/devops context, DevOps, SRE, Linux/OS, sysadmin, network automation.

Include broad developer events only if likely relevant to DevOps practitioners.

Exclude:

- Database-centric events (MySQL/PostgreSQL/MongoDB/data platform ecosystems).
- Open-source-only events without infra/devops operations focus.
- Data/analytics events without clear DevOps/SRE/IaC relevance.

### Geographic filtering

Exclude: China, all Africa, Middle East countries, Romania, Mexico, all Central America, all South America.

Prioritize: US, Canada, Australia, Ireland, Japan, UK, mainland Europe.

### Data normalization

- Conform to `EventRecord` in `docs/data-model.md`.
- Use absolute `https://` URLs.
- `end_date >= start_date`.
- Normalize dates to `YYYY-MM-DD`.
- Online-only events: `delivery="online"`, `location.is_online=true`, `location.city=null`, `location.country="Online"`, `location.country_code="XX"`.

### Cost extraction

- Extract pricing from event/registration/ticket pages.
- If explicitly free: `cost.is_free=true`.
- If paid: extract lowest available ticket and set:
  - `cost.lowest_price`
  - `cost.price_currency` (ISO 4217)
  - `cost.cost_level` (`budget` <100, `standard` 100-500, `premium` >=500)
- If pricing unavailable/unclear: default to
  - `is_free=true`, `lowest_price=null`, `cost_level="free"`
  - omit `price_currency`
  - add deterministic `cost.notes` explaining assumption.

### Reconciliation against `data/events.json`

Match order:

1. exact `event_url`
2. exact `id`
3. normalized `name + start_date + country`

For matches:

- Include only changed records in updates.
- Field additions count as changes (`old: null`, `new: <value>`).

For non-matches:

- Add as new candidates.

Cost backfill rule:

- For in-window existing records missing `cost`, emit update even if all other fields unchanged.

### Required outputs

Produce these outputs:

1. Markdown summary (in response text, not extra data markdown files).
2. `data/events-updates.json` with shape:
   - top-level: `generated_at`, `window_days`, `source_run_date`, `records`
   - each record: `match`, `name`, `changes`
3. Concise markdown list of updates (in response text).
4. `data/events-candidates.json` with shape:
   - `generated_at`, `window_days`, `source_run_date`, `records`
5. `data/events-issues.json` with shape:
   - `generated_at`, `window_days`, `source_run_date`, `records`
   - each record: `source`, `discovered_name`, `discovered_url`, `attempted_url`, `stage`, `reason`, `http_status`, `in_window`, `notes`
6. `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json`
7. `data/cfp-candidates.json` with shape:
   - `generated_at`, `source_report`, `window_start`, `window_end`, `prioritization`, `total_candidates`, `candidates`

### CFP prioritization (`data/cfp-candidates.json`)

- Build from CFP tracker records in 56-day CFP window missing from both `data/events.json` and `data/events-candidates.json`.
- Include filter (case-insensitive across name/event_url/cfp_url):
  - `devops|sreday|o11y|observability|cloud native|kcd|kubernetes|platform|llmday|apidays`
- Sort: `cfp_close_date` asc, then `name` asc.
- Add:
  - `rank` (1..n)
  - `days_until_cfp_close`
  - `priority_tier` (`p0_urgent` <=14, `p1_high` <=28, else `p2_medium`)

### Quality checks (must pass)

- Included records have valid `name`, `event_url`, `start_date`, `end_date`, `delivery`, `location`.
- Included records satisfy inclusion rules (180-day event or 56-day CFP).
- Excluded geographies absent.
- No dev.events detail URL as final `event_url`.
- All failures represented in `data/events-issues.json`.
- No unchanged records in updates/candidates.
- Per-source summary counts included: `discovered`, `filtered`, `matched`, `new`, `failed`.
- Summary includes dedicated dev.events discovery count.
- Unexpectedly low dev.events discovery is treated as incomplete and logged in `data/events-issues.json`.

### Source-specific fallback rules

#### iacconf.com

If primary extraction fails:

1. Fetch raw HTML.
2. Parse embedded Next.js payload (`__NEXT_DATA__`) or equivalent inline JSON.
3. Extract `title`, `date`, canonical event link.
4. Crawl canonical event page for in-window records.
5. Issue only if both primary and fallback fail.

#### redhat.com/events

If extractor path redirects to trackers:

1. Fetch listing pages: `/en/events`, `?page=1`, `?page=2`.
2. Use JSON endpoint if present: `https://www.redhat.com/rhdc/jsonapi/solr_search/event`.
3. Paginate JSON until empty docs.
4. Extract `url`, `title`, `start_date`, `end_date`, delivery signals.
5. Filter/reconcile.
6. Issue only if both listing and JSON fallback fail.

#### adatosystems CFP tracker

If main tracker parsing is unreliable:

1. Use dated sublist post: `https://adatosystems.com/YYYY/MM/DD/call-for-papers-listings-for-M-D/`.
2. Extract event name, city/country, event dates, CFP close date, event URL, CFP URL.
3. Continue run using fallback results and record deterministic notes.

### Local CFP snapshot workflow

1. Download snapshot:

```powershell
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html"
```

2. Run parser:

```powershell
node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>
```

If unavailable, perform manual parse/reconcile with identical output shapes and ordering.
