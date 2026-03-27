# Apply Updates to Events Prompt Template (Agent Window)

Use this prompt in the agent window to apply reviewed update patches from `events-updates.json` to canonical events data.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

Your task is to apply approved field-level changes from `data/events-updates.json` to matching records in `data/events.json`.

### Inputs

- Canonical file: `data/events.json`
- Updates file: `data/events-updates.json`
- Data model reference: `docs/data-model.md`

### Expected updates file shape

Each update record contains only:
- `match` (`key_type`, `key_value`)
- `name`
- `changes` (`field_path` -> `{ old, new }`)

### Matching behavior

For each update item, locate exactly one existing record in `data/events.json` using `match`:
- `key_type = event_url` => match exact `event_url`
- `key_type = id` => match exact `id`
- `key_type = name+start_date+country` => derive and match normalized composite key

If no record or multiple records match, skip and report.

### Pre-apply checks

For each field in `changes`:
- Verify current value in canonical record equals `old`.
- If current value differs from `old`, skip that field and report conflict.

If all changed fields for an update item conflict, skip the whole update item.

### Apply behavior

- Apply only non-conflicting field updates.
- Update only the fields listed under `changes`.
- Do not alter unrelated fields.
- Keep JSON valid and preserve canonical top-level structure.

### Post-apply validation

- Validate updated records against `docs/data-model.md` required fields/rules.
- Ensure dates remain valid (`end_date >= start_date`).
- Ensure URL fields remain absolute `https://`.
- **Cost field validation** (when cost updates are applied):
  - If `cost.is_free = true`:
    - `cost.lowest_price` must be `null`, `0`, or absent.
    - `cost.cost_level` should be `"free"` if present.
  - If `cost.is_free = false`:
    - `cost.lowest_price` must be a positive number.
    - `cost.price_currency` must be present (ISO 4217 code).
    - `cost.cost_level` must be one of `"budget" | "standard" | "premium"`.
  - If pricing is unknown or unavailable, `cost.is_free` must be `true` and `cost.cost_level` must be `"free"` (see **Unknown pricing rule** in data model).
  - Report validation failures for cost field updates.

### Output requirements

Provide:

1. **Apply summary** in markdown:
   - updates requested
   - records matched
   - records updated
   - fully skipped items
   - field conflicts count

2. **Conflict/skips report** in markdown:
   - `name`
   - match key
   - reason (`not_found`, `multiple_matches`, `old_value_conflict`, `invalid_new_value`)
   - field paths impacted

3. **Updated canonical file**:
   - write applied result to `data/events.json`

### Quality checks before finalizing

- `data/events.json` is valid JSON.
- Only requested fields changed.
- No unmatched/ambiguous updates were silently applied.
- Conflicts are fully reported.

Now execute the workflow and provide:
1) apply summary,
2) conflict/skips report,
3) confirmation that `data/events.json` was updated.
