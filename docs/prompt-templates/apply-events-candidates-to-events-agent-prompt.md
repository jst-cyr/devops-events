# Apply Candidates to Events Prompt Template (Agent Window)

Use this prompt in the agent window to merge reviewed candidate events into the canonical events data.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

Your task is to add approved records from `data/events-candidates.json` into `data/events.json` safely and deterministically.

### Inputs

- Canonical file: `data/events.json`
- Candidate file: `data/events-candidates.json`
- Data model reference: `docs/data-model.md`

### Scope

- Process only records in `data/events-candidates.json`.
- Add only records that do not already exist in `data/events.json`.
- Do not modify existing records in this workflow (updates are handled separately via `events-updates.json`).

### Duplicate detection rules (in order)

For each candidate, check existing records by:
1. exact `event_url`
2. exact `id`
3. normalized `name` + `start_date` + `location.country`

If any match exists, skip that candidate and record the reason.

### Validation rules before insert

- Record must conform to `EventRecord` in `docs/data-model.md`.
- Required fields must exist and be non-empty: `id`, `name`, `event_url`, `start_date`, `end_date`, `delivery`, `source`, `location`.
- Dates must be `YYYY-MM-DD`, and `end_date >= start_date`.
- URL must be absolute `https://`.
- For online events, enforce:
  - `delivery: "online"`
  - `location.is_online: true`
  - `location.city: null`
  - `location.country: "Online"`
  - `location.country_code: "XX"` (if unknown)
- **Cost validation** (when cost object is present):
  - If `cost.is_free = true`:
    - `cost.lowest_price` must be `null`, `0`, or absent.
    - `cost.cost_level` should be `"free"` if present.
  - If `cost.is_free = false`:
    - `cost.lowest_price` may be a positive number or `null` (if unknown).
    - `cost.price_currency` should be present (ISO 4217 code, defaults to `USD`).
    - `cost.cost_level` should be one of `"budget" | "standard" | "premium"` if present.
  - If cost object is absent, treat as pricing unknown (not an error; cost is optional).

### Write behavior

1. Read `data/events.json` and `data/events-candidates.json`.
2. Build a list of records to insert after validation and dedupe checks.
3. Append accepted records to `data/events.json` under `records`.
4. Keep existing top-level metadata in `data/events.json` intact unless explicitly asked.
5. Preserve stable formatting and valid JSON.

### Output requirements

Provide:

1. **Merge summary** in markdown:
   - candidate count
   - inserted count
   - skipped count
   - skip reasons (`duplicate`, `invalid`, `missing_required_fields`)

2. **Skipped records report** in markdown:
   - `name`
   - reason
   - match key if duplicate

3. **Updated canonical file**:
   - write the merged result to `data/events.json`

### Quality checks before finalizing

- `data/events.json` remains valid JSON.
- No duplicate records are introduced.
- All inserted records pass model validation.
- Inserted records appear only once in `records`.

Now execute the workflow and provide:
1) merge summary,
2) skipped records report,
3) confirmation that `data/events.json` was updated.
