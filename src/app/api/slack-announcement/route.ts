import { NextResponse } from "next/server";

import { getDashboardFeed } from "@/lib/events-data";
import { FOUR_WEEKS_DAYS, MAX_PAGE_SIZE, type DashboardKind, type EventListItem } from "@/lib/events-types";
import { buildSlackAnnouncement } from "@/lib/slack-announcement";

async function getAllWindowItems(kind: DashboardKind): Promise<EventListItem[]> {
  const items: EventListItem[] = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const feed = await getDashboardFeed({
      kind,
      cursor,
      limit: MAX_PAGE_SIZE,
      windowDays: FOUR_WEEKS_DAYS,
    });

    items.push(...feed.items);
    hasMore = feed.hasMore;
    cursor = feed.nextCursor ?? 0;
  }

  return items;
}

export async function GET() {
  const [cfps, events] = await Promise.all([
    getAllWindowItems("cfp"),
    getAllWindowItems("events"),
  ]);

  const message = buildSlackAnnouncement({
    now: new Date(),
    cfps,
    events,
  });

  return NextResponse.json(
    {
      message,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
