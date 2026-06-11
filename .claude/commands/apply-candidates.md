---
description: Merge approved candidate events from events-candidates.json into the canonical events.json.
---

Execute the candidate-merge workflow defined in
[docs/prompt-templates/apply-events-candidates-to-events-agent-prompt.md](../../docs/prompt-templates/apply-events-candidates-to-events-agent-prompt.md).

Read that template now and follow it exactly. In summary:

- **Inputs:** `data/events.json` (canonical), `data/events-candidates.json` (candidates),
  `docs/data-model.md` (schema).
- **Scope:** add only candidate records that do **not** already exist in `data/events.json`.
  Do not modify existing records (that's `/apply-updates`).
- **Dedup order:** exact `event_url` → exact `id` → normalized `name + start_date + location.country`.
- **Validate before insert:** conform to `EventRecord`; required fields present; `YYYY-MM-DD`
  dates with `end_date >= start_date`; absolute `https://` URLs; online-event location rules; and
  the cost-object validation gate (skip records with an absent or unresearched cost object).
- **Write:** append accepted records to `data/events.json` `records`, preserve top-level metadata
  and valid JSON formatting.

Then report: (1) merge summary (candidate / inserted / skipped counts with skip reasons),
(2) skipped-records report (name, reason, match key), (3) confirmation that `data/events.json`
was updated and remains valid JSON with no duplicates.
