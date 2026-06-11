---
description: Apply reviewed field-level patches from events-updates.json to events.json / events-candidates.json.
---

Execute the update-apply workflow defined in
[docs/prompt-templates/apply-events-updates-to-events-agent-prompt.md](../../docs/prompt-templates/apply-events-updates-to-events-agent-prompt.md).

Read that template now and follow it exactly. In summary:

- **Inputs:** `data/events.json`, `data/events-candidates.json`, `data/events-updates.json`,
  `docs/data-model.md`.
- **Target selection:** `target.dataset = events` (or omitted) → `data/events.json`;
  `target.dataset = candidates` → `data/events-candidates.json`.
- **Match exactly one record** via `match.key_type` (`event_url` / `id` / `dev_events_slug` /
  `name+start_date+country`). No match or multiple matches → skip and report.
- **Pre-apply check:** the current value of each changed field must equal `changes.<field>.old`.
  On conflict, skip that field (or the whole item if all fields conflict) and report it.
- **Cost updates require evidence** — do not apply blanket fallback-only cost changes. Free-due-to-
  unknown-pricing changes must carry notes stating pricing pages were checked.
- **Apply** only non-conflicting listed fields; leave unrelated fields untouched; keep JSON valid.
- **Post-apply validation** per the data model (dates, URLs, cost-field rules).

Then report: (1) apply summary (requested / matched / updated / skipped / conflict counts),
(2) conflict/skips report (name, match key, reason, field paths), (3) confirmation of which files
were written and that they remain valid JSON.
