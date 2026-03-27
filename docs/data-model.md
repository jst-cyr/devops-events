# DevOps Events Data Model

This document defines the canonical data structure for tracking DevOps-related events and CFP opportunities.

## Goals

- Represent both in-person and online events.
- Capture event timing and CFP timing independently.
- Support region/country/city filtering for weekly community posts.
- Keep fields stable for future automation and agent workflows.

## Entity: `EventRecord`

A single event (conference, meetup, webinar, user group, etc.).

### Required fields

- `id` (string): Stable unique identifier. Suggested format: `slug-name-YYYY`.
- `name` (string): Public event name.
- `event_url` (string): Canonical event landing page URL.
- `start_date` (date, `YYYY-MM-DD`): First day/date of the event.
- `end_date` (date, `YYYY-MM-DD`): Last day/date of the event. For single-day events, equals `start_date`.
- `location` (object): Structured location metadata.
- `delivery` (enum): `in_person` | `online` | `hybrid`.
- `source` (string): Where this record came from (example: `slack_weekly_post`, `dev.events`).

### Optional fields

- `event_type` (enum): `conference` | `meetup` | `webinar` | `workshop` | `user_group` | `summit` | `other`.
- `tags` (array of strings): Topics like `devops`, `platform`, `security`, `cloud-native`, `puppet`.
- `cost` (object): Cost/pricing metadata for the event.
- `cfp` (object): CFP metadata if the event accepts talks.
- `notes` (string): Freeform context (for example: "Q1 NYC edition").
- `timezone` (string): IANA timezone (example: `America/New_York`).
- `last_verified_at` (datetime, ISO 8601): Last date/time links and dates were checked.
- `created_at` (datetime, ISO 8601).
- `updated_at` (datetime, ISO 8601).

## Nested object: `location`

Use one structure for all event types.

### Fields

- `city` (string | null): `null` for online-only events.
- `region` (string | null): State/province/prefecture/administrative region.
- `country` (string): Country name, or `Online` for online-only events.
- `country_code` (string): ISO 3166-1 alpha-2 where possible (example: `US`, `DE`, `JP`). Use `XX` for online-only if unknown.
- `is_online` (boolean): Explicit online marker.
- `venue` (string | null): Venue/building/platform label.

## Nested object: `cfp`

Include only when CFP information exists.

### Fields

- `has_cfp` (boolean): `true` if CFP exists.
- `cfp_url` (string | null): Submission URL.
- `cfp_open_date` (date, `YYYY-MM-DD` | null): Known opening date.
- `cfp_close_date` (date, `YYYY-MM-DD` | null): Closing deadline date.
- `cfp_timezone` (string | null): Timezone for deadline interpretation.
- `cfp_status` (enum): `upcoming` | `open` | `closing_soon` | `closed` | `unknown`.

## Nested object: `cost`

Include when event pricing information is available.

### Fields

- `is_free` (boolean): `true` if the event is free to attend.
- `lowest_price` (number | null): Lowest ticket price available in the specified currency. Must be `null` or omitted if `is_free = true`.
- `price_currency` (string): ISO 4217 currency code (example: `USD`, `EUR`, `GBP`). Defaults to `USD` if omitted. Omit if `is_free = true`.
- `cost_level` (enum | null): Categorical cost indicator for UI display. Values: `free` | `budget` | `standard` | `premium`. Set to `free` if `is_free = true`; otherwise derived from `lowest_price` range or agent judgement.
  - `budget`: lowest ticket under $100 (or regional equivalent)
  - `standard`: lowest ticket $100–$500
  - `premium`: lowest ticket $500+
- `notes` (string | null): Additional pricing context (example: "Early bird pricing available", "Corporate rate only", "Scholarship available").

## Validation rules

- `end_date` must be greater than or equal to `start_date`.
- If `delivery = online`, set `location.is_online = true` and `location.city = null`.
- If `cfp.has_cfp = false`, all other `cfp_*` fields should be `null`.
- URLs should be absolute `https://` links.
- Dates should always use `YYYY-MM-DD`.
- **Cost validation**:
  - If `cost.is_free = true`:
    - `cost.lowest_price` must be `null`, `0`, or omitted.
    - `cost.price_currency` should be omitted.
    - `cost.cost_level` must be `"free"` if present.
  - If `cost.is_free = false`:
    - `cost.lowest_price` must be a positive number (or agent may set to `null` if pricing is unavailable/unclear).
    - `cost.price_currency` should be present (defaults to `USD` if omitted).
    - `cost.cost_level` must be one of `"budget" | "standard" | "premium"` if present.
  - If `cost` object is absent, treat as pricing unknown (not free).

## Recommended normalized JSON example

```json
{
  "id": "devopsdays-austin-2026",
  "name": "DevOpsDays Austin",
  "event_url": "https://devopsdays.org/events/2026-austin/welcome/",
  "start_date": "2026-05-06",
  "end_date": "2026-05-07",
  "delivery": "in_person",
  "event_type": "conference",
  "tags": ["devops"],
  "source": "slack_weekly_post",
  "location": {
    "city": "Austin",
    "region": "Texas",
    "country": "United States",
    "country_code": "US",
    "is_online": false,
    "venue": null
  },
  "cost": {
    "is_free": false,
    "lowest_price": 199,
    "price_currency": "USD",
    "cost_level": "budget",
    "notes": "Early bird tickets available"
  },
  "cfp": {
    "has_cfp": true,
    "cfp_url": "https://talks.devopsdays.org/devopsdays-austin-2026/cfp",
    "cfp_open_date": null,
    "cfp_close_date": "2026-02-26",
    "cfp_timezone": null,
    "cfp_status": "closed"
  },
  "notes": null,
  "timezone": "America/Chicago",
  "last_verified_at": "2026-02-27T00:00:00Z",
  "created_at": "2026-02-27T00:00:00Z",
  "updated_at": "2026-02-27T00:00:00Z"
}
```

## Minimal required payload example

```json
{
  "id": "cloud-native-birmingham-2026-online",
  "name": "Cloud Native Birmingham",
  "event_url": "https://community.cncf.io/events/details/cncf-cloud-native-birmingham-presents-cloud-native-birmingham-online-meetup-kicking-off-2026-together/",
  "start_date": "2026-02-26",
  "end_date": "2026-02-26",
  "delivery": "online",
  "source": "slack_weekly_post",
  "location": {
    "city": null,
    "region": null,
    "country": "Online",
    "country_code": "XX",
    "is_online": true,
    "venue": "Online"
  },
  "cost": {
    "is_free": true,
    "cost_level": "free"
  }
}
```

## Posting-focused derived views

From this model, weekly posts can be generated with two filtered lists:

- `cfp_closing_soon`: events where `cfp.has_cfp = true` and `cfp.cfp_close_date` falls in a configurable window.
- `events_happening_soon`: events where `start_date` falls in a configurable date range.
