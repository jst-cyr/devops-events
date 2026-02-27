import { afterEach, describe, expect, it, vi } from "vitest"

import type { EventRecord } from "./events-types"
import { FOUR_WEEKS_DAYS } from "./events-types"

const NOW = new Date("2026-02-27T12:00:00Z")

function createEvent(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "event-id",
    name: "Event",
    event_url: "https://example.com/event",
    start_date: "2026-03-01",
    end_date: "2026-03-01",
    delivery: "online",
    source: "test",
    location: {
      city: null,
      region: null,
      country: "Online",
      country_code: "XX",
      is_online: true,
      venue: "Online",
    },
    cfp: {
      has_cfp: false,
      cfp_url: null,
      cfp_open_date: null,
      cfp_close_date: null,
      cfp_timezone: null,
      cfp_status: "unknown",
    },
    ...overrides,
  }
}

async function loadModuleWithData(records: EventRecord[]) {
  const readFile = vi.fn().mockResolvedValue(JSON.stringify({ records }))

  vi.resetModules()
  vi.doMock("node:fs/promises", () => ({
    readFile,
  }))

  const eventsDataModule = await import("./events-data")
  return {
    getDashboardFeed: eventsDataModule.getDashboardFeed,
    readFile,
  }
}

async function loadModuleWithSourceData(eventsRecords: EventRecord[], candidateRecords: EventRecord[]) {
  const readFile = vi.fn().mockImplementation(async (filePath: string) => {
    if (filePath.endsWith("events-candidates.json")) {
      return JSON.stringify({ records: candidateRecords })
    }

    return JSON.stringify({ records: eventsRecords })
  })

  vi.resetModules()
  vi.doMock("node:fs/promises", () => ({
    readFile,
  }))

  const eventsDataModule = await import("./events-data")
  return {
    getDashboardFeed: eventsDataModule.getDashboardFeed,
    readFile,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.unmock("node:fs/promises")
})

describe("getDashboardFeed", () => {
  it("returns upcoming events in ascending date order inside the requested 4-week window", async () => {
    const records = [
      createEvent({ id: "outside", start_date: "2026-03-27", end_date: "2026-03-27" }),
      createEvent({ id: "inside-late", start_date: "2026-03-26", end_date: "2026-03-26" }),
      createEvent({ id: "inside-early", start_date: "2026-02-27", end_date: "2026-02-27" }),
      createEvent({ id: "past", start_date: "2026-02-26", end_date: "2026-02-26" }),
    ]

    const { getDashboardFeed } = await loadModuleWithData(records)
    const result = await getDashboardFeed({
      kind: "events",
      now: NOW,
      limit: 10,
      windowDays: FOUR_WEEKS_DAYS,
    })

    expect(result.items.map((item) => item.id)).toEqual(["inside-early", "inside-late"])
    expect(result.total).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it("returns all future upcoming events by default when no window is provided", async () => {
    const records = [
      createEvent({ id: "in-window", start_date: "2026-03-10", end_date: "2026-03-10" }),
      createEvent({ id: "beyond-4-weeks", start_date: "2026-04-15", end_date: "2026-04-15" }),
      createEvent({ id: "past", start_date: "2026-02-26", end_date: "2026-02-26" }),
    ]

    const { getDashboardFeed } = await loadModuleWithData(records)
    const result = await getDashboardFeed({ kind: "events", now: NOW, limit: 10 })

    expect(result.items.map((item) => item.id)).toEqual(["in-window", "beyond-4-weeks"])
    expect(result.total).toBe(2)
  })

  it("returns CFP records filtered by cfp_close_date and has_cfp", async () => {
    const records = [
      createEvent({
        id: "cfp-in-window",
        cfp: {
          has_cfp: true,
          cfp_url: "https://example.com/cfp",
          cfp_open_date: null,
          cfp_close_date: "2026-03-20",
          cfp_timezone: "UTC",
          cfp_status: "open",
        },
      }),
      createEvent({
        id: "cfp-outside-window",
        cfp: {
          has_cfp: true,
          cfp_url: "https://example.com/cfp2",
          cfp_open_date: null,
          cfp_close_date: "2026-03-30",
          cfp_timezone: "UTC",
          cfp_status: "open",
        },
      }),
      createEvent({
        id: "cfp-disabled",
        cfp: {
          has_cfp: false,
          cfp_url: null,
          cfp_open_date: null,
          cfp_close_date: "2026-03-10",
          cfp_timezone: null,
          cfp_status: "unknown",
        },
      }),
    ]

    const { getDashboardFeed } = await loadModuleWithData(records)
    const result = await getDashboardFeed({ kind: "cfp", now: NOW, windowDays: FOUR_WEEKS_DAYS })

    expect(result.items.map((item) => item.id)).toEqual(["cfp-in-window"])
    expect(result.total).toBe(1)
  })

  it("supports cursor pagination with stable nextCursor and hasMore", async () => {
    const records = [
      createEvent({ id: "event-1", start_date: "2026-02-27" }),
      createEvent({ id: "event-2", start_date: "2026-02-28" }),
      createEvent({ id: "event-3", start_date: "2026-03-01" }),
    ]

    const { getDashboardFeed } = await loadModuleWithData(records)
    const page1 = await getDashboardFeed({ kind: "events", now: NOW, limit: 2, cursor: 0 })
    const page2 = await getDashboardFeed({ kind: "events", now: NOW, limit: 2, cursor: page1.nextCursor ?? 0 })

    expect(page1.items.map((item) => item.id)).toEqual(["event-1", "event-2"])
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBe(2)

    expect(page2.items.map((item) => item.id)).toEqual(["event-3"])
    expect(page2.hasMore).toBe(false)
    expect(page2.nextCursor).toBeNull()
  })

  it("reads events file once per module instance via cache", async () => {
    const records = [createEvent({ id: "event-1", start_date: "2026-02-27" })]

    const { getDashboardFeed, readFile } = await loadModuleWithData(records)
    await getDashboardFeed({ kind: "events", now: NOW })
    await getDashboardFeed({ kind: "cfp", now: NOW })

    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it("supports separate candidates source with independent file cache", async () => {
    const eventsRecords = [createEvent({ id: "events-source", start_date: "2026-03-10" })]
    const candidateRecords = [
      createEvent({
        id: "candidate-source",
        start_date: "2026-03-11",
        cfp: {
          has_cfp: true,
          cfp_url: "https://example.com/candidate-cfp",
          cfp_open_date: null,
          cfp_close_date: "2026-03-12",
          cfp_timezone: "UTC",
          cfp_status: "open",
        },
      }),
    ]

    const { getDashboardFeed, readFile } = await loadModuleWithSourceData(eventsRecords, candidateRecords)

    const fromCandidates = await getDashboardFeed({ kind: "events", source: "candidates", now: NOW })
    const fromEvents = await getDashboardFeed({ kind: "events", source: "events", now: NOW })
    await getDashboardFeed({ kind: "cfp", source: "candidates", now: NOW })

    expect(fromCandidates.items.map((item) => item.id)).toEqual(["candidate-source"])
    expect(fromEvents.items.map((item) => item.id)).toEqual(["events-source"])
    expect(readFile).toHaveBeenCalledTimes(2)
  })
})
