import { describe, expect, it } from "vitest";

import { buildSlackAnnouncement } from "./slack-announcement";
import type { EventListItem } from "./events-types";

function sampleEvent(overrides: Partial<EventListItem>): EventListItem {
  return {
    id: "event-1",
    name: "Sample Event",
    event_url: "https://example.com/event",
    start_date: "2026-03-01",
    end_date: "2026-03-01",
    delivery: "online",
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
      cfp_close_date: null,
    },
    ...overrides,
  };
}

describe("buildSlackAnnouncement", () => {
  it("builds expected sections and lines for CFP and event entries", () => {
    const now = new Date("2026-02-27T00:00:00Z");
    const cfpItem = sampleEvent({
      name: "DevOpsDays Austin",
      location: {
        city: "Austin",
        region: "Texas",
        country: "United States",
        country_code: "US",
        is_online: false,
        venue: null,
      },
      cfp: {
        has_cfp: true,
        cfp_url: "https://example.com/cfp",
        cfp_close_date: "2026-03-10",
      },
    });

    const eventItem = sampleEvent({
      name: "ConFoo",
      location: {
        city: "Montreal",
        region: "Quebec",
        country: "Canada",
        country_code: "CA",
        is_online: false,
        venue: null,
      },
      start_date: "2026-03-02",
      end_date: "2026-03-03",
      event_url: "https://example.com/confoo",
    });

    const message = buildSlackAnnouncement({
      now,
      cfps: [cfpItem],
      events: [eventItem],
    });

    expect(message).toContain(":people_hugging: *Tech Events Around the World (Feb 27th edition)*");
    expect(message).toContain("*CFP opportunities closing soon:*");
    expect(message).toContain(":us: DevOpsDays Austin (Austin, Texas, United States). CFP due 2026-03-10: https://example.com/cfp");
    expect(message).toContain("*Events happening soon:*");
    expect(message).toContain(":flag-ca: ConFoo (Montreal, Quebec, Canada). 2026-03-02 to 2026-03-03: https://example.com/confoo");
  });

  it("includes fallback text when there are no records", () => {
    const message = buildSlackAnnouncement({
      now: new Date("2026-02-27T00:00:00Z"),
      cfps: [],
      events: [],
    });

    expect(message).toContain("_No CFP opportunities closing in the next 4 weeks._");
    expect(message).toContain("_No events happening in the next 4 weeks._");
  });
});
