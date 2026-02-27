import { EventsDashboard } from "@/components/events-dashboard";
import { getDashboardFeed } from "@/lib/events-data";
import { FOUR_WEEKS_DAYS } from "@/lib/events-types";

export const revalidate = 86400;

export default async function Home() {
  const [windowCfps, windowEvents] = await Promise.all([
    getDashboardFeed({ kind: "cfp", windowDays: FOUR_WEEKS_DAYS }),
    getDashboardFeed({ kind: "events", windowDays: FOUR_WEEKS_DAYS }),
  ]);

  const [futureCfpsProbe, futureEventsProbe] = await Promise.all([
    getDashboardFeed({ kind: "cfp", cursor: windowCfps.items.length, limit: 1 }),
    getDashboardFeed({ kind: "events", cursor: windowEvents.items.length, limit: 1 }),
  ]);

  const initialCfps = {
    ...windowCfps,
    total: futureCfpsProbe.total,
    hasMore: futureCfpsProbe.items.length > 0,
    nextCursor: futureCfpsProbe.items.length > 0 ? windowCfps.items.length : null,
  };

  const initialEvents = {
    ...windowEvents,
    total: futureEventsProbe.total,
    hasMore: futureEventsProbe.items.length > 0,
    nextCursor: futureEventsProbe.items.length > 0 ? windowEvents.items.length : null,
  };

  return <EventsDashboard initialCfps={initialCfps} initialEvents={initialEvents} />;
}
