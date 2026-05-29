# Archive Past Events Script

This script moves events older than 30 days from `data/events.json` to `data/events-archive.json`.

## Usage

```sh
pnpm exec node scripts/archive-past-events.mjs
```

- Only events with a clear end date (or start date if no end date) older than 30 days are archived.
- Events with missing or ambiguous dates remain in `events.json`.
- The archive file is a single file for now (`events-archive.json`).
- Each archived event gets an `_archived` field with the archive date.

## Workflow

1. Add or update events in `events.json` as usual.
2. Run the archive script manually as needed (e.g., monthly or before large merges).
3. The application and agents continue to use `events.json` as before.
4. For historical/planning queries, reference `events-archive.json`.

## Future Considerations
- If the archive grows large, consider splitting by year (e.g., `events-archive-2026.json`).
- When moving to a database, revisit this workflow for scalability.
