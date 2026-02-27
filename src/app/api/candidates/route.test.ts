import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_PAGE_SIZE } from "@/lib/events-types"

type GetDashboardFeed = typeof import("@/lib/events-data").getDashboardFeed

function createRequest(url: string, headers?: Record<string, string>) {
  return {
    url,
    headers: new Headers(headers),
  }
}

async function loadRouteWithMock() {
  const getDashboardFeed = vi.fn<GetDashboardFeed>()

  vi.resetModules()
  vi.doMock("@/lib/events-data", () => ({
    getDashboardFeed,
  }))

  const route = await import("./route")

  return {
    route,
    getDashboardFeed,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.unmock("@/lib/events-data")
})

describe("/api/candidates route", () => {
  it("returns candidate feed data for GET with parsed query params", async () => {
    const { route, getDashboardFeed } = await loadRouteWithMock()

    getDashboardFeed.mockResolvedValue({
      kind: "cfp",
      items: [],
      cursor: 3,
      nextCursor: null,
      hasMore: false,
      total: 3,
    })

    const response = await route.GET(
      createRequest("http://localhost:3000/api/candidates?kind=cfp&cursor=3&limit=8", {
        "x-forwarded-for": "203.0.113.6",
      }) as never,
    )

    expect(getDashboardFeed).toHaveBeenCalledWith({ kind: "cfp", source: "candidates", timeframe: "upcoming", cursor: 3, limit: 8 })
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=86400")
  })

  it("falls back to safe defaults for invalid query params", async () => {
    const { route, getDashboardFeed } = await loadRouteWithMock()

    getDashboardFeed.mockResolvedValue({
      kind: "events",
      items: [],
      cursor: 0,
      nextCursor: null,
      hasMore: false,
      total: 0,
    })

    await route.GET(
      createRequest("http://localhost:3000/api/candidates?kind=invalid&cursor=-4&limit=0") as never,
    )

    expect(getDashboardFeed).toHaveBeenCalledWith({ kind: "events", source: "candidates", timeframe: "upcoming", cursor: 0, limit: DEFAULT_PAGE_SIZE })
  })

  it("parses and forwards past timeframe for event queries", async () => {
    const { route, getDashboardFeed } = await loadRouteWithMock()

    getDashboardFeed.mockResolvedValue({
      kind: "events",
      items: [],
      cursor: 0,
      nextCursor: null,
      hasMore: false,
      total: 0,
    })

    await route.GET(
      createRequest("http://localhost:3000/api/candidates?kind=events&timeframe=past&cursor=2&limit=5") as never,
    )

    expect(getDashboardFeed).toHaveBeenCalledWith({ kind: "events", source: "candidates", timeframe: "past", cursor: 2, limit: 5 })
  })

  it("returns 405 for write methods", async () => {
    const { route } = await loadRouteWithMock()

    const responses = await Promise.all([
      route.POST(),
      route.PUT(),
      route.PATCH(),
      route.DELETE(),
    ])

    for (const response of responses) {
      expect(response.status).toBe(405)
      const payload = await response.json()
      expect(payload.error).toBe("Method not allowed")
    }
  })
})
