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
- Sample dataset from 2026-02-20 weekly post: [data/sample-events-2026-02-20.json](data/sample-events-2026-02-20.json)

## Data

- Canonical events data file: [data/events.json](data/events.json)

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

## Dashboard behavior

- The home page (`/`) shows two sections:
	- CFPs ending in the next month
	- Events happening in the next month
- Default time window is a rolling 30 days from the current day.
- Initial results are rendered server-side and statically generated with ISR.
- The “Load more” buttons append additional items client-side without reloading the page.
- The layout is responsive for mobile and desktop.

## Architecture

- Server-side data layer: `src/lib/events-data.ts`
	- Wraps access to `data/events.json`
	- Encapsulates filtering, sorting, and pagination logic
	- Keeps app code independent from raw JSON shape for future database migration
- Shared types/constants: `src/lib/events-types.ts`
- Read-only API route: `src/app/api/events/route.ts`
	- Reuses the same server-side data layer (DRY)
	- Supports cursor pagination for both feeds
	- Exposes no write operations (`POST`, `PUT`, `PATCH`, `DELETE` return `405`)
	- Applies basic per-IP rate limiting

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