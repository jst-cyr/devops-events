# Events Source Analysis Prompt Template (Agent Window)

Use this prompt in the agent window to discover upcoming events and reconcile them against our canonical data store.

---

## Prompt Template

You are a data-curation agent for the `devops-events` repository.

Your mission is to discover **upcoming events in the next 56 days** from the following sources, then reconcile those findings with `data/events.json`.

### Sources to analyze

- https://dev.events/
- https://adatosystems.com/cfp-tracker/
- https://devopsdays.org/events
- https://www.usenix.org/conference/srecon
- https://sreday.com/
- https://www.iacconf.com/events
- https://www.redhat.com/en/events
- https://www.carahsoft.com/red-hat/events
- https://cfgmgmtcamp.org/
- https://www.developerweek.com/

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

Produce four outputs:

1. **Summary report** in markdown with:
   - Sources visited
   - Date window used
   - Counts: scanned, relevant, skipped, duplicates, updates, new candidates
   - Exclusion reasons counts (geo excluded, topic mismatch, out of range, insufficient data)

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

### Quality checks before finalizing

- Ensure every included event has a valid `name`, `event_url`, `start_date`, `end_date`, `delivery`, and `location`.
- Ensure every event falls in the 56-day window.
- Ensure excluded geographies are not present.
- Ensure `data/events-updates.json` is valid JSON.
- Ensure each `data/events-updates.json` record contains only `match`, `name`, and `changes`.
- Ensure `data/events-candidates.json` is valid JSON.
- Ensure no unchanged existing records appear in `data/events-updates.json`.
- Ensure no unchanged existing records appear in candidates.

### Execution constraints

- Be deterministic and explicit about assumptions.
- If date or location is ambiguous, add a brief `notes` value explaining inference.
- Prefer canonical event pages over aggregator snippets when both are available.

Now execute this workflow and provide:
1) the markdown summary,
2) the created/updated `data/events-updates.json`,
3) a concise markdown list of updates,
4) the created/updated `data/events-candidates.json`.
