# Events Source Analysis Prompt Template (Agent Window)

Use this prompt in the agent window to discover upcoming events and reconcile against `data/events.json`.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

### Mission

Discover and reconcile:

1. Events with `start_date` in next **180 days**.
2. CFPs with `cfp.cfp_close_date` in next **56 days** (even if event date is outside 180 days).

### Execution phases (required)

Follow these phases in order. Do not skip phases or reorder them.

#### Phase 1 — Programmatic extraction (scripted, deterministic)

Run local scripts to gather raw discovery data. Do not attempt manual web crawling for sources that have scripts.

1. **dev.events extraction:**

```powershell
node scripts/fetch-dev-events.mjs <YYYY-MM-DD>
```

   - Produces `data/dev-events-<YYYY-MM-DD>.json` with all events in the 180-day window.
   - Expect 1,000+ events. If the script returns fewer than 500, treat the run as incomplete and log to `data/events-issues.json`.
   - This replaces all manual dev.events browsing. Do not crawl dev.events index pages directly.

2. **CFP tracker extraction:**

```powershell
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html"
node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>
```

   - Produces `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json` and `data/cfp-candidates.json`.

#### Phase 2 — Agent-led filtering (agent judgment)

Read the `data/dev-events-<YYYY-MM-DD>.json` file and apply both **relevance filtering** and **geographic filtering** (see criteria in sections below) to reduce the full list to a shortlist of relevant events.

For each record in the dev.events extraction, evaluate:

1. **Topic relevance** — Does the `topic` field and/or `name` match the relevance criteria? The `topic` field from dev.events is coarse (e.g., `SRE`, `DevOps`, `Tech`, `IT`), so also consider the event name for signals.
2. **Geographic eligibility** — Is `location.country` in an excluded geography?
3. **Already tracked** — Does the event already exist in `data/events.json` (match by `name + start_date + country`)?

Output a filtered shortlist of net-new, relevant, geographically eligible events. Record filtering counts:
- `total_extracted`: count from the dev.events JSON
- `excluded_geography`: count removed by geo filter
- `excluded_relevance`: count removed by topic filter
- `already_tracked`: count matched to existing events.json
- `shortlisted`: count remaining for enrichment

#### Phase 3 — Agent-led enrichment (for shortlisted events only)

For each shortlisted dev.events event, plus events discovered from other agent-crawled sources:

1. **Canonicalize the event URL** — dev.events detail URLs are never canonical. Resolve using this priority:
   a. Fetch the dev.events detail page and follow the HTTP redirect target.
   b. Find an explicit outbound link (`Visit website`, `Official site`, `conference website`).
   c. Parse embedded iframe `src` from raw HTML.
   d. If none succeed: write issue `missing_canonical_url` and do not create candidate.

2. **Extract CFP information** — Visit the canonical event page and look for CFP/CFS links. Follow the CFP extraction rules below.

3. **Extract cost/pricing** — Follow the cost extraction rules below.

4. **Set delivery type** — Determine `in_person`, `online`, or `hybrid` from event page content.

5. **Normalize to EventRecord** — Shape the data per `docs/data-model.md`.

Canonical URL rules:
- Never use a dev.events detail URL as final `event_url`.
- Accept only absolute `https://` URLs.
- Reject iframe `src` values that are `javascript:`, `data:`, empty/malformed, dev.events self-links, or non-event assets.
- Canonicalize deterministically (remove only clear tracking params).
- Record provenance in `notes` using deterministic phrases:
  - `Canonical URL extracted via redirect.`
  - `Canonical URL extracted via explicit outbound link.`
  - `Canonical URL extracted from dev.events embedded iframe src (raw HTML fallback).`

#### Phase 4 — Agent-crawled supplemental sources

Crawl these sources directly for additional events not covered by dev.events:

- https://devopsdays.org/events
- https://www.usenix.org/conference/srecon
- https://sreday.com/
- https://www.iacconf.com/events
- https://www.redhat.com/en/events
- https://www.carahsoft.com/red-hat/events
- https://cfgmgmtcamp.org/
- https://www.developerweek.com/

Apply the same relevance, geographic, and inclusion filters. Reconcile against both `data/events.json` and the dev.events shortlist to avoid duplicates.

#### Phase 5 — Reconciliation (scripted)

After enrichment is complete, run the reconciliation script with the combined enriched candidates:

```powershell
python scripts/reconcile-events.py --run-date <YYYY-MM-DD> --input-file <enriched-candidates-file>
```

   - Produces `data/events-candidates.json` and `data/events-updates.json`.

#### Phase 6 — Cost refresh on canonical events (agentic, required)

Run an explicit cost-verification pass against `data/events.json` for records where cost is missing or currently marked free.

For each targeted existing event:
1. Visit canonical event URL and follow registration/ticket links.
2. Capture event-level evidence (source URL, wording, ticket provider, and check timestamp).
3. If explicit free wording exists, set free with evidence-backed notes.
4. If explicit paid pricing exists, set paid values with lowest public ticket and currency.
5. If ticketing exists but price is not visible, keep unresolved semantics in notes and confidence (do not fabricate paid/free amounts).
6. Write only reviewed, event-level cost changes into `data/events-updates.json` with `target.dataset = "events"`.

#### Guardrails

- Do not overwrite `data/events-candidates.json` with empty `records` unless all phases completed successfully and truly found zero net-new records.
- If any phase is incomplete or blocked, write deterministic issues to `data/events-issues.json` and explicitly mark run status as incomplete in the summary.

### Inclusion rules

Include a record if either is true:

- `start_date` in [today, today+180], or
- `cfp.has_cfp = true` and `cfp.cfp_close_date` in [today, today+56].

The dev.events extraction script handles date-window pagination automatically. For other agent-crawled sources, follow pagination/load-more/month navigation/detail pages as needed.

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
- Automotive/embedded system-specific events (automotive grade linux, in-vehicle systems).
- Open-source-only events without infra/devops operations focus.
- Data/analytics events without clear DevOps/SRE/IaC relevance.
- Sustainability-focused conference brands/events (including Greenio / greenio.tech).

### Geographic filtering

Exclude: China, all Africa, Middle East countries, Romania, Mexico, Croatia, Lithuania, Greece, Czech Republic, all Central America, all South America.

Prioritize: US, Canada, Australia, Ireland, Japan, UK, mainland Europe.

### Data normalization

- Conform to `EventRecord` in `docs/data-model.md`.
- Use absolute `https://` URLs.
- `end_date >= start_date`.
- Normalize dates to `YYYY-MM-DD`.
- Online-only events: `delivery="online"`, `location.is_online=true`, `location.city=null`, `location.country="Online"`, `location.country_code="XX"`.

### Cost extraction

- Extract pricing from event/registration/ticket pages with event-level evidence.
- If explicitly free: `cost.is_free=true`.
- If paid: extract lowest available ticket and set:
  - `cost.lowest_price`
  - `cost.price_currency` (ISO 4217)
  - `cost.cost_level` (`budget` <100, `standard` 100-500, `premium` >=500)
- Always capture evidence in notes (pricing URL checked, date checked, and result).
- If pricing unavailable/unclear after research, use
   - `is_free=true`, `lowest_price=null`, `cost_level="free"`
   - omit `price_currency`
   - add deterministic `cost.notes` stating pricing pages were checked but no explicit pricing was published.
- Never use mass fallback pricing assumptions without event-level checks.

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

Cost update rule:

- For existing records missing `cost`, emit updates only when event-level pricing research was performed and evidence is captured.

### Required outputs

Produce these outputs:

1. Markdown summary (in response text, not extra data markdown files).
2. `data/events-updates.json` with shape:
   - top-level: `generated_at`, `window_days`, `source_run_date`, `records`
   - each record: `match`, `name`, `changes`
   - for cost changes, include `evidence` with pricing source URL(s), `checked_at`, method, and confidence
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
- Exclude filter (case-insensitive across name/event_url/cfp_url):
   - `greenio|green-io|sustainability|sustainable`
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
- Explicit overlap audit included in summary for `events-candidates.json`:
   - overlap by normalized `event_url`
   - overlap by normalized `name + start_date + country`
- Per-source summary counts included: `discovered`, `filtered`, `matched`, `new`, `failed`.
- Summary includes dedicated dev.events counts from Phase 2 filtering: `total_extracted`, `excluded_geography`, `excluded_relevance`, `already_tracked`, `shortlisted`.
- dev.events extraction returning fewer than 500 events is treated as incomplete and logged in `data/events-issues.json`.

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

### Local script reference

#### dev.events extraction

```powershell
node scripts/fetch-dev-events.mjs <YYYY-MM-DD>
```

- Output: `data/dev-events-<YYYY-MM-DD>.json`
- Paginates through all dev.events results for the 180-day window.
- Extracts: `name`, `start_date`, `end_date`, `topic`, `location` (city/country/continent/is_online), `dev_events_url`.
- Optional: `--window-days N` to override the default 180-day window.

#### CFP tracker snapshot

```powershell
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<YYYY-MM-DD>.html"
node scripts/parse-cfp-tracker.mjs <YYYY-MM-DD>
```

- Output: `data/adatosystems-cfp-validation-<YYYY-MM-DD>.json` and `data/cfp-candidates.json`.
- If download is unavailable, perform manual parse/reconcile with identical output shapes and ordering.

#### Event reconciliation

```powershell
python scripts/reconcile-events.py --run-date <YYYY-MM-DD> --input-file <candidates-file>
```

- Output: `data/events-candidates.json` and `data/events-updates.json`.
- Handles match priority (event_url → id → name+date+country) and window filtering.
- Cost determination is not generated automatically by the script and must come from agent-led pricing research.
