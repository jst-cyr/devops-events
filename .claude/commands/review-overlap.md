---
description: Classify probable-duplicate candidates from events-overlap-review.json.
argument-hint: [YYYY-MM-DD]  (source run date; defaults to today)
---

Execute the overlap-review workflow defined in
[docs/prompt-templates/review-events-overlap-agent-prompt.md](../../docs/prompt-templates/review-events-overlap-agent-prompt.md).

**Source run date:** `$1` — if empty, use today's date from session context.

Read that template now and follow it exactly. In summary:

- **Inputs:** `data/events-overlap-review.json` (the probable-overlap hints),
  `data/events-candidates.json`, `data/events.json`.
- For each record in `data/events-overlap-review.json`, decide `duplicate_existing`,
  `distinct_event`, or `uncertain`. Prioritize official-page equivalence, brand identity, and
  date/location consistency. Treat year-suffix and trivial URL differences (www, trailing path,
  regional mirror) as non-material.
- **Gate:** `duplicate_existing` at high/medium confidence ⇒ `recommended_action: drop_candidate`.
  `uncertain` ⇒ `recommended_action: manual_check`.

Output **JSON only** in the exact shape specified in the template (`generated_at`,
`source_run_date`, `records[...]` with `candidate_id`, `candidate_name`, `likely_existing_id`,
`decision`, `confidence`, `rationale`, `recommended_action`).
