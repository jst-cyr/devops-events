import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type DashboardFeedResponse,
  type DashboardKind,
  type DashboardTimeframe,
  type EventListItem,
  type EventRecord,
} from "@/lib/events-types";

type EventsFile = {
  records: EventRecord[];
};

export type DashboardDataSource = "events" | "candidates";

const EVENTS_FILE_PATH = path.join(process.cwd(), "data", "events.json");
const CANDIDATES_FILE_PATH = path.join(process.cwd(), "data", "events-candidates.json");
const POOR_FIT_TAG = "poor fit";

const recordsCache: Record<DashboardDataSource, EventRecord[] | null> = {
  events: null,
  candidates: null,
};

function parseDate(date: string | null | undefined): Date | null {
  if (!date) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

function normalizeCursor(cursor: number | undefined): number {
  if (!cursor) {
    return 0;
  }

  return Math.max(0, Math.trunc(cursor));
}

function mapEventItem(record: EventRecord): EventListItem {
  return {
    id: record.id,
    name: record.name,
    event_url: record.event_url,
    start_date: record.start_date,
    end_date: record.end_date,
    delivery: record.delivery,
    location: record.location,
    event_type: record.event_type,
    tags: record.tags,
    cost: record.cost,
    cfp: {
      has_cfp: record.cfp?.has_cfp ?? false,
      cfp_url: record.cfp?.cfp_url ?? null,
      cfp_close_date: record.cfp?.cfp_close_date ?? null,
    },
  };
}

function getFilePath(source: DashboardDataSource): string {
  return source === "candidates" ? CANDIDATES_FILE_PATH : EVENTS_FILE_PATH;
}

async function getAllRecords(source: DashboardDataSource): Promise<EventRecord[]> {
  if (recordsCache[source]) {
    return recordsCache[source];
  }

  try {
    const fileContents = await readFile(getFilePath(source), "utf-8");

    if (!fileContents.trim()) {
      return [];
    }

    const parsed = JSON.parse(fileContents) as EventsFile;
    recordsCache[source] = parsed.records ?? [];
    return recordsCache[source];
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isPoorFit(record: EventRecord): boolean {
  return (
    record.tags?.some((tag) => tag.trim().toLowerCase() === POOR_FIT_TAG) ?? false
  );
}

function filterRecordsByCountry(records: EventRecord[], country?: string): EventRecord[] {
  if (!country) {
    return records;
  }

  return records.filter((record) => record.location.country === country);
}

function filterByFreeEvents(records: EventRecord[]): EventRecord[] {
  return records.filter((record) => record.cost?.is_free === true);
}

export async function getAvailableLocations(source: DashboardDataSource = "events"): Promise<string[]> {
  const records = await getAllRecords(source);

  const locations = new Set<string>();
  for (const record of records) {
    if (isPoorFit(record)) {
      continue;
    }

    const location = record.location.country?.trim();
    if (location) {
      locations.add(location);
    }
  }

  return [...locations].sort((a, b) => {
    if (a === "Online") {
      return -1;
    }
    if (b === "Online") {
      return 1;
    }

    return a.localeCompare(b);
  });
}

function getUpcomingEventRecords(records: EventRecord[], now: Date, windowDays?: number): EventRecord[] {
  const start = startOfUtcDay(now);
  const end =
    typeof windowDays === "number"
      ? addDays(start, Math.max(1, windowDays) - 1)
      : null;

  return records
    .filter((record) => {
      const startDate = parseDate(record.start_date);
      if (!startDate) {
        return false;
      }

      if (end) {
        return startDate >= start && startDate <= end;
      }

      return startDate >= start;
    })
    .sort((left, right) => left.start_date.localeCompare(right.start_date));
}

function getPastEventRecords(records: EventRecord[], now: Date, windowDays?: number): EventRecord[] {
  const start = startOfUtcDay(now);
  const earliest =
    typeof windowDays === "number"
      ? addDays(start, -Math.max(1, windowDays))
      : null;

  return records
    .filter((record) => {
      const startDate = parseDate(record.start_date);
      if (!startDate) {
        return false;
      }

      if (earliest) {
        return startDate < start && startDate >= earliest;
      }

      return startDate < start;
    })
    .sort((left, right) => right.start_date.localeCompare(left.start_date));
}

function getUpcomingCfpRecords(records: EventRecord[], now: Date, windowDays?: number): EventRecord[] {
  const start = startOfUtcDay(now);
  const end =
    typeof windowDays === "number"
      ? addDays(start, Math.max(1, windowDays) - 1)
      : null;

  return records
    .filter((record) => {
      if (!record.cfp?.has_cfp || !record.cfp.cfp_close_date) {
        return false;
      }

      const closeDate = parseDate(record.cfp.cfp_close_date);
      if (!closeDate) {
        return false;
      }

      if (end) {
        return closeDate >= start && closeDate <= end;
      }

      return closeDate >= start;
    })
    .sort((left, right) => {
      const leftDate = left.cfp?.cfp_close_date ?? "9999-12-31";
      const rightDate = right.cfp?.cfp_close_date ?? "9999-12-31";
      return leftDate.localeCompare(rightDate);
    });
}

function getPastCfpRecords(records: EventRecord[], now: Date, windowDays?: number): EventRecord[] {
  const start = startOfUtcDay(now);
  const earliest =
    typeof windowDays === "number"
      ? addDays(start, -Math.max(1, windowDays))
      : null;

  return records
    .filter((record) => {
      if (!record.cfp?.has_cfp || !record.cfp.cfp_close_date) {
        return false;
      }

      const closeDate = parseDate(record.cfp.cfp_close_date);
      if (!closeDate) {
        return false;
      }

      if (earliest) {
        return closeDate < start && closeDate >= earliest;
      }

      return closeDate < start;
    })
    .sort((left, right) => {
      const leftDate = left.cfp?.cfp_close_date ?? "0000-01-01";
      const rightDate = right.cfp?.cfp_close_date ?? "0000-01-01";
      return rightDate.localeCompare(leftDate);
    });
}

export async function getDashboardFeed(options: {
  kind: DashboardKind;
  source?: DashboardDataSource;
  timeframe?: DashboardTimeframe;
  now?: Date;
  cursor?: number;
  limit?: number;
  windowDays?: number;
  country?: string;
}): Promise<DashboardFeedResponse> {
  const source = options.source ?? "events";
  const timeframe = options.timeframe ?? "upcoming";
  const now = options.now ?? new Date();
  const cursor = normalizeCursor(options.cursor);
  const limit = normalizeLimit(options.limit);
  const records = await getAllRecords(source);
  const visibleRecords = filterRecordsByCountry(
    records.filter((record) => !isPoorFit(record)),
    options.country,
  );

  const selected =
    options.kind === "cfp"
      ? timeframe === "past"
        ? getPastCfpRecords(visibleRecords, now, options.windowDays)
        : getUpcomingCfpRecords(visibleRecords, now, options.windowDays)
      : timeframe === "past"
        ? getPastEventRecords(visibleRecords, now, options.windowDays)
        : getUpcomingEventRecords(visibleRecords, now, options.windowDays);

  const items = selected.slice(cursor, cursor + limit).map(mapEventItem);
  const nextCursor = cursor + items.length;

  return {
    kind: options.kind,
    items,
    cursor,
    nextCursor: nextCursor < selected.length ? nextCursor : null,
    hasMore: nextCursor < selected.length,
    total: selected.length,
  };
}
