# devops-events
This project is an open-source project aimed to filter through multiple sources and find events where practitioners in the DevOps space may be attending or may be interested in speaking.

This pulls from several data sources:
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

## Documentation

- Data model for events/CFPs: [docs/data-model.md](docs/data-model.md)
- Dashboard behavior and architecture: [docs/dashboard-behavior-and-architecture.md](docs/dashboard-behavior-and-architecture.md)
- Agent prompt template for source analysis: [docs/prompt-templates/events-source-analysis-agent-prompt.md](docs/prompt-templates/events-source-analysis-agent-prompt.md)
- Agent prompt template for promoting candidates into events.json: [docs/prompt-templates/apply-events-candidates-to-events-agent-prompt.md](docs/prompt-templates/apply-events-candidates-to-events-agent-prompt.md)
- Agent prompt template for applying updates into events.json: [docs/prompt-templates/apply-events-updates-to-events-agent-prompt.md](docs/prompt-templates/apply-events-updates-to-events-agent-prompt.md)
- Sample dataset from 2026-02-20 weekly post: [data/sample-events-2026-02-20.json](data/sample-events-2026-02-20.json)

## Data

## Analysis Workflow & Scripts

### Event Analysis (180-day window)
For discovering new events and identifying existing events requiring updates:

```bash
# Full workflow:
# 1. Run agent analysis to discover events (produces discovered-events.json)
# 2. Reconcile against existing database
python scripts/reconcile-events.py --run-date 2026-04-17 --input-file discovered-events.json

# Cost backfill only (no new discoveries)
python scripts/reconcile-events.py --run-date 2026-04-17

# Today's run with default date
python scripts/reconcile-events.py --input-file discovered-events.json
```

**Outputs:**
- `data/events-candidates.json` - New events for review
- `data/events-updates.json` - Field-level updates (cost backfill, data corrections)
- `data/events-issues.json` - Data quality issues and extraction failures

**Configuration:**
- Event discovery window: 180 days (for marketing sponsorship lead time)
- CFP discovery window: 56 days (manageable review scope)
- Geographic filter: Excludes China, Africa, Central/South America, Middle East, Romania, Mexico

### CFP Analysis (56-day window)
For discovering Call for Papers opportunities:

```bash
# Download CFP tracker snapshot
cURL.exe -L "https://adatosystems.com/cfp-tracker/" -o "data/adatosystems-cfp-tracker-2026-04-17.html"

# Parse and reconcile
node scripts/parse-cfp-tracker.mjs 2026-04-17
```

**Outputs:**
- `data/cfp-candidates.json` - Prioritized DevOps-relevant CFP opportunities
- `data/adatosystems-cfp-validation-2026-04-17.json` - Reconciliation report

### Usage Pattern (Weekly/Monthly Runs)
1. Run agent to discover events and CFPs from sources
2. Execute `reconcile-events.py` with discovered events file
3. Execute `parse-cfp-tracker.mjs` for CFP extraction
4. Review `events-candidates.json` and `cfp-candidates.json` in agent window
5. Apply approved candidates to `events.json` using apply-events agent prompt
## Web App (Next.js)

This repository now includes a Next.js application at the repository root.

### Stack

- TypeScript
- Next.js 16 (App Router)
- React 19
- shadcn/ui (latest CLI)
- Tailwind CSS v4
- pnpm

### Quick start

1. Install dependencies:

	```bash
	pnpm install
	```

2. Start development server:

	```bash
	pnpm dev
	```

3. Build for production:

	```bash
	pnpm build
	```

### Notes

- `shadcn` was initialized with base color `slate` and CSS variables enabled.
- The current shadcn CLI no longer exposes a `style` flag; configuration is stored in `components.json`.

## API

`GET /api/events`

Query params:

- `kind`: `cfp` | `events` (default: `events`)
- `cursor`: number offset for pagination (default: `0`)
- `limit`: page size (default: `6`, max: `20`)

Example:

```bash
curl "http://localhost:3000/api/events?kind=cfp&cursor=0&limit=6"
```

Response fields:

- `items`: current page records
- `cursor`: current offset
- `nextCursor`: next offset or `null`
- `hasMore`: whether another page is available
- `total`: total matching records in the current window

## Docs Validation

Validate this implementation against the official docs:

- Tailwind CSS v4 + Next.js: https://tailwindcss.com/docs/installation/framework-guides/nextjs
- shadcn/ui (Next.js + CLI): https://ui.shadcn.com/docs/installation/next and https://ui.shadcn.com/docs/cli
- Next.js docs (latest): https://nextjs.org/docs
- React versions: https://react.dev/versions
- TypeScript docs/download: https://www.typescriptlang.org/docs/ and https://www.typescriptlang.org/download