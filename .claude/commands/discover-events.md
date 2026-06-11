---
description: Run the full 7-phase event discovery + reconciliation pipeline for a given run date.
argument-hint: [YYYY-MM-DD]  (defaults to today)
---

You are the orchestrator for the `devops-events` discovery pipeline.

**Run date:** `$1` — if empty, use today's date from session context. Call it `<DATE>` below.

Read [AGENTS.md](../../AGENTS.md) and
[docs/prompt-templates/events-source-analysis-agent-prompt.md](../../docs/prompt-templates/events-source-analysis-agent-prompt.md)
first — they are the authoritative spec for every phase. This command tells you *how to execute*
them with Claude Code primitives; the templates tell you *what each phase requires*. Do not skip
or reorder phases. Phases 2 and 5 are non-waivable agentic gates.

Track progress with a todo list (one item per phase).

## Phase 1 — Scripted extraction (deterministic)

Run in the terminal (PowerShell). Do not crawl these sources manually.

```powershell
node scripts/fetch-dev-events.mjs <DATE>
curl.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-<DATE>.html"
node scripts/parse-cfp-tracker.mjs <DATE>
node scripts/fetch-usnua-events.mjs <DATE>
```

If `fetch-dev-events.mjs` returns fewer than 500 records, treat the run as incomplete and log it
to `data/events-issues.json` (this is an error, not an out-of-scope determination).

## Phase 2 — Relevance + geographic filter (agent judgment, REQUIRED)

Read `data/dev-events-<DATE>.json`. Apply the inclusion/exclusion and geographic criteria from
AGENTS.md (Phase 2) and the prompt template. Produce a shortlist of net-new, relevant,
geographically eligible events, deduped against `data/events.json`. Record the filtering counts
(`total_extracted`, `excluded_geography`, `excluded_relevance`, `already_tracked`, `shortlisted`).

## Phase 3 — Enrichment (parallel subagents)

For the Phase-2 shortlist plus the USNUA and BSides events, **dispatch the `event-enricher`
subagent once per event, concurrently** (batch them — multiple Agent calls in one message).
Each enricher canonicalizes the URL and extracts CFP / cost / delivery / location for its one
event and returns a partial `EventRecord`. Collect the results.

Events whose canonical URL cannot be resolved: the enricher reports a `missing_canonical_url`
issue — collect those for `data/events-issues.json` and do not create a candidate.

## Phase 4 — Supplemental discovery (agent-crawled)

Crawl the Phase-4 source list in AGENTS.md (devopsdays, srecon, sreday, iacconf, redhat,
carahsoft, cfgmgmtcamp, developerweek, nanog, techfieldday) for events not covered by Phase 1.
Apply the same filters. Enrich any new finds via the `event-enricher` subagent. Dedup against
`data/events.json` and the Phase-2 shortlist.

## Phase 5 — Content validation (agent judgment, MANDATORY)

For **every** enriched candidate from Phases 2–4, **dispatch the `content-validator` subagent
once per event, concurrently**. Each validator visits the canonical `event_url`, reads actual
page content, and returns a verdict: `relevant`, `out_of_scope` (with reason), or `error`.

- `relevant` → keep for Phase 6.
- `out_of_scope` → append to `data/events-ignored-<DATE>.json` (segment shape in the template).
- `error` (unfetchable / 404 / blocked) → append to `data/events-issues.json`.

Validation is non-waivable. Prefer documented exclusion over risky inclusion.

Write the merged set of validated, relevant candidates to a single file, e.g.
`data/validated-candidates-<DATE>.json`.

## Phase 6 — Reconciliation (scripted)

```powershell
python scripts/reconcile-events.py --run-date <DATE> --input-file data/validated-candidates-<DATE>.json
```

Produces `data/events-candidates.json`, `data/events-updates.json`, and
`data/events-overlap-review.json`.

## Phase 7 — Cost refresh (agent judgment)

For existing `data/events.json` records with missing or free-marked cost, verify pricing per
AGENTS.md Phase 7 (you may use the `event-enricher` subagent scoped to cost only). Write
evidence-backed cost changes to `data/events-updates.json` with `target.dataset = "events"`.

## Final output

Produce the markdown summary required by the prompt template ("Required outputs" + "Quality
checks"): per-source counts (`discovered`, `filtered`, `matched`, `new`, `failed`), the dev.events
Phase-2 counts, an overlap audit for `events-candidates.json`, and the run status (mark
incomplete if any phase was blocked). Confirm which data files were written.
