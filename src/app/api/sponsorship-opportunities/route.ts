import { NextResponse } from "next/server";

import { getDashboardFeed } from "@/lib/events-data";
import { MAX_PAGE_SIZE, type EventListItem } from "@/lib/events-types";
import { buildSponsorshipMessage } from "@/lib/slack-announcement";

const TWO_MONTHS_DAYS = 60;

async function getPremiumEvents(): Promise<EventListItem[]> {
  const items: EventListItem[] = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const feed = await getDashboardFeed({
      kind: "events",
      cursor,
      limit: MAX_PAGE_SIZE,
      costLevel: "premium",
    });

    items.push(...feed.items);
    hasMore = feed.hasMore;
    cursor = feed.nextCursor ?? 0;
  }

  return items;
}

export async function GET() {
  const now = new Date();
  const cutoff = new Date(now.getTime() + TWO_MONTHS_DAYS * 24 * 60 * 60 * 1000);

  const allPremium = await getPremiumEvents();

  const farOutEvents = allPremium.filter((event) => {
    const start = new Date(`${event.start_date}T00:00:00Z`);
    return start >= cutoff;
  });

  const message = buildSponsorshipMessage({ now, events: farOutEvents });

  return NextResponse.json(
    { message },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
