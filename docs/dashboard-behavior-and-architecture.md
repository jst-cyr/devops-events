# Dashboard Behavior and Architecture

## Dashboard behavior

- The home page (`/`) shows two sections:
  - CFPs ending in the next 4 weeks
  - Events happening in the next 4 weeks
- Initial SSR time window is a rolling 28 days (4 weeks) from the current day.
- "Load more" continues beyond 4 weeks and can show all future records.
- Initial results are rendered server-side and statically generated with ISR, with daily revalidation.
- The "Load more" buttons append additional items client-side without reloading the page.
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
