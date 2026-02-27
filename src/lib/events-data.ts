import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_PAGE_SIZE,
  FOUR_WEEKS_DAYS,
  MAX_PAGE_SIZE,
  type DashboardFeedResponse,
  type DashboardKind,
  type EventListItem,
  type EventRecord,
} from "@/lib/events-types";

type EventsFile = {
  records: EventRecord[];
};

const EVENTS_FILE_PATH = path.join(process.cwd(), "data", "events.json");

let recordsCache: EventRecord[] | null = null;

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
    cfp: {
      has_cfp: record.cfp?.has_cfp ?? false,
      cfp_url: record.cfp?.cfp_url ?? null,
      cfp_close_date: record.cfp?.cfp_close_date ?? null,
    },
  };
}

async function getAllRecords(): Promise<EventRecord[]> {
  if (recordsCache) {
    return recordsCache;
  }

  const fileContents = await readFile(EVENTS_FILE_PATH, "utf-8");
  const parsed = JSON.parse(fileContents) as EventsFile;
  recordsCache = parsed.records ?? [];
  return recordsCache;
}

function buildWindow(now: Date): { start: Date; end: Date } {
  const start = startOfUtcDay(now);
  const end = addDays(start, FOUR_WEEKS_DAYS - 1);
  return { start, end };
}

function getUpcomingEventRecords(records: EventRecord[], now: Date): EventRecord[] {
  const { start, end } = buildWindow(now);

  return records
    .filter((record) => {
      const startDate = parseDate(record.start_date);
      if (!startDate) {
        return false;
      }
      return startDate >= start && startDate <= end;
    })
    .sort((left, right) => left.start_date.localeCompare(right.start_date));
}

function getUpcomingCfpRecords(records: EventRecord[], now: Date): EventRecord[] {
  const { start, end } = buildWindow(now);

  return records
    .filter((record) => {
      if (!record.cfp?.has_cfp || !record.cfp.cfp_close_date) {
        return false;
      }

      const closeDate = parseDate(record.cfp.cfp_close_date);
      if (!closeDate) {
        return false;
      }

      return closeDate >= start && closeDate <= end;
    })
    .sort((left, right) => {
      const leftDate = left.cfp?.cfp_close_date ?? "9999-12-31";
      const rightDate = right.cfp?.cfp_close_date ?? "9999-12-31";
      return leftDate.localeCompare(rightDate);
    });
}

export async function getDashboardFeed(options: {
  kind: DashboardKind;
  now?: Date;
  cursor?: number;
  limit?: number;
}): Promise<DashboardFeedResponse> {
  const now = options.now ?? new Date();
  const cursor = normalizeCursor(options.cursor);
  const limit = normalizeLimit(options.limit);
  const records = await getAllRecords();

  const selected =
    options.kind === "cfp"
      ? getUpcomingCfpRecords(records, now)
      : getUpcomingEventRecords(records, now);

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
