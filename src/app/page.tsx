import { EventsDashboard } from "@/components/events-dashboard";
import { getDashboardFeed } from "@/lib/events-data";

export const revalidate = 86400;

const INITIAL_PAGE_SIZE = 30;

export default async function Home() {
  const [initialCfps, initialEvents, initialPastEvents] = await Promise.all([
    getDashboardFeed({ kind: "cfp", limit: INITIAL_PAGE_SIZE }),
    getDashboardFeed({ kind: "events", limit: INITIAL_PAGE_SIZE }),
    getDashboardFeed({ kind: "events", timeframe: "past", limit: INITIAL_PAGE_SIZE }),
  ]);

  return <EventsDashboard initialCfps={initialCfps} initialEvents={initialEvents} initialPastEvents={initialPastEvents} />;
}
