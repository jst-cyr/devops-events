import { afterEach, describe, expect, it, vi } from "vitest"

type GetDashboardFeed = typeof import("@/lib/events-data").getDashboardFeed

function createRequest(url: string, headers?: Record<string, string>) {
  return {
    url,
    headers: new Headers(headers),
  }
}

async function loadRouteWithMock() {
  const getDashboardFeed = vi.fn<Parameters<GetDashboardFeed>, ReturnType<GetDashboardFeed>>()

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

describe("/api/events route", () => {
  it("returns feed data for GET with parsed query params", async () => {
    const { route, getDashboardFeed } = await loadRouteWithMock()

    getDashboardFeed.mockResolvedValue({
      kind: "cfp",
      items: [],
      cursor: 6,
      nextCursor: null,
      hasMore: false,
      total: 6,
    })

    const response = await route.GET(
      createRequest("http://localhost:3000/api/events?kind=cfp&cursor=6&limit=8", {
        "x-forwarded-for": "203.0.113.5",
      }) as never,
    )

    expect(getDashboardFeed).toHaveBeenCalledWith({ kind: "cfp", cursor: 6, limit: 8 })
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=86400")

    const payload = await response.json()
    expect(payload.kind).toBe("cfp")
    expect(payload.total).toBe(6)
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
      createRequest("http://localhost:3000/api/events?kind=invalid&cursor=-4&limit=0") as never,
    )

    expect(getDashboardFeed).toHaveBeenCalledWith({ kind: "events", cursor: 0, limit: 6 })
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

  it("returns 429 when rate limit is exceeded for same client", async () => {
    const { route, getDashboardFeed } = await loadRouteWithMock()

    getDashboardFeed.mockResolvedValue({
      kind: "events",
      items: [],
      cursor: 0,
      nextCursor: null,
      hasMore: false,
      total: 0,
    })

    const request = createRequest("http://localhost:3000/api/events", {
      "x-forwarded-for": "198.51.100.8",
    })

    for (let count = 0; count < 60; count += 1) {
      const response = await route.GET(request as never)
      expect(response.status).toBe(200)
    }

    const blocked = await route.GET(request as never)
    expect(blocked.status).toBe(429)
    const payload = await blocked.json()
    expect(payload.error).toBe("Rate limit exceeded")
  })
})
